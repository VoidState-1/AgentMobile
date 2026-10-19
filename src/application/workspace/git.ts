import { AppError } from '@/core/errors';
import type { ReviewFile } from '@/application/services';
import type { WorkspaceContext } from './context';
import type { ProjectFile } from '@/core/workspace/types';
import type { GitBaseline, GitStatus } from '@/core/git/contracts';
import { gitModes, sameEntry, type GitTree, type GitEntry } from '@/core/git/objects';
import { safePath } from '@/core/workspace/path';
import { previewContent } from './content';
import type { MutationCoordinator } from './mutations';

export class GitService {
  constructor(
    private readonly context: WorkspaceContext,
    private readonly mutations: MutationCoordinator,
  ) {}
  async restore(projectId: string, ref: string, expectedHead: string | null) {
    return this.mutations.serial(projectId, undefined, async () => {
      if ((await this.context.git.head(projectId)) !== expectedHead)
        throw new AppError('CONFLICT', '历史已变化，请重新预览');
      if ((await this.statusValue(projectId)).files.length)
        throw new AppError('VALIDATION', '工作区有未提交更改，请先提交或丢弃后再恢复版本');
      const target = await this.context.git.tree(projectId, ref),
        current = await this.context.git.tree(projectId, expectedHead);
      const paths = [...new Set([...Object.keys(target), ...Object.keys(current)])];
      const working = await this.context.git.workingTree(projectId, paths);
      const changes = paths
        .filter(path => !sameEntry(working[path], target[path]))
        .map(path => ({
          path: safePath(path),
          before: working[path] ?? null,
          after: target[path] ?? null,
        }));
      if (!changes.length) return expectedHead;
      return this.mutations.prepare(
        projectId,
        changes,
        '恢复版本 ' + ref.slice(0, 7),
        this.context.id(),
      );
    });
  }
  async changes(projectId: string, beforeRef: string | null | undefined, afterRef: string) {
    return this.treeChanges(
      projectId,
      await this.context.git.tree(projectId, beforeRef ?? null),
      await this.context.git.tree(projectId, afterRef),
    );
  }
  async treeChanges(
    projectId: string,
    before: GitTree,
    after: GitTree,
    selected?: readonly string[],
  ): Promise<ReviewFile[]> {
    const result: ReviewFile[] = [];
    const paths = selected ?? [...new Set([...Object.keys(before), ...Object.keys(after)])];
    for (const path of paths) {
      const previous = before[path],
        next = after[path];
      if (sameEntry(previous, next)) continue;
      const size = async (entry: GitEntry | undefined) =>
        entry && entry.mode !== gitModes.gitlink
          ? (await this.context.git.blobInfo(projectId, entry.revision)).size
          : null;
      const beforeSize = await size(previous),
        afterSize = await size(next);
      const metadataOnly =
        previous?.mode === gitModes.gitlink ||
        next?.mode === gitModes.gitlink ||
        previous?.mode === gitModes.symlink ||
        next?.mode === gitModes.symlink;
      const tooLarge = Math.max(beforeSize ?? 0, afterSize ?? 0) > 2 * 1024 * 1024;
      const oldPreview =
        previous && !metadataOnly && !tooLarge
          ? previewContent(
              path,
              await this.context.git.blob(projectId, previous.revision),
              this.context.codec,
            )
          : undefined;
      const newPreview =
        next && !metadataOnly && !tooLarge
          ? previewContent(
              path,
              await this.context.git.blob(projectId, next.revision),
              this.context.codec,
            )
          : undefined;
      const unavailableReason = metadataOnly
        ? '符号链接或子模块的内容请按 Git 文件类型处理。'
        : tooLarge
          ? '文件较大，暂不展开差异；Git 内容与文件模式均已保留。'
          : oldPreview && newPreview && oldPreview.kind !== newPreview.kind
            ? '文件内容类型发生变化，请导出原文件核对。'
            : (oldPreview?.unavailableReason ?? newPreview?.unavailableReason);
      result.push({
        path,
        status: !previous ? 'added' : !next ? 'deleted' : 'modified',
        kind: (newPreview ?? oldPreview)?.kind ?? 'binary',
        beforeSize,
        afterSize,
        beforeMode: previous?.mode ?? null,
        afterMode: next?.mode ?? null,
        before: unavailableReason ? '' : (oldPreview?.content ?? ''),
        after: unavailableReason ? '' : (newPreview?.content ?? ''),
        ...(unavailableReason ? { unavailableReason } : {}),
      });
    }
    return result;
  }
  statusValue(projectId: string, descriptors?: readonly ProjectFile[]): Promise<GitStatus> {
    return this.context.git.status(projectId, descriptors);
  }
  status(projectId: string): Promise<GitStatus> {
    return this.mutations.query(projectId, () => this.statusValue(projectId));
  }
  validPaths(paths: string[]) {
    if (!paths.length || paths.length > 2000 || new Set(paths).size !== paths.length)
      throw new AppError('VALIDATION', '工作区文件选择无效');
    for (const path of paths) safePath(path);
  }
  async ownedGitPaths(projectId: string, paths: string[], owner?: string, baseline?: GitBaseline) {
    this.validPaths(paths);
    if ((await this.context.git.repositoryInfo(projectId)).state !== 'none')
      throw new AppError('CONFLICT', '请先由用户完成正在进行的 Git 操作。');
    if (!owner) return;
    if (!baseline) throw new AppError('STORAGE', '工作区缺少任务基线');
    const touched = new Set(
      (await this.context.journal.owned(projectId, owner)).flatMap(
        operation => operation.changedPaths,
      ),
    );
    for (const path of paths) {
      if (!touched.has(path))
        throw new AppError('VALIDATION', '工作区 Git 工具只能处理本任务修改的文件：' + path);
      if (baseline.dirtyPaths.includes(path))
        throw new AppError(
          'VALIDATION',
          '工作区文件在任务开始前已有未提交更改，请由用户在 Git 面板处理：' + path,
        );
    }
  }
  async stage(
    projectId: string,
    paths: string[],
    expected: Pick<GitStatus, 'head' | 'indexRevision'> & {
      revisions: Record<string, string | null>;
    },
    owner?: string,
    baseline?: GitBaseline,
  ) {
    return this.mutations.serial(projectId, owner, async () => {
      await this.ownedGitPaths(projectId, paths, owner, baseline);
      const status = await this.statusValue(projectId);
      if (status.head !== expected.head || status.indexRevision !== expected.indexRevision)
        throw new AppError('CONFLICT', 'VERSION_CONFLICT：暂存区或提交已变化，请刷新');
      const index = await this.context.git.index(projectId),
        working = await this.context.git.workingTree(projectId, paths);
      for (const path of paths)
        if (
          !Object.hasOwn(expected.revisions, path) ||
          (working[path]?.revision ?? null) !== expected.revisions[path]
        )
          throw new AppError('CONFLICT', 'VERSION_CONFLICT：文件已变化，请重新读取');
      const proposed = await this.context.git.stageEntries(projectId, paths);
      const changes = paths
        .filter(path => !sameEntry(index[path], proposed[path]))
        .map(path => ({ path, before: index[path] ?? null, after: proposed[path] ?? null }));
      if (changes.length) await this.mutations.journalIndex(projectId, changes, '暂存文件', owner);
    });
  }
  async unstage(
    projectId: string,
    paths: string[],
    expected: Pick<GitStatus, 'head' | 'indexRevision'>,
    owner?: string,
    baseline?: GitBaseline,
  ) {
    return this.mutations.serial(projectId, owner, async () => {
      await this.ownedGitPaths(projectId, paths, owner, baseline);
      const status = await this.statusValue(projectId);
      if (status.head !== expected.head || status.indexRevision !== expected.indexRevision)
        throw new AppError('CONFLICT', 'VERSION_CONFLICT：暂存区或提交已变化，请刷新');
      const head = await this.context.git.tree(projectId, status.head),
        index = await this.context.git.index(projectId);
      const changes = paths
        .filter(path => !sameEntry(index[path], head[path]))
        .map(path => ({ path, before: index[path] ?? null, after: head[path] ?? null }));
      if (changes.length) await this.mutations.journalIndex(projectId, changes, '取消暂存', owner);
    });
  }
  async commitStaged(
    projectId: string,
    message: string,
    expected: Pick<GitStatus, 'head' | 'indexRevision'>,
    paths?: string[],
    owner?: string,
    baseline?: GitBaseline,
  ) {
    if (!message.trim() || message.length > 4000 || message.includes('AgentMobile-Operation:'))
      throw new AppError('VALIDATION', '提交说明需要 1–4,000 个字符，且不能包含内部操作标记');
    return this.mutations.serial(projectId, owner, async () => {
      const status = await this.statusValue(projectId);
      if (status.head !== expected.head || status.indexRevision !== expected.indexRevision)
        throw new AppError('CONFLICT', 'VERSION_CONFLICT：暂存区或提交已变化，请刷新');
      if (status.state !== 'none')
        throw new AppError('CONFLICT', '请先完成正在进行的 Git 操作，合并请使用继续合并。');
      if (status.files.some(file => file.conflict))
        throw new AppError('CONFLICT', '请先解决全部合并冲突。');
      const selected = paths ?? status.files.filter(file => file.staged).map(file => file.path);
      if (!selected.length) throw new AppError('VALIDATION', '暂存区没有可提交的更改');
      await this.ownedGitPaths(projectId, selected, owner, baseline);
      if (!selected.some(path => status.files.some(file => file.path === path && file.staged)))
        throw new AppError('VALIDATION', '暂存区没有可提交的更改');
      const tree = await this.context.git.tree(projectId, status.head),
        index = await this.context.git.index(projectId);
      for (const path of selected) {
        if (index[path]) tree[path] = index[path];
        else delete tree[path];
      }
      const id = this.context.id();
      const operation = await this.context.journal.prepare(
        {
          id,
          projectId,
          ownerRootRunId: owner,
          actorRunId: owner,
          kind: 'commit',
          expectedHead: status.head,
          checkpoint: await this.context.git.checkpoint(
            projectId,
            tree,
            'commits/' + id,
            status.head,
          ),
          message: message.trim(),
          phase: 'prepared',
          createdAt: new Date().toISOString(),
        },
        { changes: [] },
      );
      return this.mutations.apply(operation);
    });
  }
  diff(projectId: string, area: 'staged' | 'unstaged', paths?: string[]) {
    return this.mutations.query(projectId, async () => {
      if (paths) this.validPaths(paths);
      const status = await this.statusValue(projectId),
        index = (await this.context.git.indexState(projectId)).entries;
      if (paths?.some(path => status.files.some(file => file.path === path && file.conflict)))
        throw new AppError('CONFLICT', '冲突文件请使用三方预览。');
      const selected = status.files
        .filter(file => !file.conflict && file[area] && (!paths || paths.includes(file.path)))
        .map(file => file.path);
      return area === 'staged'
        ? this.treeChanges(
            projectId,
            await this.context.git.tree(projectId, status.head),
            index,
            selected,
          )
        : this.treeChanges(
            projectId,
            index,
            await this.context.git.workingTree(projectId, selected),
            selected,
          );
    });
  }
  discard(projectId: string, paths: string[], expected: GitStatus) {
    return this.mutations.serial(projectId, undefined, async () => {
      this.validPaths(paths);
      const status = await this.statusValue(projectId);
      if (
        status.head !== expected.head ||
        status.indexRevision !== expected.indexRevision ||
        status.workingRevision !== expected.workingRevision
      )
        throw new AppError('CONFLICT', 'VERSION_CONFLICT：文件或暂存区已变化，请刷新');
      const working = await this.context.git.workingTree(projectId, paths),
        index = await this.context.git.index(projectId);
      const changes = paths
        .filter(path => !sameEntry(working[path], index[path]))
        .map(path => ({ path, before: working[path] ?? null, after: index[path] ?? null }));
      if (changes.length)
        await this.mutations.prepare(projectId, changes, '丢弃未暂存更改', this.context.id());
    });
  }
}
