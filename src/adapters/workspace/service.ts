import { Buffer } from 'buffer';
import type { HostFileSystem, MetadataStore } from '@/core/storage/contracts';
import type { Operation, Project, ProjectFile, TaskRecord } from '@/core/prototype/types';
import type { GitBaseline, GitPort, GitStatus } from '@/core/git/contracts';
import { isImage, mimeFor, safePath } from '@/core/workspace/path';
import { validateImage } from '@/core/workspace/image';
import { createGitRepository } from '@/adapters/git/repository';
import { contentLimits } from '@/core/agent/settings';

const encode = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const decode = (value: string) => new Uint8Array(Buffer.from(value, 'base64'));
const MAX_FILE_BYTES = contentLimits.fileBytes;
export interface WorkspaceChange { projectId: string; paths: readonly string[]; commit: string }

export class WorkspaceService {
  readonly git: GitPort;
  readonly recoveryIssues: string[] = [];
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly owners = new Map<string, string>();
  private readonly blocked = new Set<string>();
  private readonly listeners = new Set<(change: WorkspaceChange) => void>();

  subscribe = (listener: (change: WorkspaceChange) => void): (() => void) => {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };
  private notify(change: WorkspaceChange) {
    const value = Object.freeze({ ...change, paths: Object.freeze([...change.paths]) });
    // View failures must not turn a committed operation into a recovery issue.
    try { this.changed(); } catch { /* Legacy observer is isolated. */ }
    for (const listener of this.listeners) { try { listener(value); } catch { /* Observers do not own writes. */ } }
  }

  constructor(
    private readonly fs: HostFileSystem,
    readonly metadata: MetadataStore,
    private readonly id: () => string,
    private readonly changed: () => void = () => {},
    git?: GitPort,
    private readonly automaticCommits = false,
  ) {
    this.git = git ?? createGitRepository(fs);
  }

