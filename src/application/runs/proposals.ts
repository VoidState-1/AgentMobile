import { SerialQueue } from '@/core/serial-queue';
import type { ChangeProposal } from '@/core/runs/proposals';
import type { RunRecord } from '@/core/runs/records';
import { terminalRun } from '@/core/runs/records';
import { safePath, isImage } from '@/core/workspace/path';
import type { ContentCodec } from '@/core/storage/codec';
import { AppError } from '@/core/errors';
import type { WorkspaceApplication } from '@/application/workspace/service';
import type { RunRepository } from './repository';
import { ProposalRepository } from './proposal-repository';
import { ProposalOverlay } from './proposal-overlay';

export class ProposalService {
  readonly repository: ProposalRepository;
  private readonly queues = new Map<string, SerialQueue>();
  private receiptFailure?: string;
  constructor(
    private readonly workspace: WorkspaceApplication,
    private readonly runs: RunRepository,
    private readonly codec: ContentCodec,
  ) {
    this.repository = new ProposalRepository(workspace.metadata);
  }
  private exclusive<T>(id: string, work: () => Promise<T>): Promise<T> {
    let queue = this.queues.get(id);
    if (!queue) {
      queue = new SerialQueue();
      this.queues.set(id, queue);
    }
    return queue.run(work);
  }
  assertSettled() {
    if (this.receiptFailure) throw new AppError('STORAGE', this.receiptFailure);
  }
  private async saveReceipt(proposal: ChangeProposal) {
    try {
      await this.repository.save(proposal);
    } catch {
      this.receiptFailure = '提案合入回执保存失败，请重新打开应用恢复。';
      throw new AppError('STORAGE', this.receiptFailure);
    }
  }
  async create(source: RunRecord): Promise<ProposalOverlay> {
    const launch = await this.runs.launch(source.launchSnapshotRef);
    const root = await this.runs.get(source.rootRunId);
    if (
      source.kind !== 'child' ||
      launch?.agent?.workspace !== 'proposal' ||
      !root ||
      root.projectId !== source.projectId ||
      !source.inputSnapshotRef
    )
      throw new AppError('VALIDATION', '写作子任务与根任务范围不匹配。');
    const paths = [...new Set((launch.selectedPaths ?? []).map(path => safePath(path)))];
    if (new Set(paths.map(path => path.toLowerCase())).size !== paths.length)
      throw new AppError('VALIDATION', '提案路径大小写重复。');
    if (!paths.length || paths.some(path => path.toLowerCase() === 'project.json'))
      throw new AppError('VALIDATION', '写作提案需要授权路径，不能包含项目配置。');
    const id = 'proposal-' + source.id;
    let proposal = await this.repository.get(id);
    if (!proposal) {
      const now = new Date().toISOString();
      proposal = {
        schemaVersion: 1,
        id,
        rootRunId: root.id,
        sourceRunId: source.id,
        projectId: source.projectId,
        baseSnapshot: source.inputSnapshotRef,
        candidateSnapshot: source.inputSnapshotRef,
        allowedPaths: paths,
        changedPaths: [],
        state: 'draft',
        sourceState: 'running',
        createdAt: now,
        updatedAt: now,
      };
      await this.repository.save(proposal);
    } else if (
      proposal.sourceRunId !== source.id ||
      proposal.rootRunId !== root.id ||
      proposal.baseSnapshot !== source.inputSnapshotRef
    )
      throw new AppError('CONFLICT', '提案创建回执与原始范围不匹配。');
    return new ProposalOverlay(proposal, this.repository, this.workspace, this.codec);
  }
  private async require(rootRunId: string, id: string) {
    const proposal = await this.repository.get(id);
    const root = await this.runs.get(rootRunId);
    const source = proposal && (await this.runs.get(proposal.sourceRunId));
    if (
      !proposal ||
      !root ||
      root.kind !== 'root' ||
      proposal.rootRunId !== rootRunId ||
      proposal.projectId !== root.projectId ||
      source?.parentRunId !== rootRunId ||
      source.kind !== 'child'
    )
      throw new AppError('VALIDATION', '只能查看或合入当前根任务子 Agent 的提案。');
    const launch = await this.runs.launch(source.launchSnapshotRef);
    if (
      launch?.agent?.workspace !== 'proposal' ||
      proposal.allowedPaths.some(path => !launch.selectedPaths?.includes(path))
    )
      throw new AppError('VALIDATION', '提案路径超出冻结授权。');
    return { proposal, root, source };
  }
  async summary(rootRunId: string, id: string) {
    const { proposal } = await this.require(rootRunId, id);
    return {
      id: proposal.id,
      state: proposal.state,
      sourceState: proposal.sourceState,
      paths: proposal.changedPaths,
      conflicts: proposal.conflicts,
    };
  }
  async inspect(rootRunId: string, id: string) {
    const { proposal } = await this.require(rootRunId, id);
    const changes = await this.workspace.changes(
      proposal.projectId,
      proposal.baseSnapshot,
      proposal.candidateSnapshot,
    );
    let remaining = 80000;
    return {
      ...(await this.summary(rootRunId, id)),
      files: changes
        .filter(change => proposal.allowedPaths.includes(change.path))
        .map(change => {
          const limit = Math.max(0, Math.min(6000, Math.floor(remaining / 2)));
          remaining -= limit * 2;
          return isImage(change.path)
            ? { path: change.path, status: change.status, image: true, before: '', after: '' }
            : {
                ...change,
                before: change.before.slice(0, limit),
                after: change.after.slice(0, limit),
                truncated: change.before.length > limit || change.after.length > limit,
              };
        }),
    };
  }
  async preview(rootRunId: string, id: string) {
    const { proposal } = await this.require(rootRunId, id);
    return {
      ...(await this.summary(rootRunId, id)),
      files: (
        await this.workspace.changes(
          proposal.projectId,
          proposal.baseSnapshot,
          proposal.candidateSnapshot,
        )
      ).filter(change => proposal.allowedPaths.includes(change.path)),
    };
  }
  apply(rootRunId: string, id: string) {
    return this.exclusive(id, async () => {
      const { proposal, root, source } = await this.require(rootRunId, id);
      if (terminalRun(root.state) || ['queued', 'cancelling'].includes(root.state))
        throw new AppError('CANCELLED', '根任务已停止，不能合入提案。');
      if (proposal.state === 'applied')
        return { id, applied: true, alreadyApplied: true, changedPaths: proposal.changedPaths };
      if (source.state !== 'completed' || !['ready', 'conflicted'].includes(proposal.state))
        throw new AppError('CONFLICT', '只允许合入已完成子任务的完整提案。');
      const operationId = proposal.operationId ?? 'merge-' + proposal.id;
      const result = await this.workspace.mergeCandidate(
        proposal.projectId,
        {
          rootRunId,
          actorRunId: source.id,
          proposalId: id,
          operationId,
          baseSnapshot: proposal.baseSnapshot,
          candidateSnapshot: proposal.candidateSnapshot,
          paths: proposal.allowedPaths,
        },
        () =>
          this.saveReceipt({
            ...proposal,
            state: 'applying',
            operationId,
            updatedAt: new Date().toISOString(),
          }),
      );
      const next: ChangeProposal = {
        ...proposal,
        operationId,
        state: result.conflicts.length ? 'conflicted' : 'applied',
        conflicts: result.conflicts,
        updatedAt: new Date().toISOString(),
      };
      await this.saveReceipt(next);
      return {
        id,
        applied: !result.conflicts.length,
        conflicts: result.conflicts,
        changedPaths: result.changedPaths,
      };
    });
  }
  /** Called after file journals and before run trees. No model or tool replay. */
  async recover() {
    const writes = (await this.repository.writes())
      .filter(write => write.phase === 'prepared')
      .sort((a, b) => a.proposalId.localeCompare(b.proposalId) || a.sequence - b.sequence);
    for (const write of writes) {
      const proposal = await this.repository.get(write.proposalId);
      if (!proposal) throw new AppError('STORAGE', '提案恢复日志缺少归属记录。');
      const checkpoint = await this.workspace.git.checkpointRef(
        write.projectId,
        write.checkpointKey,
      );
      if (!checkpoint) {
        await this.repository.prepare({ ...write, phase: 'cancelled' });
        continue;
      }
      const base = await this.workspace.git.entries(write.projectId, proposal.baseSnapshot);
      const after = await this.workspace.git.entries(write.projectId, checkpoint);
      const before = new Map(base.map(file => [file.path, file.revision]));
      const candidate = new Map(after.map(file => [file.path, file.revision]));
      const changedPaths = [...new Set([...before.keys(), ...candidate.keys()])].filter(
        path => before.get(path) !== candidate.get(path),
      );
      if (changedPaths.some(path => !proposal.allowedPaths.includes(path)))
        throw new AppError('STORAGE', '提案恢复树超出授权范围。');
      await this.repository.record(
        {
          ...proposal,
          candidateSnapshot: checkpoint,
          changedPaths,
          updatedAt: new Date().toISOString(),
        },
        { ...write, candidateSnapshot: checkpoint, phase: 'recorded' },
      );
    }
    for (const proposal of await this.repository.all()) {
      const source = await this.runs.get(proposal.sourceRunId);
      if (proposal.state === 'applying') {
        const operation =
          proposal.operationId &&
          (await this.workspace.metadata.operation(
            this.workspace.journal.scope(proposal.projectId),
            proposal.operationId,
          ));
        if (operation && operation.phase !== 'recorded') continue;
        await this.repository.save({
          ...proposal,
          state: operation ? 'applied' : source?.state === 'completed' ? 'ready' : 'interrupted',
          updatedAt: new Date().toISOString(),
        });
      } else if (proposal.state === 'draft' || (source && !terminalRun(source.state))) {
        await this.repository.save({
          ...proposal,
          state: 'interrupted',
          sourceState: 'interrupted',
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }
}
