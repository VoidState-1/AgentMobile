import { AppError } from '@/core/errors';
import type { WorkspaceContext } from './context';
import type { Project } from '@/core/projects';
import type { Operation } from '@/core/workspace/journal';
import type { CandidateMergeInput, CandidateMergeResult } from '@/core/runs/proposals';
import { safePath, isImage } from '@/core/workspace/path';
import { validateImage } from '@/core/workspace/image';
import { contentLimits } from '@/core/agent/settings';
import type { WorkspaceReader } from './reader';
import type { MutationCoordinator } from './mutations';

const MAX_FILE_BYTES = contentLimits.fileBytes;
export class FileCommands {
  constructor(private readonly context: WorkspaceContext, private readonly reader: WorkspaceReader, private readonly mutations: MutationCoordinator) {}
  mergeCandidate(projectId: string, input: CandidateMergeInput, beforeApply?: () => Promise<void>): Promise<CandidateMergeResult> {
    for (const path of input.paths) if (safePath(path).toLowerCase() === 'project.json') throw new AppError('VALIDATION', '项目配置由宿主管理');
    if (new Set(input.paths.map((path) => path.toLowerCase())).size !== input.paths.length) throw new AppError('VALIDATION', '目标文件路径重复');
    return this.mutations.serial(projectId, input.rootRunId, async () => {
      const receipt = await this.context.journal.get(projectId, input.operationId);
      if (receipt) {
        if (receipt.ownerRootRunId !== input.rootRunId || receipt.proposalId !== input.proposalId || receipt.actorRunId !== input.actorRunId) throw new AppError('CONFLICT', '操作 ID 与原始提案不匹配');
        return { conflicts: [], changedPaths: receipt.changes.map((change) => change.path), checkpoint: await this.mutations.apply(receipt) };
      }
      const base = await this.context.git.tree(projectId, input.baseSnapshot); const candidate = await this.context.git.tree(projectId, input.candidateSnapshot);
      const value = (bytes?: Uint8Array | null) => bytes ? this.context.codec.encodeBase64(bytes) : null;
      const paths = new Set(input.paths);
      if (Object.keys({ ...base, ...candidate }).some((path) => value(base[path]) !== value(candidate[path]) && !paths.has(path))) throw new AppError('VALIDATION', '提案包含未授权路径');
      const conflicts: string[] = []; const changes: Operation['changes'] = [];
      for (const path of paths) {
        const before = value(base[path]); const after = value(candidate[path]); const current = value(await this.reader.bytesOrNull(projectId, path));
        if (before === after || current === after) continue;
        if (current !== before) { conflicts.push(path); continue; }
        const bytes = candidate[path];
        if (bytes && bytes.length > MAX_FILE_BYTES) throw new AppError('LIMIT', '文件超过 20 MB 限制');
        if (bytes && !isImage(path) && bytes.length > contentLimits.textFileBytes) throw new AppError('LIMIT', '文本超过 1 MB 限制');
        if (bytes && isImage(path)) validateImage(path, bytes);
        changes.push({ path, before: current, after });
      }
      // Entire batch is preflighted inside the sole project queue, before journaling.
      if (conflicts.length) return { conflicts, changedPaths: [] };
      if (!changes.length) return { conflicts: [], changedPaths: [] };
      await beforeApply?.();
      const checkpoint = await this.mutations.prepare(projectId, changes, '合入子 Agent 提案', input.operationId, input.rootRunId,
        { actorRunId: input.actorRunId, proposalId: input.proposalId, mergedByRunId: input.rootRunId });
      return { conflicts: [], changedPaths: changes.map((change) => change.path), checkpoint };
    });
  }
  async create(name: string, requestedId?: string): Promise<Project> {
    if (requestedId && !/^[a-zA-Z0-9-]{1,80}$/.test(requestedId)) throw new AppError('VALIDATION', '工作区标识无效');
    const project: Project = {
      id: requestedId ?? this.context.id(), name: name.trim().slice(0, 60) || '未命名项目',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await this.context.git.init(project.id);
    await this.context.fs.write(this.reader.internal(project.id, 'project.json'), this.context.codec.encodeText(JSON.stringify({
      name: project.name, formatVersion: 1,
    }, null, 2)));
    await this.context.fs.write(this.reader.internal(project.id, 'documents/notes.md'), this.context.codec.encodeText(
      '# 我的资料\n\n在这里写下你的想法，也可以导入文字和图片。\n',
    ));
    const commit = await this.context.git.commit(project.id, ['project.json', 'documents/notes.md'], '创建工作区');
    await this.context.metadata.put(this.context.projectBucket, project.id, project);
    this.mutations.notify({ projectId: project.id, paths: ['project.json', 'documents/notes.md'], commit });
    return project;
  }

  async write(
    projectId: string, path: string, bytes: Uint8Array, expectedRevision: string | null,
    options: { owner?: string; operationId?: string; message?: string } = {},
  ) {
    path = safePath(path);
    if (path.toLowerCase() === 'project.json') throw new AppError('VALIDATION', '项目配置由宿主管理');
    if (bytes.length > MAX_FILE_BYTES) throw new AppError('LIMIT', '文件超过 20 MB 限制');
    if (!isImage(path) && bytes.length > contentLimits.textFileBytes) throw new AppError('LIMIT', '文本超过 1 MB 限制');
    if (isImage(path)) validateImage(path, bytes);
    return this.mutations.serial(projectId, options.owner, async () => {
      const operationId = options.operationId ?? this.context.id();
      const existing = await this.context.journal.get(projectId, operationId);
      if (existing) {
        if (existing.ownerRootRunId !== options.owner || existing.kind !== 'files' || existing.changes[0]?.path !== path || existing.changes[0]?.after !== this.context.codec.encodeBase64(bytes)) {
          throw new AppError('CONFLICT', '操作 ID 与原始修改不匹配');
        }
        return this.mutations.apply(existing);
      }
      const before = await this.reader.bytesOrNull(projectId, path);
      const revision = before ? await this.context.git.revision(before) : null;
      if (revision !== expectedRevision) throw new AppError('CONFLICT', 'VERSION_CONFLICT：文件已变化，请重新读取。');
      if (before && this.context.codec.encodeBase64(before) === this.context.codec.encodeBase64(bytes)) return this.context.git.head(projectId);
      return this.mutations.prepare(projectId, [{ path, before: before ? this.context.codec.encodeBase64(before) : null, after: this.context.codec.encodeBase64(bytes) }],
        options.message ?? '修改 ' + path, operationId, options.owner);
    });
  }

  async remove(projectId: string, path: string, revision: string, owner?: string) {
    if (safePath(path) === 'project.json') throw new AppError('VALIDATION', '项目配置由宿主管理');
    return this.mutations.serial(projectId, owner, async () => {
      const before = await this.reader.read(projectId, path);
      if (before.revision !== revision) throw new AppError('CONFLICT', 'VERSION_CONFLICT：文件已变化');
      return this.mutations.prepare(projectId, [{ path, before: this.context.codec.encodeBase64(before.bytes), after: null }], '删除 ' + path, this.context.id(), owner);
    });
  }

  async move(projectId: string, from: string, to: string, revision: string, owner?: string) {
    safePath(from); safePath(to);
    if (from === 'project.json' || to === 'project.json') throw new AppError('VALIDATION', '项目配置由宿主管理');
    return this.mutations.serial(projectId, owner, async () => {
      const before = await this.reader.read(projectId, from);
      if (before.revision !== revision) throw new AppError('CONFLICT', 'VERSION_CONFLICT：文件已变化');
      if (await this.reader.bytesOrNull(projectId, to)) throw new AppError('CONFLICT', '目标文件已存在');
      return this.mutations.prepare(projectId, [
        { path: from, before: this.context.codec.encodeBase64(before.bytes), after: null },
        { path: to, before: null, after: this.context.codec.encodeBase64(before.bytes) },
      ], '移动 ' + from + ' → ' + to, this.context.id(), owner);
    });
  }

  async saveSkillRevision(projectId: string, files: { path: string; bytes: Uint8Array | null }[], expectedHead: string, message: string) {
    if (this.context.journal.namespace !== 'skills') throw new AppError('VALIDATION', '整包版本保存只用于技能库。');
    for (const file of files) {
      if (safePath(file.path) === 'project.json') throw new AppError('VALIDATION', '项目配置由宿主管理');
      if (file.bytes && file.bytes.length > MAX_FILE_BYTES) throw new AppError('LIMIT', '文件超过 20 MB 限制');
      if (file.bytes && isImage(file.path)) validateImage(file.path, file.bytes);
    }
    if (new Set(files.map((file) => file.path.toLowerCase())).size !== files.length) throw new AppError('VALIDATION', '目标文件路径重复');
    return this.mutations.serial(projectId, undefined, async () => {
      if (await this.context.git.head(projectId) !== expectedHead) throw new AppError('CONFLICT', 'VERSION_CONFLICT：文件库已变化，请重新读取。');
      const changes: Operation['changes'] = [];
      for (const file of files) { const before = await this.reader.bytesOrNull(projectId, file.path); const change = { path: file.path, before: before ? this.context.codec.encodeBase64(before) : null, after: file.bytes ? this.context.codec.encodeBase64(file.bytes) : null };
        if (change.before !== change.after) changes.push(change);
      }
      return changes.length ? this.mutations.prepare(projectId, changes, message, this.context.id(), undefined, undefined, 'files_commit') : expectedHead;
    });
  }
}