  async projects() {
    return (await this.metadata.all<Project>('projects')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(name: string, requestedId?: string): Promise<Project> {
    if (requestedId && !/^[a-zA-Z0-9-]{1,80}$/.test(requestedId)) throw new Error('工作区标识无效');
    const project: Project = {
      id: requestedId ?? this.id(), name: name.trim().slice(0, 60) || '未命名项目',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await this.git.init(project.id);
    await this.fs.write(this.internal(project.id, 'project.json'), Buffer.from(JSON.stringify({
      name: project.name, formatVersion: 1,
    }, null, 2)));
    await this.fs.write(this.internal(project.id, 'documents/notes.md'), Buffer.from(
      '# 我的资料\n\n在这里写下你的想法，也可以导入文字和图片。\n',
    ));
    const commit = await this.git.commit(project.id, ['project.json', 'documents/notes.md'], '创建工作区');
    await this.metadata.put('projects', project.id, project);
    this.notify({ projectId: project.id, paths: ['project.json', 'documents/notes.md'], commit });
    return project;
  }

  private internal(projectId: string, path: string) {
    return this.git.dir(projectId) + '/' + safePath(path);
  }

  private async bytesOrNull(projectId: string, path: string) {
    try { return await this.fs.read(this.internal(projectId, path)); } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return null;
      throw error;
    }
  }

  async files(projectId: string): Promise<ProjectFile[]> {
    const files: ProjectFile[] = [];
    const walk = async (path: string) => {
      for (const name of await this.fs.list(this.git.dir(projectId) + (path ? '/' + path : ''))) {
        if (name === '.git') continue;
        const relative = safePath(path ? path + '/' + name : name);
        const info = await this.fs.stat(this.internal(projectId, relative));
        if (info.kind === 'directory') await walk(relative);
        else {
          const bytes = await this.fs.read(this.internal(projectId, relative));
          files.push({ path: relative, revision: await this.git.revision(bytes), size: bytes.length, mimeType: mimeFor(relative) });
        }
      }
    };
    await walk('');
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  async read(projectId: string, path: string) {
    const bytes = await this.fs.read(this.internal(projectId, path));
    if (bytes.length > MAX_FILE_BYTES) throw new Error('文件超过 20 MB 限制');
    return { bytes, revision: await this.git.revision(bytes) };
  }

  async readText(projectId: string, path: string) {
    if (isImage(path)) throw new Error('图片请通过图片工具读取');
    const { bytes, revision } = await this.read(projectId, path);
    if (bytes.length > contentLimits.textFileBytes) throw new Error('文本超过 1 MB 限制');
    return { text: Buffer.from(bytes).toString('utf8'), revision };
  }

  async preview(projectId: string, path: string) {
    const { bytes, revision } = await this.read(projectId, path);
    return { revision, content: isImage(path) ? 'data:' + mimeFor(path) + ';base64,' + encode(bytes) : Buffer.from(bytes).toString('utf8') };
  }

  /** Read a coherent working/index/HEAD view between queued mutations. */
  snapshot(projectId: string, openPath?: string) {
    const next = (this.queues.get(projectId) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const [files, versions, operations] = await Promise.all([
        this.files(projectId), this.git.log(projectId), this.metadata.all<Operation>('operations'),
      ]);
      const preview = openPath && files.some((file) => file.path === openPath) ?
        { path: openPath, ...await this.preview(projectId, openPath) } : undefined;
      return { files, versions, gitStatus: await this.statusValue(projectId), operations: operations.filter((operation) => operation.projectId === projectId && operation.phase === 'recorded'), preview };
    });
    this.queues.set(projectId, next); return next;
  }

  claim(projectId: string, owner: string) {
    if (this.owners.has(projectId)) throw new Error('工作区正在执行任务');
    if (this.blocked.has(projectId)) throw new Error('工作区需要修复，请保留本地数据');
    this.owners.set(projectId, owner);
  }

  release(projectId: string, owner: string) {
    if (this.owners.get(projectId) === owner) this.owners.delete(projectId);
  }

  needsRecovery(projectId: string) {
    return this.blocked.has(projectId);
  }

  private serial<T>(projectId: string, owner: string | undefined, action: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(projectId) ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (this.blocked.has(projectId)) throw new Error('恢复未完成，工作区写入已禁用');
      const active = this.owners.get(projectId);
      if (active && active !== owner) throw new Error('请等待或取消当前任务后再修改文件');
      if (!await this.metadata.get<Project>('projects', projectId)) throw new Error('工作区不存在');
      return action();
    });
    this.queues.set(projectId, next);
    return next;
  }

  async write(
    projectId: string, path: string, bytes: Uint8Array, expectedRevision: string | null,
    options: { owner?: string; operationId?: string; message?: string } = {},
  ) {
    safePath(path);
    if (path === 'project.json') throw new Error('项目配置由宿主管理');
    if (bytes.length > MAX_FILE_BYTES) throw new Error('文件超过 20 MB 限制');
    if (!isImage(path) && bytes.length > contentLimits.textFileBytes) throw new Error('文本超过 1 MB 限制');
    if (isImage(path)) validateImage(path, bytes);
    return this.serial(projectId, options.owner, async () => {
      const operationId = options.operationId ?? this.id();
      const existing = await this.metadata.get<Operation>('operations', operationId);
      if (existing) {
        if (existing.projectId !== projectId || existing.changes[0]?.path !== path || existing.changes[0]?.after !== encode(bytes)) {
          throw new Error('操作 ID 与原始修改不匹配');
        }
        return this.apply(existing);
      }
      const before = await this.bytesOrNull(projectId, path);
      const revision = before ? await this.git.revision(before) : null;
      if (revision !== expectedRevision) throw new Error('VERSION_CONFLICT：文件已变化，请重新读取。');
      if (before && encode(before) === encode(bytes)) return this.git.head(projectId);
      return this.prepare(projectId, [{ path, before: before ? encode(before) : null, after: encode(bytes) }],
        options.message ?? '修改 ' + path, operationId, options.owner);
    });
  }

