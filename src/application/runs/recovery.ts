import type { WorkspaceApplication } from '@/application/workspace/service';
import type { McpAttempt } from '@/core/mcp/types';
import { settleTrace } from '@/core/trace';
import type { RunRepository } from './repository';
/** Recovery reads checkpoints and receipts only; it never creates an engine. */
export async function recoverRuns(repository: RunRepository, workspace: WorkspaceApplication, unknownMcp: McpAttempt[], proposalSnapshot?: (id: string) => Promise<string | undefined>): Promise<void> {
    const active = (await repository.active()).sort((a, b) => b.depth - a.depth || a.createdAt.localeCompare(b.createdAt));
    for (const run of active) {
        const trace = await repository.trace(run.id);
        const ownUnknown = unknownMcp.filter((attempt) => attempt.taskId === run.id);
        const now = new Date().toISOString();
        const lastRound = trace.reduce((round, node) => Math.max(round, node.round), 0);
        const response = lastRound ? trace.filter(node => node.kind === 'text' && node.round === lastRound).map(node => node.kind === 'text' ? node.text : '').join('\n\n') : run.response;
        const view = { ...run, response, trace };
        let snapshotFailed = false;
        const result = run.kind === 'child' ? { ...view, finalSnapshot: (run.proposalId ? await proposalSnapshot?.(run.proposalId) : undefined) ?? run.finalSnapshot ?? run.inputSnapshotRef, changedPaths: [] } :
            run.baseSnapshot ? await workspace.taskFinal(view, true).catch(() => { snapshotFailed = true; return view; }) : view;
        const settled = settleTrace(trace.map((item) => item.kind === 'tool' && ownUnknown.some((attempt) => attempt.traceId === item.id) ?
            { ...item, state: 'unknown', output: '远端结果未知，可能已执行。请在 MCP 设置中核对后解除重试限制。', endedAt: now } : item), 'interrupted', now);
        await repository.saveCheckpoint({ ...result, state: 'interrupted', stopReason: { kind: 'app_interrupted', at: now,
                previous: run.stopReason?.kind === 'app_interrupted' ? run.stopReason.previous : run.stopReason },
            trace: settled,
            error: workspace.needsRecovery(run.projectId) ? '部分修改尚未完成恢复，请保留本地数据。' : snapshotFailed ? '任务快照恢复失败，请保留本地数据并核对工作区。' : ownUnknown.length ?
                '任务已中断，部分 MCP 调用的远端结果未知，请先核对服务状态。' : run.state === 'queued' ?
                '应用中断了待启动任务。未发送模型请求，可根据保留的目标发起新任务。' : '应用运行被中断，文件修改已恢复。可查看已完成结果后发起新任务。',
        }, settled ?? [], [], true);
    }
}
