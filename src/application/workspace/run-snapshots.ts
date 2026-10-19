import type { WorkspaceContext } from './context';
import type { Operation } from '@/core/workspace/journal';
import type { ExecutionView } from '@/core/runs/types';
import type { GitBaseline } from '@/core/git/contracts';
import { sameEntry, type GitTree } from '@/core/git/objects';
import type { MutationCoordinator } from './mutations';
import type { GitService } from './git';
import { AppError } from '@/core/errors';

export class RunSnapshots {
  constructor(
    private readonly context: WorkspaceContext,
    private readonly mutations: MutationCoordinator,
    private readonly versions: GitService,
  ) {}
  inputSnapshot(projectId: string, owner: string, key: string): Promise<string> {
    return this.mutations.serial(projectId, owner, async () =>
      this.context.git.checkpoint(
        projectId,
        await this.context.git.workingTree(projectId),
        'delegations/' + key,
        await this.context.git.head(projectId),
      ),
    );
  }
  candidateSnapshot(
    projectId: string,
    owner: string,
    files: GitTree,
    key: string,
    parent: string,
  ): Promise<string> {
    return this.mutations.serial(projectId, owner, () =>
      this.context.git.checkpoint(projectId, files, key, parent),
    );
  }
  taskBaseline(projectId: string, taskId: string): Promise<GitBaseline> {
    return this.mutations.serial(projectId, taskId, async () => {
      const head = await this.context.git.head(projectId);
      const status = await this.context.git.status(projectId);
      if (status.state !== 'none')
        throw new AppError('CONFLICT', '请先完成正在进行的 Git 操作，再启动 Agent。');
      return {
        head,
        dirtyPaths: status.files.map(file => file.path),
        working: await this.context.git.checkpoint(
          projectId,
          await this.context.git.workingTree(projectId),
          'tasks/' + taskId + '/base',
          head,
        ),
        index: await this.context.git.checkpoint(
          projectId,
          await this.context.git.index(projectId),
          'tasks/' + taskId + '/base-index',
          head,
        ),
      };
    });
  }

  async taskFinal(task: ExecutionView, recovering = false): Promise<ExecutionView> {
    if (!task.baseSnapshot || !task.baseIndexSnapshot)
      return { ...task, finalCommit: (await this.context.git.head(task.projectId)) ?? undefined };
    const own = (await this.context.journal.owned(task.projectId, task.id)).reverse();
    const head = recovering
      ? ([...own].reverse().find(op => op.kind === 'commit')?.commit ??
        task.baseCommit ??
        (await this.context.git.head(task.projectId)))
      : await this.context.git.head(task.projectId);
    const lastFiles = [...own].reverse().find(op => op.kind === 'files');
    const lastIndex = [...own].reverse().find(op => op.indexAfter);
    const working = recovering
      ? await this.context.git.tree(task.projectId, lastFiles?.checkpoint ?? task.baseSnapshot)
      : await this.context.git.workingTree(task.projectId);
    const index = recovering
      ? await this.context.git.tree(task.projectId, lastIndex?.indexAfter ?? task.baseIndexSnapshot)
      : await this.context.git.index(task.projectId);
    const finalSnapshot = await this.context.git.checkpoint(
      task.projectId,
      working,
      'tasks/' + task.id + '/final',
      head,
    );
    const finalIndexSnapshot = await this.context.git.checkpoint(
      task.projectId,
      index,
      'tasks/' + task.id + '/final-index',
      head,
    );
    const changes = await this.versions.changes(task.projectId, task.baseSnapshot, finalSnapshot);
    const indexChanges = await this.versions.changes(
      task.projectId,
      task.baseIndexSnapshot,
      finalIndexSnapshot,
    );
    const touched = new Set(own.flatMap(op => op.changedPaths));
    const changedPaths = [
      ...new Set(
        [...changes, ...indexChanges]
          .filter(change => touched.has(change.path))
          .map(change => change.path),
      ),
    ];
    const uncommittedPaths = await this.context.git.uncommittedPaths(
      task.projectId,
      head,
      finalIndexSnapshot,
      finalSnapshot,
      changedPaths,
    );
    return {
      ...task,
      finalCommit: head ?? undefined,
      finalSnapshot,
      finalIndexSnapshot,
      changedPaths,
      uncommittedPaths,
    };
  }

  async taskChanges(task: ExecutionView) {
    const after = task.finalSnapshot ?? task.finalCommit ?? task.baseCommit;
    if (!after) return [];
    const changes = await this.versions.changes(
      task.projectId,
      task.baseSnapshot ?? task.baseCommit,
      after,
    );
    if (task.baseIndexSnapshot && task.finalIndexSnapshot) {
      for (const change of await this.versions.changes(
        task.projectId,
        task.baseIndexSnapshot,
        task.finalIndexSnapshot,
      )) {
        if (!changes.some(file => file.path === change.path))
          changes.push({ ...change, stagedOnly: true });
      }
    }
    return task.changedPaths
      ? changes.filter(file => task.changedPaths!.includes(file.path))
      : changes;
  }

  async undoTask(task: ExecutionView) {
    if (task.kind === 'child')
      throw new AppError('VALIDATION', '子任务提案合入后，请撤销所属根任务。');
    return this.mutations.serial(task.projectId, undefined, async () => {
      const beforeRef = task.baseSnapshot ?? task.baseCommit;
      const afterRef = task.finalSnapshot ?? task.finalCommit;
      if (!afterRef || !beforeRef) throw new AppError('VALIDATION', '工作区任务尚无可撤销结果');
      const [before, after, working, index] = await Promise.all([
        this.context.git.tree(task.projectId, beforeRef),
        this.context.git.tree(task.projectId, afterRef),
        this.context.git.workingTree(task.projectId),
        this.context.git.index(task.projectId),
      ]);
      const baseIndex = task.baseIndexSnapshot
        ? await this.context.git.tree(task.projectId, task.baseIndexSnapshot)
        : before;
      const finalIndex = task.finalIndexSnapshot
        ? await this.context.git.tree(task.projectId, task.finalIndexSnapshot)
        : after;
      const paths =
        task.changedPaths ??
        (await this.versions.treeChanges(task.projectId, before, after)).map(change => change.path);
      const files: Operation['changes'] = [];
      const entries: NonNullable<Operation['indexChanges']> = [];
      for (const path of paths) {
        if (!sameEntry(working[path], after[path]) || !sameEntry(index[path], finalIndex[path]))
          throw new AppError(
            'CONFLICT',
            'VERSION_CONFLICT：任务文件或暂存区已有后续修改，不能撤销：' + path,
          );
        if (!sameEntry(before[path], working[path]))
          files.push({ path, before: working[path] ?? null, after: before[path] ?? null });
        if (!sameEntry(baseIndex[path], index[path]))
          entries.push({
            path,
            before: index[path] ?? null,
            after: baseIndex[path] ?? null,
          });
      }
      if (files.length || entries.length)
        await this.mutations.journalIndex(
          task.projectId,
          entries,
          '撤销任务修改',
          undefined,
          files,
        );
    });
  }
}
