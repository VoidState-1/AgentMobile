import { fileReadTools, scopedFileReader } from '@/application/tools/file-read';
import { Type } from 'typebox';
import type { ControlledTool } from '@/core/agent/tools';
import type { ContentCodec } from '@/core/storage/codec';
import type { ChangeProposal, ProposalWrite } from '@/core/runs/proposals';
import type { RunState } from '@/core/runs/types';
import { safePath, isImage, canMoveWithinFormat } from '@/core/workspace/path';
import { validateText } from '@/core/workspace/text';
import { validateImage } from '@/core/workspace/image';
import { AppError } from '@/core/errors';
import { canonical } from '@/core/mcp/rules';
import type { WorkspaceApplication } from '@/application/workspace/service';
import { assertRunning, defineTool, result, revision, textLimit } from '@/application/tools/common';
import type { ProposalRepository } from './proposal-repository';

/** Private Git candidate only. This object has no filesystem/index mutation tool. */
export class ProposalOverlay {
  private queue: Promise<unknown> = Promise.resolve();
  private sequence = 0;
  private recoveryRequired = false;
  constructor(
    private proposal: ChangeProposal,
    private readonly repository: ProposalRepository,
    private readonly workspace: WorkspaceApplication,
    private readonly codec: ContentCodec,
  ) {}
  get id() {
    return this.proposal.id;
  }
  snapshot(): ChangeProposal {
    return JSON.parse(JSON.stringify(this.proposal)) as ChangeProposal;
  }
  private scope(input: string) {
    const path = safePath(input);
    if (!this.proposal.allowedPaths.includes(path) || path.toLowerCase() === 'project.json')
      throw new AppError('VALIDATION', '提案路径未授权。');
    return path;
  }
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => {}).then(work);
    this.queue = next;
    return next;
  }
  private async files() {
    return this.workspace.git.entries(this.proposal.projectId, this.proposal.candidateSnapshot);
  }
  private async read(input: string) {
    const path = this.scope(input);
    const file = (await this.files()).find(file => file.path === path);
    if (!file) throw new AppError('VALIDATION', '提案文件不存在。');
    return {
      ...file,
      bytes: await this.workspace.git.readAt(
        this.proposal.projectId,
        this.proposal.candidateSnapshot,
        path,
      ),
    };
  }
  private change(
    invocation: string,
    changes: { path: string; bytes: Uint8Array | null; expected: string | null }[],
  ): Promise<void> {
    return this.exclusive(async () => {
      if (this.recoveryRequired)
        throw new AppError('STORAGE', '提案写入回执需要恢复，请重新打开应用。');
      if (this.proposal.state !== 'draft')
        throw new AppError('CONFLICT', '提案已收束，不能继续修改。');
      const id = this.proposal.id + ':' + invocation;
      const parts = [];
      for (const change of changes) {
        if (change.bytes) {
          if (isImage(change.path)) validateImage(change.path, change.bytes);
          else validateText(change.bytes);
        }
        parts.push({
          path: this.scope(change.path),
          expected: change.expected,
          after: change.bytes ? await this.workspace.git.revision(change.bytes) : null,
        });
      }
      const fingerprint = canonical(parts);
      const previous = await this.repository.write(id);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new AppError('CONFLICT', '提案调用与已保存参数不匹配。');
        if (previous.phase === 'recorded') return;
        throw new AppError('STORAGE', '提案写入回执需要恢复，请重新打开应用。');
      }
      const tree = await this.workspace.git.tree(
        this.proposal.projectId,
        this.proposal.candidateSnapshot,
      );
      for (const change of changes) {
        const current = tree[change.path]
          ? await this.workspace.git.revision(tree[change.path])
          : null;
        if (current !== change.expected)
          throw new AppError('CONFLICT', '提案文件修订已变化，请重新读取。');
        if (change.bytes) tree[change.path] = change.bytes;
        else delete tree[change.path];
      }
      const write: ProposalWrite = {
        id,
        proposalId: this.proposal.id,
        projectId: this.proposal.projectId,
        rootRunId: this.proposal.rootRunId,
        sourceRunId: this.proposal.sourceRunId,
        fingerprint,
        checkpointKey:
          'proposals/' +
          this.proposal.id +
          '/writes/' +
          this.codec.encodeHex(this.codec.encodeText(invocation)),
        previousSnapshot: this.proposal.candidateSnapshot,
        phase: 'prepared',
        sequence: ++this.sequence,
      };
      try {
        await this.repository.prepare(write);
        const candidate = await this.workspace.candidateSnapshot(
          write.projectId,
          write.rootRunId,
          tree,
          write.checkpointKey,
          write.previousSnapshot,
        );
        const changedPaths = [
          ...new Set([...this.proposal.changedPaths, ...changes.map(change => change.path)]),
        ];
        const next = {
          ...this.proposal,
          candidateSnapshot: candidate,
          changedPaths,
          updatedAt: new Date().toISOString(),
        };
        await this.repository.record(next, {
          ...write,
          candidateSnapshot: candidate,
          phase: 'recorded',
        });
        this.proposal = next;
      } catch (error) {
        this.recoveryRequired = true;
        throw error;
      }
    });
  }
  async close(state: RunState) {
    await this.queue.catch(() => {});
    if (this.recoveryRequired)
      throw new AppError('STORAGE', '提案写入回执需要恢复，请重新打开应用。');
    const base = new Map(
      (await this.workspace.git.entries(this.proposal.projectId, this.proposal.baseSnapshot)).map(
        file => [file.path, file.revision],
      ),
    );
    const candidate = new Map((await this.files()).map(file => [file.path, file.revision]));
    const changedPaths = [...new Set([...base.keys(), ...candidate.keys()])].filter(
      path => base.get(path) !== candidate.get(path),
    );
    const next: ChangeProposal = {
      ...this.proposal,
      changedPaths,
      sourceState: state,
      state: state === 'completed' ? 'ready' : state === 'cancelled' ? 'cancelled' : 'interrupted',
      updatedAt: new Date().toISOString(),
    };
    await this.repository.save(next);
    this.proposal = next;
  }
  tools(round: () => number, allowImages: boolean): ControlledTool[] {
    const reader = scopedFileReader(
      'proposal:' + this.proposal.id,
      async () => ({
        version: this.proposal.candidateSnapshot,
        files: (await this.files()).filter(file => this.proposal.allowedPaths.includes(file.path)),
      }),
      path => this.read(path),
    );
    return [
      ...fileReadTools(reader, this.codec, allowImages),

      defineTool({
        effect: 'workspace-write',
        name: 'write_text',
        label: '修改隔离提案',
        description:
          '只在授权路径修改隔离候选 UTF-8 文本，支持代码、配置和无扩展名文件。使用候选修订号；创建为 null。不会改变真实工作区、index 或 HEAD。',
        parameters: Type.Object(
          {
            path: Type.String({ maxLength: 220 }),
            text: Type.String({ maxLength: textLimit }),
            expectedRevision: revision,
          },
          { additionalProperties: false },
        ),
        execute: async (callId, args, signal) => {
          assertRunning(signal);
          const path = this.scope(args.path);
          if (isImage(path)) throw new AppError('VALIDATION', '文字工具不能写入图片提案。');
          await this.change(round() + ':' + callId, [
            { path, bytes: this.codec.encodeText(args.text), expected: args.expectedRevision },
          ]);
          return result({
            path,
            revision: (await this.read(path)).revision,
            proposalId: this.proposal.id,
            isolated: true,
          });
        },
      }),
      defineTool({
        effect: 'workspace-write',
        name: 'delete_file',
        label: '提案删除文件',
        description: '只在候选树中删除授权文件，使用候选修订号。',
        parameters: Type.Object(
          { path: Type.String(), expectedRevision: Type.String() },
          { additionalProperties: false },
        ),
        execute: async (callId, args, signal) => {
          assertRunning(signal);
          await this.change(round() + ':' + callId, [
            { path: this.scope(args.path), bytes: null, expected: args.expectedRevision },
          ]);
          return result({ proposalId: this.proposal.id, isolated: true });
        },
      }),
      defineTool({
        effect: 'workspace-write',
        name: 'move_file',
        label: '提案移动文件',
        description: '候选中移动/重命名；来源和目标都须在授权路径中，目标不存在。',
        parameters: Type.Object(
          { from: Type.String(), to: Type.String(), expectedRevision: Type.String() },
          { additionalProperties: false },
        ),
        execute: async (callId, args, signal) => {
          assertRunning(signal);
          const from = this.scope(args.from);
          const to = this.scope(args.to);
          const file = await this.read(from);
          if (!canMoveWithinFormat(from, to))
            throw new AppError('VALIDATION', '提案移动不能转换文件格式。');
          await this.change(round() + ':' + callId, [
            { path: from, bytes: null, expected: args.expectedRevision },
            { path: to, bytes: file.bytes, expected: null },
          ]);
          return result({ from, to, proposalId: this.proposal.id, isolated: true });
        },
      }),
    ];
  }
}
