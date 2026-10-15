import { SerialQueue } from '@/core/serial-queue';
import type { MetadataEntry } from '@/core/storage/contracts';
import type { BusinessStore } from '@/core/storage/business-store';
import type { ExecutionView } from '@/core/runs/types';
import { terminalRun, type DelegationReceipt, type LaunchSnapshot, type RunRecord, type RunHeader, type RunWrite } from '@/core/runs/records';
import { runQueryLimits, type RunHeaderQuery, type RunPage, type RunSummary, type RunDetail, type RunChange } from '@/core/runs/queries';
import type { TraceItem } from '@/core/trace';
import { AppError } from '@/core/errors';
import { historyEntries } from './context';
import type { RunPersistence } from './persistence';
import type { RunGroupRecord } from '@/core/runs/groups';
import { stoppedOutcome, type StopReason } from '@/core/runs/termination';
import { textEnd, traceLimits, type TraceNode, type TraceWrite, type TranscriptFrame, type TracePage, type TextPage } from '@/core/runs/trace-storage';
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const preview = (text: string, limit: number) => {
    let value = text.slice(0, limit);
    const tail = value.charCodeAt(value.length - 1);
    if (tail >= 0xd800 && tail <= 0xdbff)
        value = value.slice(0, -1);
    return value;
};
const summary = (header: RunHeader): RunSummary => ({ id: header.id, projectId: header.projectId, conversationId: header.conversationId,
    rootRunId: header.rootRunId, parentRunId: header.parentRunId, kind: header.kind, state: header.state, mode: header.mode,
    admissionSequence: header.admissionSequence, revision: header.revision, promptPreview: header.promptPreview, responsePreview: header.responsePreview,
    promptCharacters: header.promptCharacters, responseCharacters: header.responseCharacters, modelName: header.modelName, connectionName: header.connectionName,
    childCount: header.childCount, changedFileCount: header.changedFileCount, createdAt: header.createdAt, error: header.error, proposalId: header.proposalId });
