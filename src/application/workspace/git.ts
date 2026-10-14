import type { WorkspaceContext } from './context';
import type { Operation } from '@/core/workspace/types';
import type { GitBaseline, GitStatus } from '@/core/git/contracts';
import { safePath, isImage, mimeFor } from '@/core/workspace/path';
import type { WorkspaceReader } from './reader';
import type { MutationCoordinator } from './mutations';

export class GitService {
  constructor(private readonly context: WorkspaceContext, private readonly reader: WorkspaceReader, private readonly mutations: MutationCoordinator) {}
  async restore(projectId: string, ref: string, expectedHead: string) {
    return this.mutations.serial(projectId, undefined, async () => {
      if (await this.context.git.head(projectId) !== expectedHead) throw new Error('历史已变化，请重新预览');
      if ((await this.statusValue(projectId)).files.length) throw new Error('工作区有未提交更改，请先提交或丢弃后再恢复版本');
      const target = await this.context.git.tree(projectId, ref);
      const current = await this.context.git.tree(projectId, expectedHead);
      const changes = [...new Set([...Object.keys(target), ...Object.keys(current)])].map((path) => ({
        path: safePath(path), before: current[path] ? this.context.codec.encodeBase64(current[path]) : null, after: target[path] ? this.context.codec.encodeBase64(target[path]) : null,
      })).filter((change) => change.before !== change.after);
      if (!changes.length) return expectedHead;
      return this.mutations.prepare(projectId, changes, '恢复版本 ' + ref.slice(0, 7), this.context.id());
    });
  }

  async changes(projectId: string, beforeRef: string | undefined, afterRef: string) {
    const before = beforeRef ? await this.context.git.tree(projectId, beforeRef) : {};
    const after = await this.context.git.tree(projectId, afterRef);
    return this.treeChanges(before, after);
  }

  treeChanges(before: Record<string, Uint8Array>, after: Record<string, Uint8Array>) {
    const result = [];
    for (const path of [...new Set([...Object.keys(before), ...Object.keys(after)])]) {
      if (path === 'project.json') continue;
      if (this.context.codec.encodeBase64(before[path] ?? new Uint8Array()) === this.context.codec.encodeBase64(after[path] ?? new Uint8Array()) &&
        Boolean(before[path]) === Boolean(after[path])) continue;
      result.push({
        path, kind: !before[path] ? '新增' : !after[path] ? '删除' : '修改',
        before: before[path] ? (isImage(path) ? 'data:' + mimeFor(path) + ';base64,' + this.context.codec.encodeBase64(before[path]) : this.context.codec.decodeText(before[path])) : '',
        after: after[path] ? (isImage(path) ? 'data:' + mimeFor(path) + ';base64,' + this.context.codec.encodeBase64(after[path]) : this.context.codec.decodeText(after[path])) : '',
      });
    }
    return result;
  }

