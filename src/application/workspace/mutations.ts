import { SerialQueue } from '@/core/serial-queue';
import { AppError } from '@/core/errors';
import {
  sameEntry,
  assertTreeShape,
  cloneTree,
  type GitEntry,
  type GitTree,
} from '@/core/git/objects';
import { sameHead } from '@/core/git/repository';
import { sameConflicts, gitStateNames } from '@/core/git/merge';
import type { WorkspaceContext } from './context';
import type { Project } from '@/core/projects';
import type { Operation, OperationKind } from '@/core/workspace/journal';
import type { WorkspaceChange } from '@/core/workspace/types';
import type { WorkspaceReader } from './reader';
/** Sole owner of project mutation queues, leases and journal recovery. */
export class MutationCoordinator {
  readonly recoveryIssues: string[] = [];
  private readonly queues = new Map<string, SerialQueue>();
  private readonly owners = new Map<string, string>();
  private readonly blocked = new Set<string>();
  private readonly listeners = new Set<(change: WorkspaceChange) => void>();
  constructor(
    private readonly context: WorkspaceContext,
    private readonly reader: WorkspaceReader,
  ) {}
  query<T>(projectId: string, action: () => Promise<T>): Promise<T> {
    let queue = this.queues.get(projectId);
    if (!queue) {
      queue = new SerialQueue();
      this.queues.set(projectId, queue);
    }
    return queue.run(action);
  }
  subscribe = (listener: (change: WorkspaceChange) => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  notify(change: WorkspaceChange) {
    const value = Object.freeze({ ...change, paths: Object.freeze([...change.paths]) });
    try {
      this.context.changed?.();
    } catch {
      /* Observers do not own writes. */
    }
    for (const listener of this.listeners) {
      try {
        listener(value);
      } catch {
        /* A view failure cannot invalidate a durable receipt. */
      }
    }
  }
  claim(projectId: string, owner: string) {
    if (this.owners.has(projectId)) throw new AppError('CONFLICT', '工作区正在执行任务');
    if (this.blocked.has(projectId))
      throw new AppError('STORAGE', '工作区需要修复，请保留本地数据');
    this.owners.set(projectId, owner);
  }
  release(projectId: string, owner: string) {
    if (this.owners.get(projectId) === owner) this.owners.delete(projectId);
  }
  needsRecovery(projectId: string) {
    return this.blocked.has(projectId);
  }
  block(projectId: string, message: string) {
    this.blocked.add(projectId);
    if (!this.recoveryIssues.includes(message)) this.recoveryIssues.push(message);
  }
  serial<T>(projectId: string, owner: string | undefined, action: () => Promise<T>): Promise<T> {
    return this.query(projectId, async () => {
      if (this.blocked.has(projectId))
        throw new AppError('STORAGE', '恢复未完成，工作区写入已禁用');
      const active = this.owners.get(projectId);
      if (active && active !== owner)
        throw new AppError('CONFLICT', '请等待或取消当前任务后再修改文件');
      if (!(await this.context.metadata.get<Project>(this.context.projectBucket, projectId)))
        throw new AppError('VALIDATION', '工作区不存在');
      return action();
    });
  }
  async prepare(
    projectId: string,
    changes: Operation['changes'],
    message: string,
    id: string,
    ownerRootRunId?: string,
    attribution?: Pick<Operation, 'actorRunId' | 'proposalId' | 'mergedByRunId'>,
    kind: OperationKind = 'files',
    body: Omit<import('@/core/workspace/journal').OperationBody, 'changes'> = {},
  ) {
    if (body.gitStateChange) {
      for (const state of [body.gitStateChange.before, body.gitStateChange.after])
        for (const [name, value] of Object.entries(state)) {
          if (
            !(gitStateNames as readonly string[]).includes(name) ||
            (value !== null && typeof value !== 'string')
          )
            throw new AppError('VALIDATION', 'Git 状态字段或内容无效。');
          if (value !== null && this.context.codec.encodeText(value).length > 65536)
            throw new AppError(
              'LIMIT',
              'Git 状态内容超过移动端操作预算，请缩小变基范围或提交说明。',
            );
        }
    }
    const expectedHead = await this.context.git.head(projectId);
    const key = 'operations/' + this.context.codec.encodeHex(this.context.codec.encodeText(id));
    for (const [position, oid] of [
      ...new Set([
        ...(body.commitDependencies ?? []),
        ...(body.headChange?.after.oid ? [body.headChange.after.oid] : []),
      ]),
    ].entries()) {
      await this.context.git.checkpoint(
        projectId,
        await this.context.git.tree(projectId, oid),
        key + '/dependency-' + position,
        oid,
      );
    }
    const conflictObjects: GitTree = Object.create(null);
    for (const conflict of [
      ...(body.conflictsChange?.before ?? []),
      ...(body.conflictsChange?.after ?? []),
    ]) {
      for (const entry of [conflict.base, conflict.ours, conflict.theirs]) {
        if (entry)
          conflictObjects[entry.mode + '-' + entry.oid] = {
            revision: entry.oid,
            mode: entry.mode,
          };
      }
    }
    // Recursive merge bases can create stage blobs that no source commit references.
    if (Object.keys(conflictObjects).length)
      await this.context.git.checkpoint(
        projectId,
        conflictObjects,
        key + '/conflicts',
        expectedHead,
      );
    const working = await this.context.git.workingTree(projectId);
    const beforeCheckpoint = await this.context.git.checkpoint(
      projectId,
      working,
      key + '/before',
      expectedHead,
    );
    const target =
      kind === 'files_commit'
        ? await this.context.git.tree(projectId, expectedHead)
        : cloneTree(working);
    for (const change of changes) {
      if (
        !sameEntry(working[change.path], change.before) &&
        !sameEntry(working[change.path], change.after)
      )
        throw new AppError('CONFLICT', '文件与准备的修改基线不匹配。');
      if (change.after) target[change.path] = change.after;
      else delete target[change.path];
    }
    assertTreeShape(target);
    const checkpoint = await this.context.git.checkpoint(
      projectId,
      target,
      key + '/target',
      beforeCheckpoint,
    );
    let indexBefore: string | undefined, indexAfter: string | undefined;
    let indexChanges = body.indexChanges;
    if (kind === 'files_commit') {
      if (this.context.journal.namespace !== 'skills')
        throw new AppError('VALIDATION', '整包版本保存只用于技能库。');
      const index = await this.context.git.index(projectId);
      indexChanges = changes.map(change => ({
        path: change.path,
        before: index[change.path] ?? null,
        after: change.after,
      }));
    }
    if (indexChanges?.length) {
      const before = body.conflictsChange
          ? (await this.context.git.indexState(projectId)).entries
          : await this.context.git.index(projectId),
        after = cloneTree(before);
      for (const change of indexChanges) {
        if (change.after) after[change.path] = change.after;
        else delete after[change.path];
      }
      assertTreeShape(after);
      indexBefore = await this.context.git.checkpoint(
        projectId,
        before,
        key + '/index-before',
        expectedHead,
      );
      indexAfter = await this.context.git.checkpoint(
        projectId,
        after,
        key + '/index-after',
        indexBefore,
      );
    }
    const operation = await this.context.journal
      .prepare(
        {
          id,
          projectId,
          kind,
          expectedHead,
          message,
          ownerRootRunId,
          actorRunId: ownerRootRunId,
          ...attribution,
          checkpoint,
          indexBefore,
          indexAfter,
          phase: 'prepared',
          createdAt: new Date().toISOString(),
        },
        { changes, ...body, ...(indexChanges ? { indexChanges } : {}) },
      )
      .catch(error => {
        if (!(error instanceof AppError) || !['VALIDATION', 'CONFLICT'].includes(error.code))
          this.block(projectId, '修改意图登记需要恢复，已暂停项目写入。');
        throw error;
      });
    return this.apply(operation);
  }
  private result(operation: Operation): string {
    const value = ['commit', 'files_commit'].includes(operation.kind)
      ? operation.commit
      : operation.checkpoint;
    if (!value) throw new AppError('STORAGE', '操作回执缺少必要 Git 引用。');
    return value;
  }
  async apply(operation: Operation): Promise<string> {
    if (operation.phase === 'recorded') return this.result(operation);
    const projectId = operation.scope.projectId;
    try {
      const makesCommit = operation.kind === 'commit' || operation.kind === 'files_commit';
      const currentRef = {
        oid: await this.context.git.head(projectId),
        branch: await this.context.git.branch(projectId),
      };
      const switched = operation.headChange && sameHead(currentRef, operation.headChange.after);
      const receipt = operation.completionReceipt
        ? await this.context.git.operationReceipt(projectId, operation.id)
        : undefined;
      if (receipt && receipt !== operation.checkpoint)
        throw new AppError('STORAGE', 'Git 操作完成标记与意图不匹配。');
      const found = makesCommit
        ? await this.context.git.findOperation(projectId, operation.id)
        : undefined;
      if (found) operation.commit = found;
      else if (!switched && !receipt) {
        if (
          currentRef.oid !== operation.expectedHead ||
          currentRef.branch !== operation.expectedBranch ||
          (operation.headChange && !sameHead(currentRef, operation.headChange.before))
        )
          throw new AppError('STORAGE', '恢复基线不匹配');
        if (operation.kind !== 'commit') {
          const state = operation.conflictsChange
            ? await this.context.git.indexState(projectId)
            : undefined;
          if (
            state &&
            !sameConflicts(state.conflicts, operation.conflictsChange!.before) &&
            !sameConflicts(state.conflicts, operation.conflictsChange!.after)
          )
            throw new AppError('STORAGE', '三方索引与恢复意图不匹配。');
          if (operation.gitStateChange) {
            const actual = await this.context.git.gitState(projectId);
            if (
              gitStateNames.some(
                name =>
                  (actual[name] ?? null) !== (operation.gitStateChange!.before[name] ?? null) &&
                  (actual[name] ?? null) !== (operation.gitStateChange!.after[name] ?? null),
              )
            )
              throw new AppError('STORAGE', 'Git 合并状态与恢复意图不匹配。');
          }
          const index =
            state?.entries ??
            (operation.indexChanges?.length ? await this.context.git.index(projectId) : {});
          const pending: Record<string, GitEntry | null> = Object.create(null);
          for (const change of operation.indexChanges ?? []) {
            const value = index[change.path] ?? null;
            if (!sameEntry(value, change.before) && !sameEntry(value, change.after))
              throw new AppError('STORAGE', '暂存区与恢复记录不匹配');
            if (!sameEntry(value, change.after)) pending[change.path] = change.after;
          }
          await this.context.git.applyWorktree(projectId, operation.changes, operation.fileMove);
          if (operation.conflictsChange)
            await this.context.git.setIndexState(
              projectId,
              pending,
              operation.conflictsChange.before,
              operation.conflictsChange.after,
            );
          else if (Object.keys(pending).length) await this.context.git.setIndex(projectId, pending);
          if (operation.gitStateChange)
            await this.context.git.applyGitState(
              projectId,
              operation.gitStateChange.before,
              operation.gitStateChange.after,
            );
          if (operation.phase === 'prepared') {
            operation.phase = 'applied';
            await this.context.journal.save(operation);
          }
          if (!operation.checkpoint) throw new AppError('STORAGE', '文件意图缺少固定目标快照');
          if (operation.phase === 'applied') {
            operation.phase = 'checkpointed';
            await this.context.journal.save(operation);
          }
        }
        if (makesCommit) {
          if (!operation.checkpoint) throw new AppError('STORAGE', '提交意图缺少固定目标快照。');
          operation.commit = await this.context.git.commitSnapshot(
            projectId,
            operation.checkpoint,
            operation.message + '\n\nAgentMobile-Operation: ' + operation.id,
            operation.expectedHead,
          );
        }
        if (operation.headChange)
          await this.context.git.changeHead(
            projectId,
            operation.headChange.before,
            operation.headChange.after,
            operation.headChange.branchGuard,
          );
      }
      if (operation.completionReceipt && !receipt) {
        if (!operation.checkpoint) throw new AppError('STORAGE', 'Git 操作缺少完成快照。');
        await this.context.git.completeOperation(projectId, operation.id, operation.checkpoint);
      }
      if (makesCommit || operation.headChange) {
        operation.phase = 'committed';
        await this.context.journal.save(operation);
      }
      const head = await this.context.git.head(projectId);
      const project = await this.context.metadata.get<Project>(
        this.context.projectBucket,
        projectId,
      );
      operation.phase = 'recorded';
      await this.context.journal.save(
        operation,
        project
          ? [
              {
                bucket: this.context.projectBucket,
                id: projectId,
                value: { ...project, updatedAt: new Date().toISOString() },
              },
            ]
          : [],
      );
      try {
        await this.reader.record(operation);
      } catch {
        this.reader.invalidate(projectId); /* Optional index cannot invalidate a durable receipt. */
      }
      this.notify({ projectId, paths: operation.changedPaths, commit: head });
      return this.result(operation);
    } catch (error) {
      this.reader.invalidate(projectId);
      this.blocked.add(projectId);
      throw error;
    }
  }
  async recover() {
    this.reader.invalidate();
    for (const project of await this.reader.projects()) {
      try {
        await this.context.git.recoverLocks(project.id);
      } catch {
        this.block(
          project.id,
          '项目 ' + project.id.slice(0, 8) + ' 的 Git 锁恢复失败，已暂停写入。',
        );
        continue;
      }
      while (true) {
        const pending = await this.context.journal.list({
          scope: this.context.journal.scope(project.id),
          pending: true,
          limit: 100,
        });
        if (!pending.length) break;
        let failed = false;
        for (const header of pending) {
          try {
            await this.apply(await this.context.journal.read(header));
          } catch {
            this.blocked.add(project.id);
            this.recoveryIssues.push(
              '项目 ' + project.id.slice(0, 8) + ' 的修改需要恢复，已暂停写入。',
            );
            failed = true;
            break;
          }
        }
        if (failed) break;
      }
    }
  }
  async journalIndex(
    projectId: string,
    changes: NonNullable<Operation['indexChanges']>,
    message: string,
    owner?: string,
    files: Operation['changes'] = [],
  ) {
    return this.prepare(
      projectId,
      files,
      message,
      this.context.id(),
      owner,
      undefined,
      files.length ? 'files' : 'index',
      { indexChanges: changes },
    );
  }
}
