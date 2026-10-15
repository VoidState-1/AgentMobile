import type { WorkspaceContext } from './context';
import type { Operation } from '@/core/workspace/journal';
import type { ExecutionView } from '@/core/runs/types';
import type { GitBaseline } from '@/core/git/contracts';
import type { WorkspaceReader } from './reader';
import type { MutationCoordinator } from './mutations';
import type { GitService } from './git';
import { AppError } from '@/core/errors';

export class RunSnapshots {
  constructor(
    private readonly context: WorkspaceContext,
    private readonly reader: WorkspaceReader,
    private readonly mutations: MutationCoordinator,
    private readonly versions: GitService,
  ) {}
  inputSnapshot(projectId: string, owner: string, key: string): Promise<string> {
    return this.mutations.serial(projectId, owner, async () =>
      this.context.git.checkpoint(
        projectId,
        await this.reader.workingTree(projectId),
        'delegations/' + key,
        await this.context.git.head(projectId),
      ),
    );
  }
  candidateSnapshot(
    projectId: string,
    owner: string,
    files: Record<string, Uint8Array>,
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
      return {
        head,
        working: await this.context.git.checkpoint(
          projectId,
          await this.reader.workingTree(projectId),
          'tasks/' + taskId + '/base',
          head,
        ),
        index: await this.context.git.checkpoint(
          projectId,
          await this.mutations.indexTree(projectId),
          'tasks/' + taskId + '/base-index',
          head,
        ),
      };
    });
  }

  async taskFinal(task: ExecutionView, recovering = false): Promise<ExecutionView> {
    if (!task.baseSnapshot || !task.baseIndexSnapshot)
      return { ...task, finalCommit: await this.context.git.head(task.projectId) };
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
      : await this.reader.workingTree(task.projectId);
    const index = recovering
      ? await this.context.git.tree(task.projectId, lastIndex?.indexAfter ?? task.baseIndexSnapshot)
      : await this.mutations.indexTree(task.projectId);
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
    const uncommitted = await this.versions.changes(task.projectId, head, finalSnapshot);
    const staged = await this.versions.changes(task.projectId, head, finalIndexSnapshot);
    return {
      ...task,
      finalCommit: head,
      finalSnapshot,
      finalIndexSnapshot,
      changedPaths,
      uncommittedPaths: [
        ...new Set(
          [...uncommitted, ...staged]
            .filter(change => changedPaths.includes(change.path))
            .map(change => change.path),
        ),
      ],
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
          changes.push({ ...change, kind: '暂存' + change.kind });
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
        this.reader.workingTree(task.projectId),
        this.mutations.indexTree(task.projectId),
      ]);
      const baseIndex = task.baseIndexSnapshot
        ? await this.context.git.tree(task.projectId, task.baseIndexSnapshot)
        : before;
      const finalIndex = task.finalIndexSnapshot
        ? await this.context.git.tree(task.projectId, task.finalIndexSnapshot)
        : after;
      const paths =
        task.changedPaths ?? this.versions.treeChanges(before, after).map(change => change.path);
      const files: Operation['changes'] = [];
      const entries: NonNullable<Operation['indexChanges']> = [];
      for (const path of paths) {
        const value = (tree: Record<string, Uint8Array>) =>
          tree[path] ? this.context.codec.encodeBase64(tree[path]) : null;
        if (value(working) !== value(after) || value(index) !== value(finalIndex))
          throw new AppError(
            'CONFLICT',
            'VERSION_CONFLICT：任务文件或暂存区已有后续修改，不能撤销：' + path,
          );
        if (value(before) !== value(working))
          files.push({ path, before: value(working), after: value(before) });
        if (value(baseIndex) !== value(index))
          entries.push({
            path,
            before: index[path] ? await this.context.git.revision(index[path]) : null,
            after: baseIndex[path] ? await this.context.git.revision(baseIndex[path]) : null,
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