function writeValue(run: RunRecord, previous?: RunHeader, childCount = 0): RunWrite {
    const reason = run.stopReason;
    const code = reason?.kind === 'engine_error' ? reason.error.code : reason?.kind === 'deadline' || reason?.kind === 'budget_exhausted' ||
        (reason?.kind === 'ancestor_stopped' && ['deadline', 'budget_exhausted'].includes(reason.cause)) ? 'LIMIT' : 'UNKNOWN';
    return { expectedRevision: previous?.revision ?? 0,
        input: previous ? undefined : { prompt: run.prompt }, result: { response: run.response, skillActivations: run.skillActivations },
        header: { schemaVersion: 3, id: run.id, projectId: run.projectId, conversationId: run.conversationId, rootRunId: run.rootRunId, parentRunId: run.parentRunId,
            kind: run.kind, depth: run.depth, agentDefinitionId: run.agentDefinitionId, agentDefinitionRevision: run.agentDefinitionRevision, state: run.state, mode: run.mode,
            launchSnapshotRef: run.launchSnapshotRef, inputSnapshotRef: run.inputSnapshotRef, draftRevision: run.draftRevision, deadlineAt: run.deadlineAt,
            delegationSnapshotRef: run.delegationSnapshotRef, proposalId: run.proposalId, baseCommit: run.baseCommit, finalCommit: run.finalCommit,
            baseSnapshot: run.baseSnapshot, finalSnapshot: run.finalSnapshot, baseIndexSnapshot: run.baseIndexSnapshot, finalIndexSnapshot: run.finalIndexSnapshot,
            changedPaths: run.changedPaths, uncommittedPaths: run.uncommittedPaths, stopReason: reason, error: run.error ? { code, message: run.error } : undefined,
            createdAt: run.createdAt, promptPreview: preview(run.prompt, runQueryLimits.promptPreview), responsePreview: preview(run.response, runQueryLimits.responsePreview),
            promptCharacters: run.prompt.length, responseCharacters: run.response.length, modelName: run.modelSnapshot?.modelName,
            connectionName: run.modelSnapshot?.connectionName, childCount, changedFileCount: run.changedPaths?.length ?? 0 } };
}
/** Normalized current entities. Lists read only indexed headers, never inputs/results/trace. */
export class RunRepository {
    private readonly queue = new SerialQueue();
    private readonly listeners = new Set<(change: RunChange) => void>();
    constructor(private readonly store: BusinessStore) { }
    subscribe = (listener: (change: RunChange) => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
    private notify(run: Pick<RunRecord, 'id' | 'projectId' | 'conversationId' | 'rootRunId' | 'state'>) {
        const change = Object.freeze({ runId: run.id, projectId: run.projectId, conversationId: run.conversationId, rootRunId: run.rootRunId, state: run.state });
        for (const listener of this.listeners) {
            try {
                listener(change);
            }
            catch { /* Views do not own durable writes. */ }
        }
    }
    private exclusive<T>(work: () => Promise<T>) {
        return this.queue.run(work);
    }
    async acceptedDraft(projectId: string, conversationId: string, revision: number): Promise<boolean> {
        const receipt = await this.store.get<{
            projectId: string;
            conversationId: string;
        }>('accepted-drafts', conversationId + '/' + revision);
        if (receipt && (receipt.projectId !== projectId || receipt.conversationId !== conversationId))
            throw new AppError('CONFLICT', '草稿回执归属不匹配。');
        return !!receipt;
    }
    async get(id: string): Promise<RunRecord | undefined> {
        const header = await this.store.run(id);
        if (!header)
            return;
        const [input, result, launch] = await Promise.all([this.store.runInput(id), this.store.runResult(id), this.launch(header.launchSnapshotRef)]);
        if (!input || !result)
            throw new AppError('STORAGE', '运行输入或结果记录缺失。');
        return { ...header, ...input, ...result, error: header.error?.message, modelSnapshot: launch?.model, agentSettingsSnapshot: launch?.settings,
            mcpSnapshot: launch?.mcp, skillsSnapshot: launch?.skills };
    }
    launch(id: string) { return this.store.get<LaunchSnapshot>('run-launches', id); }
    private async traceWrite(changes: TraceItem[], frames: TranscriptFrame[]): Promise<TraceWrite> {
        const nodes: NonNullable<TraceWrite['nodes']>[number][] = [];
        const chunks: NonNullable<TraceWrite['chunks']>[number][] = [];
        for (const item of changes) {
            const previous = await this.store.traceNode(item.id);
            if (!item.runId || !item.rootRunId || item.runSequence === undefined || item.groupSequence === undefined)
                throw new AppError('STORAGE', '轨迹缺少宿主分配的身份或顺序。');
            const text = item.kind === 'tool' ? '' : item.text;
            if (previous && (text.length < previous.textCharacters || (previous.state !== 'running' && item.state === 'running')))
                continue;
            const { text: _text, ...fields } = item.kind === 'tool' ? { ...item, text: '' } : item;
            let ordinal = previous?.textChunks ?? 0;
            let offset = previous?.textCharacters ?? 0;
            while (offset < text.length) {
                const end = textEnd(text, offset, traceLimits.chunkCharacters);
                const value = text.slice(offset, end);
                chunks.push({ nodeId: item.id, ordinal: ordinal++, offset, text: value, characters: value.length });
                offset = end;
            }
            const childRunIds = item.kind === 'tool' ? [...new Set([...(previous?.kind === 'tool' ? previous.childRunIds ?? [] : []), ...item.childRunIds ?? []])] : undefined;
            const node: TraceNode = { ...fields, ...(item.kind === 'tool' ? { childRunIds } : {}),
                runId: item.runId, rootRunId: item.rootRunId, runSequence: item.runSequence, groupSequence: item.groupSequence,
                revision: (previous?.revision ?? 0) + 1, textPreview: text.slice(0, textEnd(text, 0, traceLimits.previewCharacters)), textCharacters: text.length, textChunks: ordinal };
            if (previous && JSON.stringify({ ...previous, revision: 0 }) === JSON.stringify({ ...node, revision: 0 }))
                continue;
            nodes.push({ node, expectedRevision: previous?.revision ?? 0 });
        }
        return { nodes, chunks, frames };
    }
    private async write(run: RunRecord, launch?: LaunchSnapshot, changes: TraceItem[] = [], frames: TranscriptFrame[] = [], saveResult = true): Promise<void> {
        const previous = await this.store.run(run.id);
        if (previous && terminalRun(previous.state))
            return;
        if (previous && previous.state === 'cancelling' && !terminalRun(run.state))
            run.state = 'cancelling';
        if (run.state !== 'interrupted')
            run.stopReason = previous?.stopReason ?? run.stopReason;
        if (run.stopReason && terminalRun(run.state) && run.state !== 'interrupted')
            Object.assign(run, stoppedOutcome(run.stopReason));
        if (previous && (await this.store.runInput(run.id))?.prompt !== run.prompt)
            throw new AppError('CONFLICT', '冻结的运行目标不能修改。');
        const metadata: MetadataEntry[] = [];
        if (!previous && run.kind === 'root' && run.draftRevision !== undefined)
            metadata.push({ bucket: 'accepted-drafts', id: run.conversationId + '/' + run.draftRevision,
                value: { projectId: run.projectId, conversationId: run.conversationId, runId: run.id } });
        if (launch)
            metadata.push({ bucket: 'run-launches', id: launch.id, value: launch });
        const update = writeValue(run, previous, previous?.childCount);
        if (previous && !saveResult)
            update.result = undefined;
        await this.store.writeBusiness({ runs: [update], metadata, trace: await this.traceWrite(changes, frames) });
        this.notify(run);
    }
    save(run: RunRecord, launch?: LaunchSnapshot, trace?: TraceItem[]): Promise<void> {
        const frozen = copy(run);
        const frozenLaunch = launch && copy(launch);
        const frozenTrace = trace && copy(trace);
        return this.exclusive(() => this.write(frozen, frozenLaunch, frozenTrace));
    }
    saveCheckpoint(task: ExecutionView, changes: TraceItem[], frames: TranscriptFrame[], saveResult: boolean): Promise<void> {
        const value = copy(task);
        delete value.children;
        const { trace, ...fields } = value;
        const delta = copy(changes);
        const frameCopies = copy(frames);
        return this.exclusive(async () => {
            const previous = await this.get(task.id);
            if (!previous)
                throw new AppError('STORAGE', '运行记录不存在。');
            await this.write({ ...previous, ...fields, conversationId: fields.conversationId ?? previous.conversationId,
                kind: fields.kind ?? previous.kind, inputSnapshotRef: fields.baseSnapshot ?? previous.inputSnapshotRef }, undefined, delta, frameCopies, saveResult);
        });
    }
    cancel(id: string, reason: StopReason = { kind: 'user_cancel', originRunId: id, at: new Date().toISOString() }): Promise<boolean> {
        return this.exclusive(async () => {
            const run = await this.get(id);
            if (!run || terminalRun(run.state))
                return false;
            await this.write({ ...run, stopReason: run.stopReason ?? reason, state: run.state === 'queued' ? stoppedOutcome(reason).state : 'cancelling' });
            return true;
        });
    }
    execution(): RunPersistence {
        return { saveCheckpoint: (task, changes, frames, saveResult) => this.saveCheckpoint(task, changes, frames, saveResult),
            history: async (query) => {
                if (!query.count)
                    return [];
                const headers = await this.store.runs({ projectId: query.projectId, conversationId: query.conversationId, kind: 'root', mode: query.mode, active: false, limit: query.count });
                const history = await Promise.all(headers.map(async (header) => {
                    const [input, result] = await Promise.all([this.store.runInput(header.id), this.store.runResult(header.id)]);
                    if (!input || !result)
                        throw new AppError('STORAGE', '会话历史输入或结果缺失。');
                    return { prompt: input.prompt, response: result.response, createdAt: header.createdAt };
                }));
                return historyEntries(history.reverse(), query.count, query.characters);
            } };
    }
    async view(id: string): Promise<ExecutionView | undefined> {
        const run = await this.get(id);
        if (!run)
            return;
        const children = run.kind === 'root' ? await this.children(run.rootRunId) : undefined;
        return { ...run, trace: await this.trace(id), ...(children?.length ? { children } : {}) };
    }
    async getDetail(id: string): Promise<RunDetail> {
        const header = await this.store.run(id);
        if (!header)
            throw new AppError('VALIDATION', '运行不存在。');
        const [input, result] = await Promise.all([this.store.runInput(id), this.store.runResult(id)]);
        if (!input || !result)
            throw new AppError('STORAGE', '运行输入或结果记录缺失。');
        const run = { ...header, ...input, ...result };
        return { id: run.id, projectId: run.projectId, conversationId: run.conversationId, kind: run.kind, state: run.state, mode: run.mode,
            prompt: run.prompt, response: run.response, createdAt: run.createdAt, modelName: run.modelName, connectionName: run.connectionName,
            error: run.error, stopReason: run.stopReason, proposalId: run.proposalId, baseCommit: run.baseCommit, finalCommit: run.finalCommit, baseSnapshot: run.baseSnapshot,
            finalSnapshot: run.finalSnapshot, baseIndexSnapshot: run.baseIndexSnapshot, finalIndexSnapshot: run.finalIndexSnapshot,
            changedPaths: run.changedPaths, uncommittedPaths: run.uncommittedPaths };
    }
    async children(rootRunId: string): Promise<ExecutionView[]> {
        const records = await this.group(rootRunId);
        return Promise.all(records.filter(run => run.kind === 'child').map(async (run) => ({ ...run, trace: await this.trace(run.id) })));
    }
    async active(): Promise<RunRecord[]> {
        const headers = await this.store.runs({ active: true, limit: 100 });
        return Promise.all(headers.map(async (header) => (await this.get(header.id))!));
    }
    async list(projectId: string, conversationId?: string, cursor?: string, limit: number = runQueryLimits.page): Promise<RunPage> {
        return this.page({ projectId, conversationId, kind: 'root', limit }, cursor);
    }
    private async page(query: RunHeaderQuery, cursor?: string): Promise<RunPage> {
        if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > runQueryLimits.maxPage)
            throw new AppError('VALIDATION', '运行查询每页需要 1–100 条。');
        const scope = JSON.stringify({ projectId: query.projectId, conversationId: query.conversationId, rootRunId: query.rootRunId, kind: query.kind });
        let position: {
            instance: string;
            scope: string;
            highWater: number;
            before: number;
        } | undefined;
        if (cursor) {
            try {
                position = JSON.parse(cursor);
            }
            catch {
                throw new AppError('CONFLICT', '运行列表游标无效，请重新读取。');
            }
            if (!position || position.instance !== this.store.dataInstanceId || position.scope !== scope || !Number.isSafeInteger(position.highWater) ||
                !Number.isSafeInteger(position.before) || position.before < 1 || position.highWater < position.before)
                throw new AppError('CONFLICT', '运行列表游标与数据实例或查询范围不匹配。');
        }
        const headers = await this.store.runs({ ...query, highWater: position?.highWater, beforeSequence: position?.before, limit: Math.min(query.limit + 1, 100) });
        const selected = headers.slice(0, query.limit);
        const highWater = position?.highWater ?? selected[0]?.admissionSequence;
        return { runs: selected.map(summary), cursor: headers.length > query.limit || (query.limit === 100 && headers.length === 100) ?
                JSON.stringify({ instance: this.store.dataInstanceId, scope, highWater, before: selected.at(-1)!.admissionSequence }) : undefined };
    }
    listChildren(rootRunId: string, cursor?: string, limit: number = runQueryLimits.page) { return this.page({ rootRunId, kind: 'child', limit }, cursor); }
    async group(rootRunId: string): Promise<RunRecord[]> {
        const headers = await this.store.runs({ rootRunId, limit: 100 });
        return (await Promise.all(headers.map(async (header) => (await this.get(header.id))!))).reverse();
    }
    delegation(id: string) { return this.store.get<DelegationReceipt>('run-delegations', id); }
    createChild(receipt: DelegationReceipt, child: RunRecord, launch: LaunchSnapshot, group?: RunGroupRecord): Promise<string> {
        return this.exclusive(async () => {
            const previous = await this.delegation(receipt.id);
            if (previous) {
                if (previous.parentRunId !== receipt.parentRunId || previous.fingerprint !== receipt.fingerprint)
                    throw new AppError('CONFLICT', '委派调用与已保存参数不匹配。');
                return previous.childRunId;
            }
            const parent = await this.store.run(receipt.parentRunId);
            if (!parent || terminalRun(parent.state) || parent.state === 'cancelling' || child.parentRunId !== parent.id || child.rootRunId !== parent.rootRunId ||
                child.projectId !== parent.projectId || child.conversationId !== parent.conversationId || receipt.childRunId !== child.id || child.launchSnapshotRef !== launch.id || (group && group.rootRunId !== parent.rootRunId))
                throw new AppError('VALIDATION', '子任务与父任务的范围不匹配。');
            if (await this.store.run(child.id))
                throw new AppError('CONFLICT', '子任务标识已存在。');
            const metadata: MetadataEntry[] = [{ bucket: 'run-launches', id: launch.id, value: launch }, { bucket: 'run-delegations', id: receipt.id, value: receipt }];
            if (group)
                metadata.push({ bucket: 'run-groups', id: group.rootRunId, value: group });
            const tool = receipt.parentTraceId ? await this.store.traceNode(receipt.parentTraceId) : undefined;
            if (receipt.parentTraceId && (tool?.kind !== 'tool' || tool.runId !== parent.id))
                throw new AppError('CONFLICT', '委派工具意图未保存，不能创建子任务。');
            const { revision: _revision, admissionSequence: _sequence, ...parentFields } = parent;
            await this.store.writeBusiness({ runs: [writeValue(child), { header: { ...parentFields, childCount: parent.childCount + 1 }, expectedRevision: parent.revision }], metadata,
                trace: tool?.kind === 'tool' ? { nodes: [{ node: { ...tool, revision: tool.revision + 1, childRunIds: [...tool.childRunIds ?? [], child.id] }, expectedRevision: tool.revision }] } : undefined });
            this.notify(child);
            this.notify(parent);
            return child.id;
        });
    }
    async listTrace(runId: string, cursor?: string): Promise<TracePage> {
        let after = 0;
        if (cursor) {
            let position: {
                instance: string;
                runId: string;
                after: number;
            };
            try {
                position = JSON.parse(cursor);
            }
            catch {
                throw new AppError('CONFLICT', '轨迹游标无效。');
            }
            if (position.instance !== this.store.dataInstanceId || position.runId !== runId || !Number.isSafeInteger(position.after) || position.after < 0)
                throw new AppError('CONFLICT', '轨迹游标不属于当前运行。');
            after = position.after;
        }
        const values = await this.store.traceNodes(runId, after, traceLimits.nodes + 1);
        const nodes = values.slice(0, traceLimits.nodes);
        return { nodes, cursor: values.length > nodes.length ? JSON.stringify({ instance: this.store.dataInstanceId, runId, after: nodes.at(-1)!.runSequence }) : undefined };
    }
    async readTraceText(nodeId: string, offset = 0): Promise<TextPage> {
        const node = await this.store.traceNode(nodeId);
        if (!node || node.kind === 'tool' || !Number.isInteger(offset) || offset < 0 || offset > node.textCharacters)
            throw new AppError('VALIDATION', '轨迹文本或读取位置无效。');
        let text = '';
        const target = Math.min(traceLimits.textCharacters, node.textCharacters - offset);
        while (text.length < target) {
            const before = text.length;
            const page = await this.store.traceTextRange(nodeId, offset + text.length, 8);
            if (!page.length)
                throw new AppError('STORAGE', '轨迹正文块缺失。');
            for (const chunk of page) {
                const start = Math.max(0, offset + text.length - chunk.offset);
                const first = chunk.text.charCodeAt(start);
                if (first >= 0xdc00 && first <= 0xdfff)
                    throw new AppError('VALIDATION', '读取位置不能位于 Unicode 代理对中间。');
                const end = textEnd(chunk.text, start, target - text.length);
                const value = chunk.text.slice(start, end);
                text += value;
                if (text.length >= target || !value.length || end < chunk.text.length)
                    break;
            }
            if (text.length === before)
                throw new AppError('STORAGE', '轨迹正文块不连续。');
            if (text.length && text.length < target && target - text.length === 1)
                break;
        }
        const end = offset + text.length;
        return { text, offset, totalCharacters: node.textCharacters, nextOffset: end < node.textCharacters ? end : undefined };
    }
    async trace(id: string): Promise<TraceItem[]> {
        const values: TraceItem[] = [];
        let after = 0;
        while (true) {
            const nodes = await this.store.traceNodes(id, after, 100);
            if (!nodes.length)
                break;
            for (const node of nodes) {
                if (node.kind === 'tool')
                    values.push(node);
                else {
                    let text = '';
                    let offset = 0;
                    while (offset < node.textCharacters) {
                        const page = await this.readTraceText(node.id, offset);
                        text += page.text;
                        offset += page.text.length;
                    }
                    values.push({ ...node, text });
                }
            }
            after = nodes.at(-1)!.runSequence;
        }
        return values;
    }
    async transcript(id: string): Promise<TranscriptFrame[]> {
        const result: TranscriptFrame[] = [];
        let after = -1;
        while (true) {
            const frames = await this.store.transcriptFrames(id, after, 100);
            result.push(...frames);
            if (frames.length < 100)
                return result;
            after = frames.at(-1)!.ordinal;
        }
    }
}