  fingerprint(entries: Record<string, string>) {
    return this.context.git.revision(this.context.codec.encodeText(JSON.stringify(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)))));
  }

  async statusValue(projectId: string): Promise<GitStatus> {
    const head = await this.context.git.head(projectId);
    const committed = Object.fromEntries((await this.context.git.entries(projectId, head)).map((file) => [file.path, file.revision]));
    const index = await this.context.git.index(projectId);
    const working = Object.fromEntries((await this.reader.files(projectId)).map((file) => [file.path, file.revision]));
    const change = (before: string | null, after: string | null) => before === after ? undefined : !before ? 'added' as const : !after ? 'deleted' as const : 'modified' as const;
    const files = [...new Set([...Object.keys(committed), ...Object.keys(index), ...Object.keys(working)])].sort().filter((path) => path !== 'project.json').map((path) => {
      const headRevision = committed[path] ?? null; const indexRevision = index[path] ?? null; const workingRevision = working[path] ?? null;
      return { path, headRevision, indexRevision, workingRevision, staged: change(headRevision, indexRevision), unstaged: change(indexRevision, workingRevision) };
    }).filter((file) => file.staged || file.unstaged);
    return { head, files, indexRevision: await this.fingerprint(index), workingRevision: await this.fingerprint(working) };
  }

  status(projectId: string): Promise<GitStatus> { return this.mutations.query(projectId, () => this.statusValue(projectId)); }

  validPaths(paths: string[]) {
    if (!paths.length || paths.length > 2000 || new Set(paths).size !== paths.length) throw new Error('工作区文件选择无效');
    for (const path of paths) if (safePath(path) === 'project.json') throw new Error('项目配置由宿主管理');
  }

  async ownedGitPaths(projectId: string, paths: string[], owner?: string, baseline?: GitBaseline) {
    this.validPaths(paths);
    if (!owner) return;
    if (!baseline) throw new Error('工作区缺少任务基线');
    const touched = new Set((await this.context.metadata.all<Operation>('operations')).filter((op) => op.projectId === projectId && op.runId === owner && op.phase === 'recorded')
      .flatMap((op) => op.changes.map((change) => change.path)));
    const [head, working, index] = await Promise.all([this.context.git.tree(projectId, baseline.head), this.context.git.tree(projectId, baseline.working), this.context.git.tree(projectId, baseline.index)]);
    for (const path of paths) {
      if (!touched.has(path)) throw new Error('工作区 Git 工具只能处理本任务修改的文件：' + path);
      if (this.context.codec.encodeBase64(head[path] ?? new Uint8Array()) !== this.context.codec.encodeBase64(working[path] ?? new Uint8Array()) || !!head[path] !== !!working[path] ||
          this.context.codec.encodeBase64(head[path] ?? new Uint8Array()) !== this.context.codec.encodeBase64(index[path] ?? new Uint8Array()) || !!head[path] !== !!index[path])
        throw new Error('工作区文件在任务开始前已有未提交更改，请由用户在 Git 面板处理：' + path);
    }
  }

  async stage(projectId: string, paths: string[], expected: Pick<GitStatus, 'head' | 'indexRevision'> & { revisions: Record<string, string | null> }, owner?: string, baseline?: GitBaseline) {
    return this.mutations.serial(projectId, owner, async () => {
      await this.ownedGitPaths(projectId, paths, owner, baseline); const status = await this.statusValue(projectId);
      if (status.head !== expected.head || status.indexRevision !== expected.indexRevision) throw new Error('VERSION_CONFLICT：暂存区或提交已变化，请刷新');
      const index = await this.context.git.index(projectId); const working = await this.reader.workingTree(projectId);
      const changes: NonNullable<Operation['indexChanges']> = [];
      for (const path of paths) {
        const revision = working[path] ? await this.context.git.revision(working[path]) : null;
        if (!Object.hasOwn(expected.revisions, path) || revision !== expected.revisions[path]) throw new Error('VERSION_CONFLICT：文件已变化，请重新读取');
        if ((index[path] ?? null) !== revision) changes.push({ path, before: index[path] ?? null, after: revision });
      }
      if (!changes.length) return;
      // Materialize blobs without touching the real index.
      await this.context.git.checkpoint(projectId, working, 'staging/' + this.context.id(), status.head);
      await this.mutations.journalIndex(projectId, changes, '暂存文件', owner);
    });
  }

  async unstage(projectId: string, paths: string[], expected: Pick<GitStatus, 'head' | 'indexRevision'>, owner?: string, baseline?: GitBaseline) {
    return this.mutations.serial(projectId, owner, async () => {
      await this.ownedGitPaths(projectId, paths, owner, baseline); const status = await this.statusValue(projectId);
      if (status.head !== expected.head || status.indexRevision !== expected.indexRevision) throw new Error('VERSION_CONFLICT：暂存区或提交已变化，请刷新');
      const head = Object.fromEntries((await this.context.git.entries(projectId, status.head)).map((file) => [file.path, file.revision])); const index = await this.context.git.index(projectId);
      const changes = paths.map((path) => ({ path, before: index[path] ?? null, after: head[path] ?? null })).filter((change) => change.before !== change.after);
      if (changes.length) await this.mutations.journalIndex(projectId, changes, '取消暂存', owner);
    });
  }

  async commitStaged(projectId: string, message: string, expected: Pick<GitStatus, 'head' | 'indexRevision'>, paths?: string[], owner?: string, baseline?: GitBaseline) {
    if (!message.trim() || message.length > 4000 || message.includes('AgentMobile-Operation:')) throw new Error('提交说明需要 1–4,000 个字符，且不能包含内部操作标记');
    return this.mutations.serial(projectId, owner, async () => {
      const status = await this.statusValue(projectId);
      if (status.head !== expected.head || status.indexRevision !== expected.indexRevision) throw new Error('VERSION_CONFLICT：暂存区或提交已变化，请刷新');
      const selected = paths ?? status.files.filter((file) => file.staged).map((file) => file.path);
      if (!selected.length) throw new Error('暂存区没有可提交的更改');
      await this.ownedGitPaths(projectId, selected, owner, baseline);
      if (!selected.some((path) => status.files.some((file) => file.path === path && file.staged))) throw new Error('暂存区没有可提交的更改');
      const tree = await this.context.git.tree(projectId, status.head); const index = await this.mutations.indexTree(projectId);
      for (const path of selected) { if (index[path]) tree[path] = index[path]; else delete tree[path]; }
      const id = this.context.id(); const operation: Operation = { id, projectId, runId: owner, ownerRootRunId: owner, actorRunId: owner, kind: 'commit', changes: [], expectedHead: status.head,
        checkpoint: await this.context.git.checkpoint(projectId, tree, 'commits/' + id, status.head), message: message.trim(), phase: 'prepared', createdAt: new Date().toISOString(), sequence: await this.mutations.nextSequence(projectId) };
      await this.context.metadata.put('operations', id, operation); return this.mutations.apply(operation);
    });
  }

  diff(projectId: string, area: 'staged' | 'unstaged', paths?: string[]) {
    return this.mutations.query(projectId, async () => {
      if (paths) this.validPaths(paths);
      const index = await this.mutations.indexTree(projectId);
      const changes = area === 'staged' ? this.treeChanges(await this.context.git.tree(projectId, await this.context.git.head(projectId)), index) : this.treeChanges(index, await this.reader.workingTree(projectId));
      return paths ? changes.filter((change) => paths.includes(change.path)) : changes;
    });
  }

  discard(projectId: string, paths: string[], expected: GitStatus) {
    return this.mutations.serial(projectId, undefined, async () => {
      this.validPaths(paths); const status = await this.statusValue(projectId);
      if (status.head !== expected.head || status.indexRevision !== expected.indexRevision || status.workingRevision !== expected.workingRevision) throw new Error('VERSION_CONFLICT：文件或暂存区已变化，请刷新');
      const working = await this.reader.workingTree(projectId); const index = await this.mutations.indexTree(projectId);
      const changes = paths.map((path) => ({ path, before: working[path] ? this.context.codec.encodeBase64(working[path]) : null, after: index[path] ? this.context.codec.encodeBase64(index[path]) : null })).filter((change) => change.before !== change.after);
      if (changes.length) await this.mutations.prepare(projectId, changes, '丢弃未暂存更改', this.context.id());
    });
  }
}
