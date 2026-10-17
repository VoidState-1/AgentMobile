import { SerialQueue } from '@/core/serial-queue';
import { AppError } from '@/core/errors';
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
  ) {
    const expectedHead = await this.context.git.head(projectId);
    let checkpoint: string | undefined;
    let indexBefore: string | undefined;
    let indexAfter: string | undefined;
    let indexChanges: Operation['indexChanges'];
    if (kind === 'files_commit') {
      if (this.context.journal.namespace !== 'skills')
        throw new AppError('VALIDATION', '整包版本保存只用于技能库。');
      const target = await this.context.git.tree(projectId, expectedHead);
      const before = await this.indexTree(projectId);
      const after = { ...before };
      indexChanges = [];
      for (const change of changes) {
        const bytes =
          change.after === null ? undefined : this.context.codec.decodeBase64(change.after);
        if (bytes) {
          target[change.path] = bytes;
          after[change.path] = bytes;
        } else {
          delete target[change.path];
          delete after[change.path];
        }
        indexChanges.push({
          path: change.path,
          before: before[change.path] ? await this.context.git.revision(before[change.path]) : null,
          after: bytes ? await this.context.git.revision(bytes) : null,
        });
      }
      checkpoint = await this.context.git.checkpoint(
        projectId,
        target,
        'skills/' + id + '/target',
        expectedHead,
      );
      indexBefore = await this.context.git.checkpoint(
        projectId,
        before,
        'skills/' + id + '/index-before',
        expectedHead,
      );
      indexAfter = await this.context.git.checkpoint(
        projectId,
        after,
        'skills/' + id + '/index-after',
        expectedHead,
      );
    }
    const operation = await this.context.journal.prepare(
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
      { changes, ...(indexChanges ? { indexChanges } : {}) },
    );
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
      const found = makesCommit
        ? await this.context.git.findOperation(projectId, operation.id)
        : undefined;
      if (found) operation.commit = found;
      else {
        if ((await this.context.git.head(projectId)) !== operation.expectedHead)
          throw new AppError('STORAGE', '恢复基线不匹配');
        if (operation.kind !== 'commit') {
          const pending = [];
          for (const change of operation.changes) {
            const current = await this.reader.bytesOrNull(projectId, change.path);
            const value = current ? this.context.codec.encodeBase64(current) : null;
            if (value !== change.before && value !== change.after)
              throw new AppError('STORAGE', '文件内容与恢复记录不匹配');
            if (value !== change.after) pending.push(change);
          }
          const move = operation.fileMove;
          if (
            move &&
            (operation.changes.length !== 2 ||
              operation.changes[0].path !== move.from ||
              operation.changes[0].after !== null ||
              operation.changes[1].path !== move.to ||
              operation.changes[1].before !== null ||
              operation.changes[0].before === null ||
              operation.changes[0].before !== operation.changes[1].after)
          )
            throw new AppError('STORAGE', '文件移动意图不一致。');
          if (move && pending.length === 2) {
            await this.context.fs.moveFile(
              this.reader.internal(projectId, move.from),
              this.reader.internal(projectId, move.to),
            );
          } else
            for (const change of pending) {
              if (change.after === null)
                await this.context.fs.remove(this.reader.internal(projectId, change.path));
              else
                await this.context.fs.write(
                  this.reader.internal(projectId, change.path),
                  this.context.codec.decodeBase64(change.after),
                );
            }
          const index = await this.context.git.index(projectId);
          for (const change of operation.indexChanges ?? []) {
            const value = index[change.path] ?? null;
            if (value !== change.before && value !== change.after)
              throw new AppError('STORAGE', '暂存区与恢复记录不匹配');
            if (value !== change.after)
              await this.context.git.setIndex(projectId, { [change.path]: change.after });
          }
          if (operation.phase === 'prepared') {
            operation.phase = 'applied';
            await this.context.journal.save(operation);
          }
          operation.checkpoint ??= await this.context.git.checkpoint(
            projectId,
            await this.reader.workingTree(projectId),
            'operations/' +
              this.context.codec.encodeHex(this.context.codec.encodeText(operation.id)),
            operation.expectedHead,
          );
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
      }
      if (makesCommit) {
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
  async indexTree(projectId: string) {
    const tree: Record<string, Uint8Array> = Object.create(null);
    for (const [path, oid] of Object.entries(await this.context.git.index(projectId)))
      tree[path] = await this.context.git.blob(projectId, oid);
    return tree;
  }
  async journalIndex(
    projectId: string,
    changes: NonNullable<Operation['indexChanges']>,
    message: string,
    owner?: string,
    files: Operation['changes'] = [],
  ) {
    const id = this.context.id();
    const head = await this.context.git.head(projectId);
    const before = await this.indexTree(projectId);
    const after = { ...before };
    for (const change of changes) {
      if (change.after) after[change.path] = await this.context.git.blob(projectId, change.after);
      else delete after[change.path];
    }
    const operation = await this.context.journal.prepare(
      {
        id,
        projectId,
        ownerRootRunId: owner,
        actorRunId: owner,
        kind: files.length ? 'files' : 'index',
        expectedHead: head,
        indexBefore: await this.context.git.checkpoint(
          projectId,
          before,
          'index/' + id + '/before',
          head,
        ),
        indexAfter: await this.context.git.checkpoint(
          projectId,
          after,
          'index/' + id + '/after',
          head,
        ),
        message,
        phase: 'prepared',
        createdAt: new Date().toISOString(),
      },
      { changes: files, indexChanges: changes },
    );
    return this.apply(operation);
  }
}
