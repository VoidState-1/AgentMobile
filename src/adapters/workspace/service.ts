import { Buffer } from 'buffer';
import type { HostFileSystem, MetadataStore } from '@/core/storage/contracts';
import type { Operation, Project, ProjectFile } from '@/core/prototype/types';
import type { GitPort } from '@/core/git/contracts';
import { isImage, mimeFor, safePath } from '@/core/workspace/path';
import { validateImage } from '@/core/workspace/image';
import { createGitRepository } from '@/adapters/git/repository';

const encode = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const decode = (value: string) => new Uint8Array(Buffer.from(value, 'base64'));
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export class WorkspaceService {
  readonly git: GitPort;
  readonly recoveryIssues: string[] = [];
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly owners = new Map<string, string>();
  private readonly blocked = new Set<string>();

  constructor(
    private readonly fs: HostFileSystem,
    readonly metadata: MetadataStore,
    private readonly id: () => string,
    private readonly changed: () => void = () => {},
    git?: GitPort,
  ) {
    this.git = git ?? createGitRepository(fs);
  }

  async projects() {
    return (await this.metadata.all<Project>('projects')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(name: string): Promise<Project> {
    const project: Project = {
      id: this.id(), name: name.trim().slice(0, 60) || '未命名项目',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await this.git.init(project.id);
    await this.fs.write(this.internal(project.id, 'project.json'), Buffer.from(JSON.stringify({
      name: project.name, formatVersion: 1,
    }, null, 2)));
    await this.fs.write(this.internal(project.id, 'documents/notes.md'), Buffer.from(
      '# 我的资料\n\n在这里写下你的想法，也可以导入文字和图片。\n',
    ));
    await this.git.commit(project.id, ['project.json', 'documents/notes.md'], '创建工作区');
    await this.metadata.put('projects', project.id, project);
    this.changed();
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
    if (bytes.length > MAX_FILE_BYTES) throw new Error('文件超过原型的 5 MB 限制');
    return { bytes, revision: await this.git.revision(bytes) };
  }

  async readText(projectId: string, path: string) {
    if (isImage(path)) throw new Error('图片请通过图片工具读取');
    const { bytes, revision } = await this.read(projectId, path);
    if (bytes.length > 256 * 1024) throw new Error('文本超过 256 KB 限制');
    return { text: Buffer.from(bytes).toString('utf8'), revision };
  }

  async preview(projectId: string, path: string) {
    const { bytes, revision } = await this.read(projectId, path);
    return { revision, content: isImage(path) ? 'data:' + mimeFor(path) + ';base64,' + encode(bytes) : Buffer.from(bytes).toString('utf8') };
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
    if (bytes.length > MAX_FILE_BYTES) throw new Error('文件超过 5 MB 限制');
    if (!isImage(path) && bytes.length > 256 * 1024) throw new Error('文本超过 256 KB 限制');
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
      const target = await this.git.tree(projectId, ref);
      const current = await this.git.tree(projectId, expectedHead);
      const changes = [...new Set([...Object.keys(target), ...Object.keys(current)])].map((path) => ({
        path: safePath(path), before: current[path] ? encode(current[path]) : null, after: target[path] ? encode(target[path]) : null,
      })).filter((change) => change.before !== change.after);
      if (!changes.length) return expectedHead;
      return this.prepare(projectId, changes, '恢复版本 ' + ref.slice(0, 7), this.id());
    });
  }

  private async prepare(projectId: string, changes: Operation['changes'], message: string, id: string, runId?: string) {
    const operation: Operation = {
      id, projectId, runId, expectedHead: await this.git.head(projectId), changes, message,
      phase: 'prepared', createdAt: new Date().toISOString(),
    };
    await this.metadata.put('operations', id, operation);
    return this.apply(operation);
  }

  private async apply(operation: Operation): Promise<string> {
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
      this.changed();
      return operation.commit!;
    } catch (error) {
      this.blocked.add(operation.projectId);
      throw error;
    }
  }

  async recover() {
    const operations = (await this.metadata.all<Operation>('operations'))
      .filter((operation) => operation.phase !== 'recorded').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const operation of operations) {
      try { await this.apply(operation); } catch {
        this.recoveryIssues.push('项目 ' + operation.projectId.slice(0, 8) + ' 的修改需要恢复，已暂停写入。');
      }
    }
  }

  async changes(projectId: string, beforeRef: string, afterRef: string) {
    const before = await this.git.tree(projectId, beforeRef);
    const after = await this.git.tree(projectId, afterRef);
    const result = [];
    for (const path of [...new Set([...Object.keys(before), ...Object.keys(after)])]) {
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
}
