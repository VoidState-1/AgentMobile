import { AppError } from '@/core/errors';
import type { GitStatus } from '@/core/git/contracts';
import type { GitRefState } from '@/core/git/repository';
import { sameHead } from '@/core/git/repository';
import { sameEntry, cloneTree } from '@/core/git/objects';
import type { GitConflictChoice, GitMergePlan, GitMergeSessionInfo } from '@/core/git/merge';
import type { GitConflictPreview } from '@/application/services';
import type { WorkspaceContext } from './context';
import type { MutationCoordinator } from './mutations';
import type { GitService } from './git';
import type { EditorDrafts } from './editor-drafts';
import { ConflictService, indexChanges } from './conflicts';

interface MergeSession extends GitMergeSessionInfo {
  projectId: string;
  original: GitRefState;
  originalWorking: string;
  baseOid: string;
  paths: string[];
  artifacts: string[];
  message: string;
  state: 'prepared' | 'active' | 'completed';
  pendingOperation?: string;
  pendingAction?: 'begin' | 'continue' | 'abort';
}
/** All public commands use the same project queue and journal as ordinary file edits. */
export class MergeService {
  private readonly conflicts: ConflictService;
  constructor(
    private readonly context: WorkspaceContext,
    private readonly mutations: MutationCoordinator,
    private readonly versions: GitService,
    private readonly drafts: EditorDrafts,
  ) {
    this.conflicts = new ConflictService(context, mutations, versions);
  }
  async sessionInfo(projectId: string): Promise<GitMergeSessionInfo | undefined> {
    const value = await this.context.metadata.get<MergeSession>('git-merges', projectId);
    return value && value.state !== 'completed'
      ? { id: value.id, sourceName: value.sourceName, sourceOid: value.sourceOid }
      : undefined;
  }
  private async check(projectId: string, expected: GitStatus) {
    const status = await this.versions.statusValue(projectId);
    if (
      status.head !== expected.head ||
      status.branch !== expected.branch ||
      status.indexRevision !== expected.indexRevision ||
      status.workingRevision !== expected.workingRevision
    )
      throw new AppError('CONFLICT', 'VERSION_CONFLICT：仓库已变化，请刷新后重试。');
    if (await this.drafts.hasUnsaved(projectId))
      throw new AppError('CONFLICT', '项目中有未保存的文件草稿，请先保存或放弃。');
    return status;
  }
  private async active(projectId: string): Promise<MergeSession> {
    const value = await this.context.metadata.get<MergeSession>('git-merges', projectId);
    if (!value || value.state !== 'active' || value.pendingOperation)
      throw new AppError('CONFLICT', '没有可继续处理的合并，或合并需要先恢复。');
    const info = await this.context.git.repositoryInfo(projectId),
      state = await this.context.git.gitState(projectId);
    if (
      info.state !== 'merge' ||
      !sameHead(value.original, { branch: info.head.branch, oid: info.head.oid }) ||
      state.MERGE_HEAD !== value.sourceOid + '\n'
    )
      throw new AppError('CONFLICT', '合并基线或状态已变化，请保留现场。');
    return value;
  }
  private async saveSession(session: MergeSession) {
    try {
      await this.context.metadata.put('git-merges', session.projectId, session);
    } catch (error) {
      this.mutations.block(session.projectId, '合并回执需要恢复，已暂停项目写入。');
      throw error;
    }
  }
  private async releaseUnregistered(session: MergeSession) {
    try {
      const registered = await this.context.journal.get(
        session.projectId,
        session.pendingOperation!,
      );
      if (!registered)
        await this.saveSession({
          ...session,
          state: session.pendingAction === 'begin' ? 'completed' : 'active',
          pendingOperation: undefined,
          pendingAction: undefined,
        });
      else if (registered.phase !== 'recorded')
        this.mutations.block(session.projectId, '合并意图需要恢复，已暂停项目写入。');
    } catch {
      this.mutations.block(session.projectId, '合并意图需要恢复，已暂停项目写入。');
    }
  }
  merge(
    projectId: string,
    source: { name: string; oid: string },
    expected: GitStatus,
  ): Promise<GitMergePlan['kind']> {
    return this.mutations.serial(projectId, undefined, async () => {
      const status = await this.check(projectId, expected),
        info = await this.context.git.repositoryInfo(projectId);
      if (!info.capabilities.merge)
        throw new AppError('VALIDATION', '合并请使用支持该能力的原生应用。');
      if (info.state !== 'none' || (await this.sessionInfo(projectId)))
        throw new AppError('CONFLICT', '请先完成或中止正在进行的 Git 操作。');
      if (status.files.length)
        throw new AppError('CONFLICT', '请先提交或处理未提交更改，再合并分支。');
      const branch = info.branches.find(branch => branch.name === source.name);
      if (!branch || branch.oid !== source.oid)
        throw new AppError('CONFLICT', '目标分支已变化，请刷新后重试。');
      const id = this.context.id(),
        message = "Merge branch '" + source.name + "'";
      const plan = await this.context.git.mergePlan(
        projectId,
        source.oid,
        message + '\n\nAgentMobile-Operation: ' + id,
      );
      if (plan.kind === 'up-to-date') return plan.kind;
      const beforeIndex = await this.context.git.indexState(projectId),
        state = await this.context.git.gitState(projectId);
      let session: MergeSession | undefined;
      if (plan.kind === 'conflicts') {
        if (!plan.baseOid) throw new AppError('STORAGE', '合并计划缺少基础提交。');
        const conflictPaths = new Set(plan.index.conflicts.map(conflict => conflict.path));
        session = {
          id,
          projectId,
          sourceName: source.name,
          sourceOid: source.oid,
          baseOid: plan.baseOid,
          original: { branch: info.head.branch, oid: info.head.oid },
          originalWorking: await this.context.git.checkpoint(
            projectId,
            await this.context.git.workingTree(projectId),
            'merges/' + id + '/original',
            info.head.oid,
          ),
          paths: [
            ...new Set([
              ...plan.changes.map(change => change.path),
              ...indexChanges(beforeIndex.entries, plan.index.entries).map(change => change.path),
              ...conflictPaths,
            ]),
          ],
          artifacts: plan.changes
            .filter(
              change =>
                change.after && !plan.index.entries[change.path] && !conflictPaths.has(change.path),
            )
            .map(change => change.path),
          message,
          state: 'prepared',
          pendingOperation: id,
          pendingAction: 'begin',
        };
        await this.saveSession(session);
      }
      await this.mutations
        .prepare(projectId, plan.changes, message, id, undefined, undefined, 'merge', {
          indexChanges: indexChanges(beforeIndex.entries, plan.index.entries),
          conflictsChange: { before: beforeIndex.conflicts, after: plan.index.conflicts },
          gitStateChange: { before: state, after: plan.stateAfter },
          completionReceipt: true,
          commitDependencies: [source.oid],
          ...(plan.headAfter
            ? {
                headChange: {
                  before: { branch: info.head.branch, oid: info.head.oid },
                  after: plan.headAfter,
                },
              }
            : {}),
        })
        .catch(async error => {
          if (session) await this.releaseUnregistered(session);
          throw error;
        });
      if (session)
        await this.saveSession({
          ...session,
          state: 'active',
          pendingOperation: undefined,
          pendingAction: undefined,
        });
      return plan.kind;
    });
  }
  private scope(session: MergeSession) {
    return {
      kind: 'merge' as const,
      base: session.baseOid,
      ours: session.original.oid,
      theirs: session.sourceOid,
      paths: session.paths,
      artifacts: session.artifacts,
    };
  }
  preview(projectId: string, path: string): Promise<GitConflictPreview> {
    return this.mutations.query(projectId, async () =>
      this.conflicts.preview(projectId, path, this.scope(await this.active(projectId))),
    );
  }
  resolve(
    projectId: string,
    path: string,
    choice: GitConflictChoice,
    expected: GitStatus,
  ): Promise<void> {
    return this.mutations.serial(projectId, undefined, async () => {
      await this.check(projectId, expected);
      await this.conflicts.resolve(
        projectId,
        path,
        choice,
        this.scope(await this.active(projectId)),
      );
    });
  }
  finish(projectId: string, action: 'continue' | 'abort', expected: GitStatus): Promise<void> {
    return this.mutations.serial(projectId, undefined, async () => {
      const status = await this.check(projectId, expected),
        session = await this.active(projectId);
      const index = await this.context.git.indexState(projectId),
        state = await this.context.git.gitState(projectId),
        id = this.context.id();
      if (action === 'continue' && index.conflicts.length)
        throw new AppError('CONFLICT', '请先解决全部冲突，再继续合并。');
      if (index.conflicts.some(conflict => !session.paths.includes(conflict.path)))
        throw new AppError('CONFLICT', '发现本次合并之外的冲突，请保留现场。');
      const changes = [];
      let desired = index.entries,
        afterHead: GitRefState | undefined;
      if (action === 'abort') {
        const original = await this.context.git.tree(projectId, session.originalWorking),
          working = await this.context.git.workingTree(projectId);
        const originalIndex = await this.context.git.tree(projectId, session.original.oid);
        desired = cloneTree(index.entries);
        for (const path of session.paths) {
          if (!sameEntry(working[path], original[path]))
            changes.push({ path, before: working[path] ?? null, after: original[path] ?? null });
          if (originalIndex[path]) desired[path] = originalIndex[path];
          else delete desired[path];
        }
      } else {
        const commit = await this.context.git.mergeCommit(
          projectId,
          index.entries,
          [session.original.oid!, session.sourceOid],
          session.message + '\n\nAgentMobile-Operation: ' + id,
        );
        afterHead = { branch: session.original.branch, oid: commit };
      }
      const pendingSession: MergeSession = {
        ...session,
        pendingOperation: id,
        pendingAction: action,
      };
      await this.saveSession(pendingSession);
      await this.mutations
        .prepare(
          projectId,
          changes,
          action === 'abort' ? '中止合并' : session.message,
          id,
          undefined,
          undefined,
          'merge',
          {
            indexChanges: indexChanges(index.entries, desired),
            conflictsChange: { before: index.conflicts, after: [] },
            gitStateChange: {
              before: state,
              after: { ...state, MERGE_HEAD: null, MERGE_MSG: null, MERGE_MODE: null },
            },
            completionReceipt: true,
            ...(afterHead
              ? {
                  headChange: {
                    before: { branch: status.branch, oid: status.head },
                    after: afterHead,
                  },
                }
              : {}),
          },
        )
        .catch(async error => {
          await this.releaseUnregistered(pendingSession);
          throw error;
        });
      await this.saveSession({
        ...session,
        state: 'completed',
        pendingOperation: undefined,
        pendingAction: undefined,
      });
    });
  }
  async recover() {
    for (const session of await this.context.metadata.all<MergeSession>('git-merges')) {
      if (session.state === 'completed' || this.mutations.needsRecovery(session.projectId))
        continue;
      if (!session.pendingOperation) {
        try {
          await this.active(session.projectId);
        } catch {
          this.mutations.block(session.projectId, '合并基线或状态不匹配，已暂停项目写入。');
        }
        continue;
      }
      const operation = await this.context.journal.get(session.projectId, session.pendingOperation);
      if (!operation) {
        await this.saveSession({
          ...session,
          state: session.pendingAction === 'begin' ? 'completed' : 'active',
          pendingOperation: undefined,
          pendingAction: undefined,
        });
      } else if (operation.phase === 'recorded')
        await this.saveSession({
          ...session,
          state: session.pendingAction === 'begin' ? 'active' : 'completed',
          pendingOperation: undefined,
          pendingAction: undefined,
        });
      else this.mutations.block(session.projectId, '合并操作尚未恢复，已暂停项目写入。');
    }
  }
}