  async remove(projectId: string, path: string, revision: string, owner?: string) {
    if (safePath(path) === 'project.json') throw new Error('项目配置由宿主管理');
    return this.serial(projectId, owner, async () => {
      const before = await this.read(projectId, path);
      if (before.revision !== revision) throw new Error('VERSION_CONFLICT：文件已变化');
      return this.prepare(projectId, [{ path, before: encode(before.bytes), after: null }], '删除 ' + path, this.id(), owner);
    });
  }

  async move(projectId: string, from: string, to: string, revision: string, owner?: string) {
    safePath(from); safePath(to);
    if (from === 'project.json' || to === 'project.json') throw new Error('项目配置由宿主管理');
    return this.serial(projectId, owner, async () => {
      const before = await this.read(projectId, from);
      if (before.revision !== revision) throw new Error('VERSION_CONFLICT：文件已变化');
      if (await this.bytesOrNull(projectId, to)) throw new Error('目标文件已存在');
      return this.prepare(projectId, [
        { path: from, before: encode(before.bytes), after: null },
        { path: to, before: null, after: encode(before.bytes) },
      ], '移动 ' + from + ' → ' + to, this.id(), owner);
    });
  }

  async restore(projectId: string, ref: string, expectedHead: string) {
    return this.serial(projectId, undefined, async () => {
      if (await this.git.head(projectId) !== expectedHead) throw new Error('历史已变化，请重新预览');
      if ((await this.statusValue(projectId)).files.length) throw new Error('工作区有未提交更改，请先提交或丢弃后再恢复版本');
      const target = await this.git.tree(projectId, ref);
      const current = await this.git.tree(projectId, expectedHead);
      const changes = [...new Set([...Object.keys(target), ...Object.keys(current)])].map((path) => ({
        path: safePath(path), before: current[path] ? encode(current[path]) : null, after: target[path] ? encode(target[path]) : null,
      })).filter((change) => change.before !== change.after);
      if (!changes.length) return expectedHead;
      return this.prepare(projectId, changes, '恢复版本 ' + ref.slice(0, 7), this.id());
    });
  }

  /** Host-only bulk replacement, using the same recoverable log and Git commit. */
  async replaceFiles(projectId: string, files: { path: string; bytes: Uint8Array | null }[], expectedHead: string, message: string) {
    for (const file of files) {
      if (safePath(file.path) === 'project.json') throw new Error('项目配置由宿主管理');
      if (file.bytes && file.bytes.length > MAX_FILE_BYTES) throw new Error('文件超过 20 MB 限制');
      if (file.bytes && isImage(file.path)) validateImage(file.path, file.bytes);
    }
    if (new Set(files.map((file) => file.path.toLowerCase())).size !== files.length) throw new Error('目标文件路径重复');
    return this.serial(projectId, undefined, async () => {
      if (await this.git.head(projectId) !== expectedHead) throw new Error('VERSION_CONFLICT：文件库已变化，请重新读取。');
      const changes: Operation['changes'] = [];
      for (const file of files) { const before = await this.bytesOrNull(projectId, file.path); const change = { path: file.path, before: before ? encode(before) : null, after: file.bytes ? encode(file.bytes) : null };
        if (change.before !== change.after) changes.push(change);
      }
      return changes.length ? this.prepare(projectId, changes, message, this.id()) : expectedHead;
    });
  }

  private async prepare(projectId: string, changes: Operation['changes'], message: string, id: string, runId?: string) {
    const operation: Operation = {
      kind: this.automaticCommits ? undefined : 'files',
      id, projectId, runId, expectedHead: await this.git.head(projectId), changes, message,
      phase: 'prepared', createdAt: new Date().toISOString(),
      sequence: await this.nextSequence(projectId),
    };
    await this.metadata.put('operations', id, operation);
    return this.apply(operation);
  }

