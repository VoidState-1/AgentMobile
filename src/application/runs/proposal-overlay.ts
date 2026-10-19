import { fileReadTools, scopedFileReader } from '@/application/tools/file-read';
import { Type } from 'typebox';
import type { ControlledTool } from '@/core/agent/tools';
import type { ContentCodec } from '@/core/storage/codec';
import type { ChangeProposal, ProposalWrite } from '@/core/runs/proposals';
import type { RunState } from '@/core/runs/types';
import { safePath } from '@/core/workspace/path';
import { validateTextContent } from '@/core/workspace/content';
import {
  applyTextEdits,
  validateTextEdits,
  type TextEdit,
  type TextEditOutcome,
} from '@/core/workspace/edits';
import { AppError } from '@/core/errors';
import { canonical } from '@/core/mcp/rules';
import type { WorkspaceApplication } from '@/application/workspace/service';
import { assertRunning, defineTool, result, revision, textLimit } from '@/application/tools/common';
import type { ProposalRepository } from './proposal-repository';
import { gitModes, type GitTree } from '@/core/git/objects';
import {
  editTextDescription,
  editTextParameters,
  textEditResult,
} from '@/application/tools/text-edit';

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
    if (!this.proposal.allowedPaths.includes(path))
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
  private assertWritable() {
    if (this.recoveryRequired)
      throw new AppError('STORAGE', '提案写入回执需要恢复，请重新打开应用。');
    if (this.proposal.state !== 'draft')
      throw new AppError('CONFLICT', '提案已收束，不能继续修改。');
  }
  private change(
    invocation: string,
    changes: { path: string; bytes: Uint8Array | null; expected: string | null }[],
    textOnly = false,
  ): Promise<void> {
    return this.exclusive(async () => {
      this.assertWritable();
      const id = this.proposal.id + ':' + invocation;
      const parts = [];
      for (const change of changes) {
        if (textOnly && change.bytes) validateTextContent(change.bytes);
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
        const entry = tree[change.path];
        if (entry?.mode === gitModes.gitlink || (change.bytes && entry?.mode === gitModes.symlink))
          throw new AppError('VALIDATION', '正文提案不能修改符号链接或子模块。');
        if (textOnly && entry)
          validateTextContent(
            await this.workspace.git.blob(this.proposal.projectId, entry.revision),
          );
        const current = entry?.revision ?? null;
        if (current !== change.expected)
          throw new AppError('CONFLICT', '提案文件修订已变化，请重新读取。');
        if (change.bytes)
          tree[change.path] = {
            revision: await this.workspace.git.writeBlob(this.proposal.projectId, change.bytes),
            mode: entry?.mode ?? gitModes.file,
          };
        else delete tree[change.path];
      }
      await this.persistChange(
        invocation,
        tree,
        changes.map(change => change.path),
        fingerprint,
      );
    });
  }

  private async persistChange(
    invocation: string,
    tree: GitTree,
    paths: string[],
    fingerprint: string,
  ) {
    const write: ProposalWrite = {
      id: this.proposal.id + ':' + invocation,
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
      const next = {
        ...this.proposal,
        candidateSnapshot: candidate,
        changedPaths: [...new Set([...this.proposal.changedPaths, ...paths])],
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
  }

  private editText(
    invocation: string,
    path: string,
    edits: readonly TextEdit[],
    expectedRevision: string,
  ): Promise<TextEditOutcome> {
    path = this.scope(path);
    if (typeof expectedRevision !== 'string' || !expectedRevision)
      throw new AppError('VALIDATION', '精确替换需要候选文件的当前修订号，不能创建文件。');
    const replacements = validateTextEdits(edits);
    return this.exclusive(async () => {
      this.assertWritable();
      const fingerprint = await this.workspace.git.revision(
        this.codec.encodeText(JSON.stringify({ path, expectedRevision, edits: replacements })),
      );
      const previous = await this.repository.write(this.proposal.id + ':' + invocation);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new AppError('CONFLICT', '提案调用与原始精确替换不匹配。');
        if (previous.phase !== 'recorded' || !previous.candidateSnapshot)
          throw new AppError('STORAGE', '提案写入回执需要恢复，请重新打开应用。');
      }
      const tree = await this.workspace.git.tree(
        this.proposal.projectId,
        previous?.previousSnapshot ?? this.proposal.candidateSnapshot,
      );
      const original = tree[path];
      if (!original)
        throw new AppError('VALIDATION', '候选文件不存在，请使用 write_text 新建文件。');
      if (original.mode !== gitModes.file && original.mode !== gitModes.executable)
        throw new AppError('VALIDATION', '精确替换只允许普通文本文件。');
      const before = await this.workspace.git.blob(this.proposal.projectId, original.revision);
      validateTextContent(before);
      if ((await this.workspace.git.revision(before)) !== expectedRevision)
        throw new AppError(
          'CONFLICT',
          'VERSION_CONFLICT：候选文件已变化，请重新读取后重新规划替换。',
        );
      const source = this.codec.decodeText(before);
      const plan = applyTextEdits(source, replacements);
      const after = this.codec.encodeText(plan.text);
      validateTextContent(after);
      const revision = await this.workspace.git.writeBlob(this.proposal.projectId, after);
      if (previous) {
        const saved = await this.workspace.git.entries(
          this.proposal.projectId,
          previous.candidateSnapshot!,
        );
        if (saved.find(file => file.path === path)?.revision !== revision)
          throw new AppError('STORAGE', '精确替换提案回执与候选结果不一致。');
      } else {
        tree[path] = { revision, mode: original.mode };
        await this.persistChange(invocation, tree, [path], fingerprint);
      }
      return {
        revision,
        changed: source !== plan.text,
        replayed: !!previous,
        changes: plan.changes,
      };
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
        name: 'edit_text',
        label: '精确修改隔离提案',
        description:
          '只修改授权路径的隔离候选，不改变真实工作区、index 或 HEAD。' + editTextDescription,
        parameters: editTextParameters,
        executionMode: 'sequential',
        execute: async (callId, args, signal) => {
          assertRunning(signal);
          return textEditResult(
            args.path,
            await this.editText(
              round() + ':' + callId,
              args.path,
              args.edits,
              args.expectedRevision,
            ),
            this.proposal.id,
          );
        },
      }),
      defineTool({
        effect: 'workspace-write',
        name: 'write_text',
        label: '提案写入全文',
        description:
          '只在授权路径新建或整体重写隔离候选 UTF-8 文本。局部修改使用 edit_text，不能因精确替换失败而自动覆盖全文。整体重写须读取完整原文并使用候选修订号；创建为 null。不会改变真实工作区、index 或 HEAD。',
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
          await this.change(
            round() + ':' + callId,
            [{ path, bytes: this.codec.encodeText(args.text), expected: args.expectedRevision }],
            true,
          );
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
