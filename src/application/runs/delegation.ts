import { Type } from 'typebox';
import { AppError } from '@/core/errors';
import { builtinAgents } from '@/core/agent/definitions';
import { Signal } from '@/core/signal';
import type { RunRecord } from '@/core/runs/records';
import { terminalRun } from '@/core/runs/records';
import type { ExecutionView } from '@/core/runs/types';
import type { ChildResult, SpawnRequest } from '@/core/runs/delegation';
import type { SchedulerLimits } from '@/core/runs/scheduling';
import { canonical } from '@/core/mcp/rules';
import { safePath } from '@/core/workspace/path';
import { defineTool, assertRunning, result } from '@/application/tools/common';
import type { RunToolsContext } from '@/application/tools/context';
import type { WorkspaceApplication } from '@/application/workspace/service';
import type { RunRepository } from './repository';
import type { PreparedRun } from './resources';
import type { GroupBudget } from './budget';
import type { RequestScheduler } from './request-scheduler';
import type { RunRecorder } from './recorder';
import type { DelegationPort } from './delegation-port';
import { executeChild } from './child-controller';
import { ProposalService } from './proposals';
import { RunStopController, type StopReason } from '@/core/runs/termination';

interface Child {
  record: RunRecord;
  view: ExecutionView;
  stop: RunStopController;
  running: boolean;
  done?: Promise<void>;
  delivered: boolean;
}
/** One-level delegation owned by a root, with a single immutable sibling input. */
export class DelegationSession implements DelegationPort {
  private readonly children = new Map<string, Child>();
  private readonly signal = new Signal();
  private queue: Promise<unknown> = Promise.resolve();
  private snapshotRef?: string;
  private context?: RunToolsContext;
  private recorder?: RunRecorder;
  private closing = false;
  private fatal?: string;
  private readonly proposals: ProposalService;
  constructor(
    private readonly parent: RunRecord,
    private readonly prepared: PreparedRun,
    private readonly workspace: WorkspaceApplication,
    private readonly repository: RunRepository,
    private readonly budget: GroupBudget,
    private readonly requests: RequestScheduler,
    private readonly limits: SchedulerLimits,
    private readonly groupStop: RunStopController,
    private readonly id: () => string,
    private readonly nextGroupSequence: () => number = (() => {
      let value = 0;
      return () => ++value;
    })(),
  ) {
    this.proposals = new ProposalService(workspace, repository, prepared.resources.codec);
    groupStop.signal.addEventListener(
      'abort',
      () => {
        for (const child of this.children.values())
          if (groupStop.reason) child.stop.inherit(groupStop.reason);
      },
      { once: true },
    );
  }
  private publish() {
    if (this.context && this.recorder) {
      this.context.task.children = [...this.children.values()].map(child => child.view);
      this.recorder.publish();
    }
    this.signal.publish();
  }
  owns(id: string) {
    return this.children.has(id);
  }
  needsSummary() {
    return [...this.children.values()].some(
      child => !child.delivered || !terminalRun(child.view.state),
    );
  }
  tools(context: RunToolsContext, recorder: RunRecorder) {
    this.context = context;
    this.recorder = recorder;
    return [
      defineTool({
        name: 'spawn_agent',
        label: '委派子 Agent',
        effect: 'delegate',
        description:
          '异步启动 reader/reviewer 只读分析或 writer 隔离写作。共享固定输入快照，精确授权 paths；writer 可包含允许创建的 .md/.txt/图片目标路径。最多并发 2 个/总计 4 个，预算属于整组。返回 runId 后可继续创建或等待。',
        parameters: Type.Object(
          {
            role: Type.Union([
              Type.Literal('reader'),
              Type.Literal('reviewer'),
              Type.Literal('writer'),
            ]),
            prompt: Type.String({ minLength: 1, maxLength: 8000 }),
            paths: Type.Array(Type.String({ maxLength: 220 }), { minItems: 1, maxItems: 64 }),
            budget: Type.Object(
              {
                requests: Type.Integer({ minimum: 1, maximum: 20 }),
                tools: Type.Integer({ minimum: 1, maximum: 100 }),
              },
              { additionalProperties: false },
            ),
          },
          { additionalProperties: false },
        ),
        execute: async (callId, args, signal) => {
          assertRunning(signal);
          return result({
            runId: await this.spawn(
              context.round() + ':' + callId,
              args,
              context.runId + ':' + context.round() + ':tool:' + callId,
            ),
          });
        },
      }),
      defineTool({
        name: 'wait_agents',
        label: '等待子 Agent',
        effect: 'delegate',
        description: '有界等待当前根任务子 Agent，返回完成结果和其余状态；不占模型请求槽。',
        parameters: Type.Object(
          {
            runIds: Type.Array(Type.String(), { minItems: 1, maxItems: 4 }),
            timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 60000 })),
          },
          { additionalProperties: false },
        ),
        execute: async (_, args, signal) => {
          assertRunning(signal);
          context.task.state = 'waiting_children';
          await recorder.persist();
          recorder.publish();
          try {
            await this.wait(args.runIds, args.timeoutMs ?? 30000, signal);
            return result({
              results: await Promise.all(args.runIds.map(id => this.getResult(id))),
            });
          } finally {
            context.task.state = this.groupStop.signal.aborted ? 'cancelling' : 'running';
            await recorder.persist();
            recorder.publish();
          }
        },
      }),
      defineTool({
        name: 'get_agent_result',
        label: '读取子 Agent 结果',
        effect: 'delegate',
        description: '只读取本根任务子 Agent 的持久化公开结果、快照与资料引用。',
        parameters: Type.Object({ runId: Type.String() }, { additionalProperties: false }),
        execute: async (_, args, signal) => {
          assertRunning(signal);
          return result(await this.getResult(args.runId));
        },
      }),
      defineTool({
        name: 'cancel_agent',
        label: '取消子 Agent',
        effect: 'delegate',
        description: '取消本根任务指定子 Agent，其他子任务继续运行。',
        parameters: Type.Object({ runId: Type.String() }, { additionalProperties: false }),
        execute: async (_, args) => {
          await this.cancel(args.runId);
          return result({ runId: args.runId, cancellationRequested: true });
        },
      }),
      defineTool({
        name: 'get_proposal',
        label: '查看写作提案',
        effect: 'read',
        description:
          '只查看本根任务子 Agent 隔离提案的文字/图片变化及冲突状态，尚未合入的内容不属于项目文件。',
        parameters: Type.Object({ proposalId: Type.String() }, { additionalProperties: false }),
        execute: async (_, args, signal) => {
          assertRunning(signal);
          return result(await this.proposals.inspect(this.parent.id, args.proposalId));
        },
      }),
      defineTool({
        name: 'apply_proposal',
        label: '合入写作提案',
        effect: 'workspace-write',
        description:
          '对已完成 writer 提案整批检查基线/候选/当前文件；全部无冲突才合入真实工作区，保留 index/HEAD。冲突保留提案，不覆盖后续修改。',
        parameters: Type.Object({ proposalId: Type.String() }, { additionalProperties: false }),
        execute: async (_, args, signal) => {
          assertRunning(signal);
          const value = await this.proposals.apply(this.parent.id, args.proposalId);
          return { ...result(value), isError: !value.applied };
        },
      }),
    ];
  }
  spawn(invocation: string, input: SpawnRequest, parentTraceId?: string): Promise<string> {
    const work = async () => {
      const invocationId = this.parent.id + ':' + invocation;
      const fingerprint = canonical(input);
      const previous = await this.repository.delegation(invocationId);
      if (previous) {
        if (previous.parentRunId !== this.parent.id || previous.fingerprint !== fingerprint)
          throw new AppError('CONFLICT', '委派调用参数已变化。');
        return previous.childRunId;
      }
      const parentLaunch = await this.repository.launch(this.parent.launchSnapshotRef);
      if (
        !parentLaunch?.agent?.mayDelegate ||
        !parentLaunch.agent.allowedEffects.includes('delegate')
      )
        throw new AppError('VALIDATION', '父角色未获委派权限。');
      if (this.closing || this.groupStop.signal.aborted || this.fatal)
        throw new AppError('CANCELLED', '父任务正在收束，不能创建子任务。');
      if (
        !this.prepared.createChild ||
        this.parent.depth >= this.limits.depth ||
        this.children.size >= this.limits.totalChildren
      )
        throw new AppError('LIMIT', '子 Agent 数量、深度或引擎能力已达到限制。');
      const definition = builtinAgents.find(
        item => item.id === input.role && ['snapshot', 'proposal'].includes(item.workspace),
      );
      if (
        !definition ||
        !input.prompt.trim() ||
        input.prompt.length > 8000 ||
        !input.paths.length ||
        input.paths.length > 64
      )
        throw new AppError('VALIDATION', '子 Agent 角色、目标或资料范围无效。');
      const paths = [...new Set(input.paths.map(path => safePath(path)))];
      this.snapshotRef ??= await this.workspace.inputSnapshot(
        this.parent.projectId,
        this.parent.id,
        this.parent.id,
      );
      const files = await this.workspace.git.entries(this.parent.projectId, this.snapshotRef);
      if (
        paths.some(
          path =>
            path.toLowerCase() === 'project.json' ||
            (definition.workspace === 'proposal'
              ? !/\.(md|txt|png|jpg|jpeg|webp)$/i.test(path)
              : !files.some(file => file.path === path)),
        )
      )
        throw new AppError('VALIDATION', '子任务资料范围包含不存在或受保护的路径。');
      const id = this.id();
      const launch = {
        id,
        agent: definition,
        settings: this.parent.agentSettingsSnapshot,
        model: this.parent.modelSnapshot,
        skills: this.parent.skillsSnapshot,
        selectedPaths: paths,
      };
      const record: RunRecord = {
        schemaVersion: 4,
        id,
        rootRunId: this.parent.rootRunId,
        parentRunId: this.parent.id,
        projectId: this.parent.projectId,
        conversationId: this.parent.conversationId,
        kind: 'child',
        depth: this.parent.depth + 1,
        state: 'queued',
        prompt: input.prompt,
        response: '',
        createdAt: new Date().toISOString(),

        agentDefinitionId: definition.id,
        agentDefinitionRevision: definition.revision,
        launchSnapshotRef: id,
        inputSnapshotRef: this.snapshotRef,
        agentSettingsSnapshot: this.parent.agentSettingsSnapshot,
        modelSnapshot: this.parent.modelSnapshot,
        skillsSnapshot: this.parent.skillsSnapshot,
        deadlineAt: this.budget.snapshot().deadlineAt,
        proposalId: definition.workspace === 'proposal' ? 'proposal-' + id : undefined,
      };
      await this.budget.allocate(id, input.budget, async group => {
        await this.repository.createChild(
          {
            id: invocationId,
            parentRunId: this.parent.id,
            childRunId: id,
            fingerprint,
            parentTraceId,
          },
          record,
          launch,
          group,
        );
      });
      const child: Child = {
        record,
        view: { ...record, trace: [] },
        stop: new RunStopController(id),
        running: false,
        delivered: false,
      };
      this.children.set(id, child);
      if (this.groupStop.reason) child.stop.inherit(this.groupStop.reason);
      const trace = this.context?.task.trace?.find(item => item.id === parentTraceId);
      if (trace?.kind === 'tool') trace.childRunIds = [...(trace.childRunIds ?? []), id];
      this.publish();
      this.pump();
      return id;
    };
    const next = this.queue.catch(() => {}).then(work);
    this.queue = next;
    return next;
  }
  private require(id: string) {
    const child = this.children.get(id);
    if (!child) throw new AppError('VALIDATION', '只能操作本任务已创建的子 Agent。');
    return child;
  }
  async getResult(id: string): Promise<ChildResult> {
    const child = this.require(id);
    const view = await this.repository.view(id);
    if (!view) throw new AppError('STORAGE', '子任务记录丢失。');
    const launch = await this.repository.launch(child.record.launchSnapshotRef);
    const entries = await this.workspace.git.entries(
      child.record.projectId,
      child.record.inputSnapshotRef!,
    );
    if (terminalRun(view.state)) child.delivered = true;
    const proposal = view.proposalId && (await this.proposals.repository.get(view.proposalId));
    return {
      runId: id,
      state: view.state,
      inputSnapshotRef: child.record.inputSnapshotRef,
      response: view.response.slice(0, 12000),
      references: entries.filter(entry => launch?.selectedPaths?.includes(entry.path)),
      warnings: view.error
        ? [view.error]
        : view.state === 'completed'
          ? []
          : ['子任务尚未完成或已中止，请勿声称已经获得完整结果。'],
      proposal: proposal ? await this.proposals.summary(this.parent.id, proposal.id) : undefined,
    };
  }
  async cancel(id: string, ancestor?: StopReason) {
    const child = this.require(id);
    if (ancestor) child.stop.inherit(ancestor);
    else child.stop.cancelUser();
    if (!(await this.repository.cancel(id, child.stop.reason!))) return;
    if (!child.running) {
      child.view = (await this.repository.view(id))!;
      await this.budget.releaseAllocation(id);
      this.publish();
    } else {
      child.view = { ...child.view, state: 'cancelling' };
      this.publish();
    }
  }
  private wait(ids: string[], timeoutMs: number, signal?: AbortSignal): Promise<void> {
    ids.forEach(id => this.require(id));
    if (signal?.aborted) return Promise.reject(new AppError('CANCELLED', '等待子任务已取消。'));
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let unsubscribe = () => {};
      const finish = (cancel = false) => {
        if (timer) clearTimeout(timer);
        unsubscribe();
        signal?.removeEventListener('abort', cancelled);
        if (cancel) reject(new AppError('CANCELLED', '等待子任务已取消。'));
        else resolve();
      };
      const check = () => {
        if (ids.every(id => terminalRun(this.require(id).view.state))) finish();
      };
      const cancelled = () => finish(true);
      unsubscribe = this.signal.subscribe(check);
      signal?.addEventListener('abort', cancelled, { once: true });
      timer = setTimeout(() => finish(), Math.min(timeoutMs, this.budget.remainingMs()));
      check();
    });
  }
  async settle(cancel: boolean): Promise<ChildResult[]> {
    this.closing = true;
    await this.queue.catch(() => {});
    if (cancel || this.groupStop.signal.aborted || this.fatal)
      for (const child of this.children.values())
        if (!terminalRun(child.view.state)) {
          await this.cancel(
            child.record.id,
            this.groupStop.reason ?? {
              kind: 'engine_error',
              originRunId: this.parent.id,
              at: new Date().toISOString(),
              error: { code: 'CANCELLED', message: '父任务已结束，停止未收束的子任务。' },
            },
          );
        }
    await Promise.all([...this.children.values()].map(child => child.done));
    // A parallel queue may have started later children while the first await ran.
    while ([...this.children.values()].some(child => !terminalRun(child.view.state))) {
      this.pump();
      await this.wait([...this.children.keys()], Math.max(1, this.budget.remainingMs()));
    }
    if (this.fatal) throw new AppError('STORAGE', this.fatal);
    this.proposals.assertSettled();
    return Promise.all([...this.children.keys()].map(id => this.getResult(id)));
  }
  private pump() {
    let slots =
      this.limits.parallelChildren -
      [...this.children.values()].filter(child => child.running && !terminalRun(child.view.state))
        .length;
    for (const child of this.children.values())
      if (slots && !child.running && !terminalRun(child.view.state)) {
        slots--;
        child.running = true;
        child.done = this.execute(child);
      }
  }
  private async execute(child: Child) {
    try {
      const launch = (await this.repository.launch(child.record.launchSnapshotRef))!;
      const definition = launch.agent!;
      if (child.stop.signal.aborted) {
        await this.repository.cancel(child.record.id, child.stop.reason!);
        child.view = (await this.repository.view(child.record.id))!;
        await this.budget.releaseAllocation(child.record.id);
      } else
        child.view = await executeChild(
          child.record,
          launch,
          definition,
          this.prepared,
          this.workspace,
          this.repository,
          this.budget,
          this.requests,
          child.stop,
          this.groupStop,
          view => {
            if (!terminalRun(view.state)) {
              child.view = view;
              this.publish();
            }
          },
          this.nextGroupSequence,
          this.proposals,
        );
    } catch (error) {
      const run = await this.repository.get(child.record.id).catch(() => undefined);
      if (run?.state === 'queued' || run?.state === 'cancelled') {
        try {
          child.stop.fail(error);
          await this.repository.save({
            ...run,
            ...child.stop.resolve({ stopReason: 'error' }, this.prepared.launch.outputTokens),
          });
          child.view = (await this.repository.view(run.id))!;
          await this.budget.releaseAllocation(run.id);
        } catch {
          this.fatal = '子任务状态保存失败，请重新打开应用恢复。';
        }
      } else this.fatal = '子任务状态保存失败，请重新打开应用恢复。';
      if (this.fatal) {
        child.view = { ...child.view, state: 'interrupted', error: this.fatal };
        this.groupStop.fail(new AppError('STORAGE', this.fatal));
      }
    } finally {
      child.running = false;
      this.publish();
      this.pump();
    }
  }
}