  private async apply(operation: Operation): Promise<string> {
    if (operation.kind) return this.applySeparated(operation);
    if (operation.phase === 'recorded' && operation.commit) return operation.commit;
    try {
      const found = await this.git.findOperation(operation.projectId, operation.id);
      if (found) operation.commit = found;
      else {
        if (await this.git.head(operation.projectId) !== operation.expectedHead) throw new Error('恢复基线不匹配');
        for (const change of operation.changes) {
          const current = await this.bytesOrNull(operation.projectId, change.path);
          const value = current ? encode(current) : null;
          if (value !== change.before && value !== change.after) throw new Error('文件内容与恢复记录不匹配');
          if (value === change.after) continue;
          if (change.after === null) await this.fs.remove(this.internal(operation.projectId, change.path));
          else await this.fs.write(this.internal(operation.projectId, change.path), decode(change.after));
        }
        operation.phase = 'applied';
        await this.metadata.put('operations', operation.id, operation);
        operation.commit = await this.git.commit(operation.projectId, operation.changes.map((change) => change.path),
          operation.message + '\n\nAgentMobile-Operation: ' + operation.id);
      }
      operation.phase = 'committed';
      await this.metadata.put('operations', operation.id, operation);
      const project = await this.metadata.get<Project>('projects', operation.projectId);
      if (project) await this.metadata.put('projects', project.id, { ...project, updatedAt: new Date().toISOString() });
      operation.phase = 'recorded';
      await this.metadata.put('operations', operation.id, operation);
      this.notify({ projectId: operation.projectId, paths: operation.changes.map((change) => change.path), commit: operation.commit! });
      return operation.commit!;
    } catch (error) {
      this.blocked.add(operation.projectId);
      throw error;
    }
  }

