import { AppError } from '@/core/errors';
import type { WorkspaceContext } from './context';
import type { Project } from '@/core/projects';
import type { Operation } from '@/core/workspace/journal';
import type { CandidateMergeInput, CandidateMergeResult } from '@/core/runs/proposals';
import { safePath, isImage } from '@/core/workspace/path';
import { validateImage } from '@/core/workspace/image';
import { validateTextContent } from '@/core/workspace/content';
import {
  applyTextEdits,
  validateTextEdits,
  type TextEdit,
  type TextEditOutcome,
} from '@/core/workspace/edits';
import { workspaceLimits } from '@/core/workspace/limits';
import type { WorkspaceReader } from './reader';
import type { MutationCoordinator } from './mutations';

const MAX_FILE_BYTES = workspaceLimits.fileOperationBytes;
export class FileCommands {
  constructor(
    private readonly context: WorkspaceContext,
    private readonly reader: WorkspaceReader,
    private readonly mutations: MutationCoordinator,
  ) {}
  mergeCandidate(
    projectId: string,
    input: CandidateMergeInput,
    beforeApply?: () => Promise<void>,
  ): Promise<CandidateMergeResult> {
    for (const path of input.paths)
      if (safePath(path).toLowerCase() === 'project.json')
        throw new AppError('VALIDATION', '项目配置由宿主管理');
    if (new Set(input.paths.map(path => path.toLowerCase())).size !== input.paths.length)
      throw new AppError('VALIDATION', '目标文件路径重复');
    return this.mutations.serial(projectId, input.rootRunId, async () => {
      const receipt = await this.context.journal.get(projectId, input.operationId);
      if (receipt) {
        if (
          receipt.ownerRootRunId !== input.rootRunId ||
          receipt.proposalId !== input.proposalId ||
          receipt.actorRunId !== input.actorRunId
        )
          throw new AppError('CONFLICT', '操作 ID 与原始提案不匹配');
        return {
          conflicts: [],
          changedPaths: receipt.changes.map(change => change.path),
          checkpoint: await this.mutations.apply(receipt),
        };
      }
      const base = await this.context.git.tree(projectId, input.baseSnapshot);
      const candidate = await this.context.git.tree(projectId, input.candidateSnapshot);
      const value = (bytes?: Uint8Array | null) =>
        bytes ? this.context.codec.encodeBase64(bytes) : null;
      const paths = new Set(input.paths);
      if (
        Object.keys({ ...base, ...candidate }).some(
          path => value(base[path]) !== value(candidate[path]) && !paths.has(path),
        )
      )
        throw new AppError('VALIDATION', '提案包含未授权路径');
      const conflicts: string[] = [];
      const changes: Operation['changes'] = [];
      for (const path of paths) {
        const before = value(base[path]);
        const after = value(candidate[path]);
        const current = value(await this.reader.bytesOrNull(projectId, path));
        if (before === after || current === after) continue;
        if (current !== before) {
          conflicts.push(path);
          continue;
        }
        const bytes = candidate[path];
        if (bytes && bytes.length > MAX_FILE_BYTES)
          throw new AppError('LIMIT', '文件超过 20 MB 限制');
        changes.push({ path, before: current, after });
      }
      // Entire batch is preflighted inside the sole project queue, before journaling.
      if (conflicts.length) return { conflicts, changedPaths: [] };
      if (!changes.length) return { conflicts: [], changedPaths: [] };
      await beforeApply?.();
      const checkpoint = await this.mutations.prepare(
        projectId,
        changes,
        '合入子 Agent 提案',
        input.operationId,
        input.rootRunId,
        {
          actorRunId: input.actorRunId,
          proposalId: input.proposalId,
          mergedByRunId: input.rootRunId,
        },
      );
      return { conflicts: [], changedPaths: changes.map(change => change.path), checkpoint };
    });
  }
  async create(name: string, requestedId?: string): Promise<Project> {
    if (requestedId && !/^[a-zA-Z0-9-]{1,80}$/.test(requestedId))
      throw new AppError('VALIDATION', '工作区标识无效');
    const project: Project = {
      id: requestedId ?? this.context.id(),
      name: name.trim().slice(0, 60) || '未命名项目',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.context.git.init(project.id);
    await this.context.fs.write(
      this.reader.internal(project.id, 'project.json'),
      this.context.codec.encodeText(
        JSON.stringify(
          {
            name: project.name,
            formatVersion: 1,
          },
          null,
          2,
        ),
      ),
    );
    await this.context.fs.write(
      this.reader.internal(project.id, 'documents/notes.md'),
      this.context.codec.encodeText('# 我的资料\n\n在这里写下你的想法，也可以导入文字和图片。\n'),
    );
    const commit = await this.context.git.commit(
      project.id,
      ['project.json', 'documents/notes.md'],
      '创建工作区',
    );
    await this.context.metadata.put(this.context.projectBucket, project.id, project);
    this.mutations.notify({
      projectId: project.id,
      paths: ['project.json', 'documents/notes.md'],
      commit,
    });
    return project;
  }

  write(
    projectId: string,
    path: string,
    bytes: Uint8Array,
    expectedRevision: string | null,
    options: { owner?: string; operationId?: string; message?: string } = {},
  ) {
    return this.save(projectId, path, bytes, expectedRevision, options, false);
  }

  async writeText(
    projectId: string,
    path: string,
    bytes: Uint8Array,
    expectedRevision: string | null,
    options: { owner?: string; operationId?: string; message?: string } = {},
  ) {
    validateTextContent(bytes);
    return this.save(projectId, path, bytes, expectedRevision, options, true);
  }

  private async save(
    projectId: string,
    path: string,
    bytes: Uint8Array,
    expectedRevision: string | null,
    options: { owner?: string; operationId?: string; message?: string },
    textOnly: boolean,
  ) {
    path = safePath(path);
    if (path.toLowerCase() === 'project.json')
      throw new AppError('VALIDATION', '项目配置由宿主管理');
    if (bytes.length > MAX_FILE_BYTES) throw new AppError('LIMIT', '文件超过 20 MB 限制');
    return this.mutations.serial(projectId, options.owner, async () => {
      const operationId = options.operationId ?? this.context.id();
      const existing = await this.context.journal.get(projectId, operationId);
      if (existing) {
        if (
          existing.ownerRootRunId !== options.owner ||
          existing.kind !== 'files' ||
          existing.textEditFingerprint !== undefined ||
          existing.changes[0]?.path !== path ||
          existing.changes[0]?.after !== this.context.codec.encodeBase64(bytes)
        ) {
          throw new AppError('CONFLICT', '操作 ID 与原始修改不匹配');
        }
        if (textOnly && existing.changes[0].before !== null)
          validateTextContent(this.context.codec.decodeBase64(existing.changes[0].before));
        return this.mutations.apply(existing);
      }
      const before = await this.reader.bytesOrNull(projectId, path);
      const revision = before ? await this.context.git.revision(before) : null;
      if (revision !== expectedRevision)
        throw new AppError('CONFLICT', 'VERSION_CONFLICT：文件已变化，请重新读取。');
      if (textOnly && before) validateTextContent(before);
      if (
        before &&
        this.context.codec.encodeBase64(before) === this.context.codec.encodeBase64(bytes)
      )
        return this.context.git.head(projectId);
      return this.mutations.prepare(
        projectId,
        [
          {
            path,
            before: before ? this.context.codec.encodeBase64(before) : null,
            after: this.context.codec.encodeBase64(bytes),
          },
        ],
        options.message ?? '修改 ' + path,
        operationId,
        options.owner,
      );
    });
  }

  async editText(
    projectId: string,
    path: string,
    edits: readonly TextEdit[],
    expectedRevision: string,
    options: { owner?: string; operationId?: string } = {},
  ): Promise<TextEditOutcome> {
    path = safePath(path);
    if (path.toLowerCase() === 'project.json')
      throw new AppError('VALIDATION', '精确替换只允许工作区内非受保护的文本文件。');
    if (typeof expectedRevision !== 'string' || !expectedRevision)
      throw new AppError('VALIDATION', '精确替换需要读取时的文件修订号，不能创建文件。');
    const replacements = validateTextEdits(edits);
    return this.mutations.serial(projectId, options.owner, async () => {
      const id = options.operationId ?? this.context.id();
      const fingerprint = await this.context.git.revision(
        this.context.codec.encodeText(
          JSON.stringify({ path, expectedRevision, edits: replacements }),
        ),
      );
      const previous = await this.context.journal.get(projectId, id);
      if (
        previous &&
        (previous.kind !== 'files' ||
          previous.ownerRootRunId !== options.owner ||
          previous.textEditFingerprint !== fingerprint ||
          previous.changes.length !== 1 ||
          previous.changes[0].path !== path ||
          previous.changes[0].before === null ||
          previous.changes[0].after === null)
      )
        throw new AppError('CONFLICT', '操作 ID 与原始精确替换不匹配。');
      const before = previous
        ? this.context.codec.decodeBase64(previous.changes[0].before!)
        : await this.reader.bytesOrNull(projectId, path);
      if (before === null)
        throw new AppError('VALIDATION', '文件不存在，请使用 write_text 新建文件。');
      validateTextContent(before);
      if ((await this.context.git.revision(before)) !== expectedRevision)
        throw new AppError('CONFLICT', 'VERSION_CONFLICT：文件已变化，请重新读取后重新规划替换。');
      const source = this.context.codec.decodeText(before);
      const plan = applyTextEdits(source, replacements);
      const after = this.context.codec.encodeText(plan.text);
      validateTextContent(after);
      if (previous && previous.changes[0].after !== this.context.codec.encodeBase64(after))
        throw new AppError('STORAGE', '精确替换回执与保存的结果不一致。');
      const operation =
        previous ??
        (await this.context.journal.prepare(
          {
            id,
            projectId,
            kind: 'files',
            ownerRootRunId: options.owner,
            actorRunId: options.owner,
            expectedHead: await this.context.git.head(projectId),
            message: '精确修改 ' + path,
            phase: 'prepared',
            createdAt: new Date().toISOString(),
          },
          {
            changes: [
              {
                path,
                before: this.context.codec.encodeBase64(before),
                after: this.context.codec.encodeBase64(after),
              },
            ],
            textEditFingerprint: fingerprint,
          },
        ));
      await this.mutations.apply(operation);
      return {
        revision: await this.context.git.revision(after),
        changed: plan.text !== source,
        replayed: !!previous,
        changes: plan.changes,
      };
    });
  }

  async remove(projectId: string, path: string, revision: string, owner?: string) {
    if (safePath(path) === 'project.json') throw new AppError('VALIDATION', '项目配置由宿主管理');
    return this.mutations.serial(projectId, owner, async () => {
      const before = await this.reader.read(projectId, path);
      if (before.revision !== revision)
        throw new AppError('CONFLICT', 'VERSION_CONFLICT：文件已变化');
      return this.mutations.prepare(
        projectId,
        [{ path, before: this.context.codec.encodeBase64(before.bytes), after: null }],
        '删除 ' + path,
        this.context.id(),
        owner,
      );
    });
  }

  async move(projectId: string, from: string, to: string, revision: string, owner?: string) {
    from = safePath(from);
    to = safePath(to);
    if (from.toLowerCase() === 'project.json' || to.toLowerCase() === 'project.json')
      throw new AppError('VALIDATION', '项目配置由宿主管理');
    return this.mutations.serial(projectId, owner, async () => {
      const before = await this.reader.read(projectId, from);
      if (before.revision !== revision)
        throw new AppError('CONFLICT', 'VERSION_CONFLICT：文件已变化');
      if (await this.reader.bytesOrNull(projectId, to))
        throw new AppError('CONFLICT', '目标文件已存在');
      const operation = await this.context.journal.prepare(
        {
          id: this.context.id(),
          projectId,
          kind: 'files',
          ownerRootRunId: owner,
          actorRunId: owner,
          expectedHead: await this.context.git.head(projectId),
          message: '移动 ' + from + ' → ' + to,
          phase: 'prepared',
          createdAt: new Date().toISOString(),
        },
        {
          changes: [
            { path: from, before: this.context.codec.encodeBase64(before.bytes), after: null },
            { path: to, before: null, after: this.context.codec.encodeBase64(before.bytes) },
          ],
          fileMove: { from, to },
        },
      );
      return this.mutations.apply(operation);
    });
  }

  async saveSkillRevision(
    projectId: string,
    files: { path: string; bytes: Uint8Array | null }[],
    expectedHead: string,
    message: string,
  ) {
    if (this.context.journal.namespace !== 'skills')
      throw new AppError('VALIDATION', '整包版本保存只用于技能库。');
    for (const file of files) {
      if (safePath(file.path) === 'project.json')
        throw new AppError('VALIDATION', '项目配置由宿主管理');
      if (file.bytes && file.bytes.length > MAX_FILE_BYTES)
        throw new AppError('LIMIT', '文件超过 20 MB 限制');
      if (file.bytes && isImage(file.path)) validateImage(file.path, file.bytes);
    }
    if (new Set(files.map(file => file.path.toLowerCase())).size !== files.length)
      throw new AppError('VALIDATION', '目标文件路径重复');
    return this.mutations.serial(projectId, undefined, async () => {
      if ((await this.context.git.head(projectId)) !== expectedHead)
        throw new AppError('CONFLICT', 'VERSION_CONFLICT：文件库已变化，请重新读取。');
      const changes: Operation['changes'] = [];
      for (const file of files) {
        const before = await this.reader.bytesOrNull(projectId, file.path);
        const change = {
          path: file.path,
          before: before ? this.context.codec.encodeBase64(before) : null,
          after: file.bytes ? this.context.codec.encodeBase64(file.bytes) : null,
        };
        if (change.before !== change.after) changes.push(change);
      }
      return changes.length
        ? this.mutations.prepare(
            projectId,
            changes,
            message,
            this.context.id(),
            undefined,
            undefined,
            'files_commit',
          )
        : expectedHead;
    });
  }
}