  async recover() {
    const operations = (await this.metadata.all<Operation>('operations'))
      .filter((operation) => operation.phase !== 'recorded').sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.sequence ?? 0) - (b.sequence ?? 0));
    for (const operation of operations) {
      try { await this.apply(operation); } catch {
        this.recoveryIssues.push('项目 ' + operation.projectId.slice(0, 8) + ' 的修改需要恢复，已暂停写入。');
      }
    }
  }

  async changes(projectId: string, beforeRef: string | undefined, afterRef: string) {
    const before = beforeRef ? await this.git.tree(projectId, beforeRef) : {};
    const after = await this.git.tree(projectId, afterRef);
    return this.treeChanges(before, after);
  }

  private treeChanges(before: Record<string, Uint8Array>, after: Record<string, Uint8Array>) {
    const result = [];
    for (const path of [...new Set([...Object.keys(before), ...Object.keys(after)])]) {
      if (path === 'project.json') continue;
      if (encode(before[path] ?? new Uint8Array()) === encode(after[path] ?? new Uint8Array()) &&
        Boolean(before[path]) === Boolean(after[path])) continue;
      result.push({
        path, kind: !before[path] ? '新增' : !after[path] ? '删除' : '修改',
        before: before[path] ? (isImage(path) ? 'data:' + mimeFor(path) + ';base64,' + encode(before[path]) : Buffer.from(before[path]).toString('utf8')) : '',
        after: after[path] ? (isImage(path) ? 'data:' + mimeFor(path) + ';base64,' + encode(after[path]) : Buffer.from(after[path]).toString('utf8')) : '',
      });
    }
    return result;
  }

  private async workingTree(projectId: string) {
    const tree: Record<string, Uint8Array> = Object.create(null);
    for (const file of await this.files(projectId)) tree[file.path] = (await this.read(projectId, file.path)).bytes;
    return tree;
  }

  private async nextSequence(projectId: string) {
    return 1 + (await this.metadata.all<Operation>('operations')).filter((operation) => operation.projectId === projectId).reduce((max, operation) => Math.max(max, operation.sequence ?? 0), 0);
  }

  private async indexTree(projectId: string) {
    const tree: Record<string, Uint8Array> = Object.create(null);
    for (const [path, oid] of Object.entries(await this.git.index(projectId))) tree[path] = await this.git.blob(projectId, oid);
    return tree;
  }

  private fingerprint(entries: Record<string, string>) {
    return this.git.revision(Buffer.from(JSON.stringify(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)))));
  }

  private async statusValue(projectId: string): Promise<GitStatus> {
    const head = await this.git.head(projectId);
    const committed = Object.fromEntries((await this.git.entries(projectId, head)).map((file) => [file.path, file.revision]));
    const index = await this.git.index(projectId);
    const working = Object.fromEntries((await this.files(projectId)).map((file) => [file.path, file.revision]));
    const change = (before: string | null, after: string | null) => before === after ? undefined : !before ? 'added' as const : !after ? 'deleted' as const : 'modified' as const;
    const files = [...new Set([...Object.keys(committed), ...Object.keys(index), ...Object.keys(working)])].sort().filter((path) => path !== 'project.json').map((path) => {
      const headRevision = committed[path] ?? null; const indexRevision = index[path] ?? null; const workingRevision = working[path] ?? null;
      return { path, headRevision, indexRevision, workingRevision, staged: change(headRevision, indexRevision), unstaged: change(indexRevision, workingRevision) };
    }).filter((file) => file.staged || file.unstaged);
    return { head, files, indexRevision: await this.fingerprint(index), workingRevision: await this.fingerprint(working) };
  }

  /** Serialized read; observers may inspect a project while its Agent owns writes. */
  status(projectId: string): Promise<GitStatus> {
    const next = (this.queues.get(projectId) ?? Promise.resolve()).catch(() => {}).then(() => this.statusValue(projectId));
    this.queues.set(projectId, next); return next;
  }

  private async applySeparated(operation: Operation): Promise<string> {
    if (operation.phase === 'recorded') return operation.kind === 'commit' ? operation.commit! : operation.checkpoint!;
    const projectId = operation.projectId;
    try {
      if (operation.kind === 'commit') {
        const found = await this.git.findOperation(projectId, operation.id);
        operation.commit = found ?? await this.git.commitSnapshot(projectId, operation.checkpoint!, operation.message + '\n\nAgentMobile-Operation: ' + operation.id, operation.expectedHead);
        operation.phase = 'committed';
      } else {
        if (await this.git.head(projectId) !== operation.expectedHead) throw new Error('恢复基线不匹配');
        for (const change of operation.changes) {
          const current = await this.bytesOrNull(projectId, change.path); const value = current ? encode(current) : null;
          if (value !== change.before && value !== change.after) throw new Error('文件内容与恢复记录不匹配');
          if (value === change.after) continue;
          if (change.after === null) await this.fs.remove(this.internal(projectId, change.path));
          else await this.fs.write(this.internal(projectId, change.path), decode(change.after));
        }
        const index = await this.git.index(projectId);
        for (const change of operation.indexChanges ?? []) {
          const value = index[change.path] ?? null;
          if (value !== change.before && value !== change.after) throw new Error('暂存区与恢复记录不匹配');
          if (value !== change.after) await this.git.setIndex(projectId, { [change.path]: change.after });
        }
        operation.phase = 'applied'; await this.metadata.put('operations', operation.id, operation);
        operation.checkpoint = await this.git.checkpoint(projectId, await this.workingTree(projectId), 'operations/' + Buffer.from(operation.id).toString('hex'), operation.expectedHead);
        operation.phase = 'checkpointed';
      }
      await this.metadata.put('operations', operation.id, operation);
      const project = await this.metadata.get<Project>('projects', projectId);
      if (project) await this.metadata.put('projects', projectId, { ...project, updatedAt: new Date().toISOString() });
      operation.phase = 'recorded'; await this.metadata.put('operations', operation.id, operation);
      this.notify({ projectId, paths: [...new Set([...operation.changes.map((change) => change.path), ...(operation.indexChanges ?? []).map((change) => change.path)])], commit: await this.git.head(projectId) });
      return operation.kind === 'commit' ? operation.commit! : operation.checkpoint!;
    } catch (error) { this.blocked.add(projectId); throw error; }
  }

  private async journalIndex(projectId: string, changes: NonNullable<Operation['indexChanges']>, message: string, owner?: string, files: Operation['changes'] = []) {
    const id = this.id(); const head = await this.git.head(projectId); const before = await this.indexTree(projectId); const after = { ...before };
    for (const change of changes) { if (change.after) after[change.path] = await this.git.blob(projectId, change.after); else delete after[change.path]; }
    const operation: Operation = { id, projectId, runId: owner, kind: files.length ? 'files' : 'index', expectedHead: head, changes: files, indexChanges: changes,
      indexBefore: await this.git.checkpoint(projectId, before, 'index/' + id + '/before', head),
      indexAfter: await this.git.checkpoint(projectId, after, 'index/' + id + '/after', head),
      message, phase: 'prepared', createdAt: new Date().toISOString(), sequence: await this.nextSequence(projectId) };
    await this.metadata.put('operations', id, operation); return this.apply(operation);
  }

  private validPaths(paths: string[]) {
    if (!paths.length || paths.length > 2000 || new Set(paths).size !== paths.length) throw new Error('工作区文件选择无效');
    for (const path of paths) if (safePath(path) === 'project.json') throw new Error('项目配置由宿主管理');
  }

  private async ownedGitPaths(projectId: string, paths: string[], owner?: string, baseline?: GitBaseline) {
    this.validPaths(paths);
    if (!owner) return;
    if (!baseline) throw new Error('工作区缺少任务基线');
    const touched = new Set((await this.metadata.all<Operation>('operations')).filter((op) => op.projectId === projectId && op.runId === owner && op.phase === 'recorded')
      .flatMap((op) => op.changes.map((change) => change.path)));
    const [head, working, index] = await Promise.all([this.git.tree(projectId, baseline.head), this.git.tree(projectId, baseline.working), this.git.tree(projectId, baseline.index)]);
    for (const path of paths) {
      if (!touched.has(path)) throw new Error('工作区 Git 工具只能处理本任务修改的文件：' + path);
      if (encode(head[path] ?? new Uint8Array()) !== encode(working[path] ?? new Uint8Array()) || !!head[path] !== !!working[path] ||
          encode(head[path] ?? new Uint8Array()) !== encode(index[path] ?? new Uint8Array()) || !!head[path] !== !!index[path])
        throw new Error('工作区文件在任务开始前已有未提交更改，请由用户在 Git 面板处理：' + path);
    }
  }

  async stage(projectId: string, paths: string[], expected: Pick<GitStatus, 'head' | 'indexRevision'> & { revisions: Record<string, string | null> }, owner?: string, baseline?: GitBaseline) {
    return this.serial(projectId, owner, async () => {
      await this.ownedGitPaths(projectId, paths, owner, baseline); const status = await this.statusValue(projectId);
      if (status.head !== expected.head || status.indexRevision !== expected.indexRevision) throw new Error('VERSION_CONFLICT：暂存区或提交已变化，请刷新');
      const index = await this.git.index(projectId); const working = await this.workingTree(projectId);
      const changes: NonNullable<Operation['indexChanges']> = [];
      for (const path of paths) {
        const revision = working[path] ? await this.git.revision(working[path]) : null;
        if (!Object.hasOwn(expected.revisions, path) || revision !== expected.revisions[path]) throw new Error('VERSION_CONFLICT：文件已变化，请重新读取');
        if ((index[path] ?? null) !== revision) changes.push({ path, before: index[path] ?? null, after: revision });
      }
      if (!changes.length) return;
      // Materialize blobs without touching the real index.
      await this.git.checkpoint(projectId, working, 'staging/' + this.id(), status.head);
      await this.journalIndex(projectId, changes, '暂存文件', owner);
    });
  }

  async unstage(projectId: string, paths: string[], expected: Pick<GitStatus, 'head' | 'indexRevision'>, owner?: string, baseline?: GitBaseline) {
    return this.serial(projectId, owner, async () => {
      await this.ownedGitPaths(projectId, paths, owner, baseline); const status = await this.statusValue(projectId);
      if (status.head !== expected.head || status.indexRevision !== expected.indexRevision) throw new Error('VERSION_CONFLICT：暂存区或提交已变化，请刷新');
      const head = Object.fromEntries((await this.git.entries(projectId, status.head)).map((file) => [file.path, file.revision])); const index = await this.git.index(projectId);
      const changes = paths.map((path) => ({ path, before: index[path] ?? null, after: head[path] ?? null })).filter((change) => change.before !== change.after);
      if (changes.length) await this.journalIndex(projectId, changes, '取消暂存', owner);
    });
  }

  async commitStaged(projectId: string, message: string, expected: Pick<GitStatus, 'head' | 'indexRevision'>, paths?: string[], owner?: string, baseline?: GitBaseline) {
    if (!message.trim() || message.length > 4000 || message.includes('AgentMobile-Operation:')) throw new Error('提交说明需要 1–4,000 个字符，且不能包含内部操作标记');
    return this.serial(projectId, owner, async () => {
      const status = await this.statusValue(projectId);
      if (status.head !== expected.head || status.indexRevision !== expected.indexRevision) throw new Error('VERSION_CONFLICT：暂存区或提交已变化，请刷新');
      const selected = paths ?? status.files.filter((file) => file.staged).map((file) => file.path);
      if (!selected.length) throw new Error('暂存区没有可提交的更改');
      await this.ownedGitPaths(projectId, selected, owner, baseline);
      if (!selected.some((path) => status.files.some((file) => file.path === path && file.staged))) throw new Error('暂存区没有可提交的更改');
      const tree = await this.git.tree(projectId, status.head); const index = await this.indexTree(projectId);
      for (const path of selected) { if (index[path]) tree[path] = index[path]; else delete tree[path]; }
      const id = this.id(); const operation: Operation = { id, projectId, runId: owner, kind: 'commit', changes: [], expectedHead: status.head,
        checkpoint: await this.git.checkpoint(projectId, tree, 'commits/' + id, status.head), message: message.trim(), phase: 'prepared', createdAt: new Date().toISOString(), sequence: await this.nextSequence(projectId) };
      await this.metadata.put('operations', id, operation); return this.apply(operation);
    });
  }

  diff(projectId: string, area: 'staged' | 'unstaged', paths?: string[]) {
    const next = (this.queues.get(projectId) ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (paths) this.validPaths(paths);
      const index = await this.indexTree(projectId);
      const changes = area === 'staged' ? this.treeChanges(await this.git.tree(projectId, await this.git.head(projectId)), index) : this.treeChanges(index, await this.workingTree(projectId));
      return paths ? changes.filter((change) => paths.includes(change.path)) : changes;
    }); this.queues.set(projectId, next); return next;
  }

  discard(projectId: string, paths: string[], expected: GitStatus) {
    return this.serial(projectId, undefined, async () => {
      this.validPaths(paths); const status = await this.statusValue(projectId);
      if (status.head !== expected.head || status.indexRevision !== expected.indexRevision || status.workingRevision !== expected.workingRevision) throw new Error('VERSION_CONFLICT：文件或暂存区已变化，请刷新');
      const working = await this.workingTree(projectId); const index = await this.indexTree(projectId);
      const changes = paths.map((path) => ({ path, before: working[path] ? encode(working[path]) : null, after: index[path] ? encode(index[path]) : null })).filter((change) => change.before !== change.after);
      if (changes.length) await this.prepare(projectId, changes, '丢弃未暂存更改', this.id());
    });
  }

  taskBaseline(projectId: string, taskId: string): Promise<GitBaseline> {
    return this.serial(projectId, taskId, async () => {
      const head = await this.git.head(projectId);
      return { head, working: await this.git.checkpoint(projectId, await this.workingTree(projectId), 'tasks/' + taskId + '/base', head),
        index: await this.git.checkpoint(projectId, await this.indexTree(projectId), 'tasks/' + taskId + '/base-index', head) };
    });
  }

  async taskFinal(task: TaskRecord, recovering = false): Promise<TaskRecord> {
    if (!task.baseSnapshot || !task.baseIndexSnapshot) return { ...task, finalCommit: await this.git.head(task.projectId) };
    const own = (await this.metadata.all<Operation>('operations')).filter((op) => op.projectId === task.projectId && op.runId === task.id && op.phase === 'recorded')
      .sort((a, b) => a.sequence !== undefined && b.sequence !== undefined ? a.sequence - b.sequence : a.createdAt.localeCompare(b.createdAt));
    const head = recovering ? [...own].reverse().find((op) => op.kind === 'commit')?.commit ?? task.baseCommit : await this.git.head(task.projectId);
    const lastFiles = [...own].reverse().find((op) => op.kind === 'files'); const lastIndex = [...own].reverse().find((op) => op.indexAfter);
    const working = recovering ? await this.git.tree(task.projectId, lastFiles?.checkpoint ?? task.baseSnapshot) : await this.workingTree(task.projectId);
    const index = recovering ? await this.git.tree(task.projectId, lastIndex?.indexAfter ?? task.baseIndexSnapshot) : await this.indexTree(task.projectId);
    const finalSnapshot = await this.git.checkpoint(task.projectId, working, 'tasks/' + task.id + '/final', head);
    const finalIndexSnapshot = await this.git.checkpoint(task.projectId, index, 'tasks/' + task.id + '/final-index', head);
    const changes = await this.changes(task.projectId, task.baseSnapshot, finalSnapshot);
    const indexChanges = await this.changes(task.projectId, task.baseIndexSnapshot, finalIndexSnapshot);
    const touched = new Set(own.flatMap((op) => op.changes.map((change) => change.path)));
    const changedPaths = [...new Set([...changes, ...indexChanges].filter((change) => touched.has(change.path)).map((change) => change.path))];
    const uncommitted = await this.changes(task.projectId, head, finalSnapshot);
    const staged = await this.changes(task.projectId, head, finalIndexSnapshot);
    return { ...task, finalCommit: head, finalSnapshot, finalIndexSnapshot, changedPaths,
      uncommittedPaths: [...new Set([...uncommitted, ...staged].filter((change) => changedPaths.includes(change.path)).map((change) => change.path))] };
  }

  async taskChanges(task: TaskRecord) {
    const changes = await this.changes(task.projectId, task.baseSnapshot ?? task.baseCommit, task.finalSnapshot ?? task.finalCommit ?? task.baseCommit);
    if (task.baseIndexSnapshot && task.finalIndexSnapshot) {
      for (const change of await this.changes(task.projectId, task.baseIndexSnapshot, task.finalIndexSnapshot)) {
        if (!changes.some((file) => file.path === change.path)) changes.push({ ...change, kind: '暂存' + change.kind });
      }
    }
    return task.changedPaths ? changes.filter((file) => task.changedPaths!.includes(file.path)) : changes;
  }

  undoTask(task: TaskRecord) {
    return this.serial(task.projectId, undefined, async () => {
      const beforeRef = task.baseSnapshot ?? task.baseCommit; const afterRef = task.finalSnapshot ?? task.finalCommit;
      if (!afterRef) throw new Error('工作区任务尚无可撤销结果');
      const [before, after, working, index] = await Promise.all([this.git.tree(task.projectId, beforeRef), this.git.tree(task.projectId, afterRef), this.workingTree(task.projectId), this.indexTree(task.projectId)]);
      const baseIndex = task.baseIndexSnapshot ? await this.git.tree(task.projectId, task.baseIndexSnapshot) : before;
      const finalIndex = task.finalIndexSnapshot ? await this.git.tree(task.projectId, task.finalIndexSnapshot) : after;
      const paths = task.changedPaths ?? this.treeChanges(before, after).map((change) => change.path);
      const files: Operation['changes'] = []; const entries: NonNullable<Operation['indexChanges']> = [];
      for (const path of paths) {
        const value = (tree: Record<string, Uint8Array>) => tree[path] ? encode(tree[path]) : null;
        if (value(working) !== value(after) || value(index) !== value(finalIndex)) throw new Error('VERSION_CONFLICT：任务文件或暂存区已有后续修改，不能撤销：' + path);
        if (value(before) !== value(working)) files.push({ path, before: value(working), after: value(before) });
        if (value(baseIndex) !== value(index)) entries.push({ path, before: index[path] ? await this.git.revision(index[path]) : null, after: baseIndex[path] ? await this.git.revision(baseIndex[path]) : null });
      }
      if (files.length || entries.length) await this.journalIndex(task.projectId, entries, '撤销任务修改', undefined, files);
    });
  }
}
