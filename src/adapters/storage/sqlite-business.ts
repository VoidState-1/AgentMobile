import type { SQLiteDatabase, SQLiteBindValue } from 'expo-sqlite';
import { AppError } from '@/core/errors';
import { CURRENT_DATA_FORMAT, type BusinessStore, type BusinessWriteBatch } from '@/core/storage/business-store';
import { assertOperationUpdate, sameOperation, type JournalScope, type OperationBody, type OperationDraft, type OperationHeader } from '@/core/workspace/journal';
import type { MetadataEntry } from '@/core/storage/contracts';
import { assertRunWrite, terminalRun, type RunHeader, type RunInput, type RunResult } from '@/core/runs/records';
import { assertTraceAppend, assertTraceUpdate, type TraceNode, type TraceTextChunk, type TranscriptFrame } from '@/core/runs/trace-storage';
const schema = `
CREATE TABLE application_format (id INTEGER PRIMARY KEY CHECK(id=1), format TEXT NOT NULL, instance_id TEXT NOT NULL);
CREATE TABLE records (bucket TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(bucket,id));
CREATE TABLE operation_headers (namespace TEXT NOT NULL, project_id TEXT NOT NULL, id TEXT NOT NULL, sequence INTEGER NOT NULL, revision INTEGER NOT NULL,
  owner_root_run_id TEXT, pending INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(namespace,project_id,id), UNIQUE(namespace,project_id,sequence));
CREATE INDEX operation_owner ON operation_headers(namespace,project_id,owner_root_run_id,sequence DESC);
CREATE INDEX operation_pending ON operation_headers(namespace,pending,project_id,sequence);
CREATE TABLE operation_bodies (namespace TEXT NOT NULL, project_id TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(namespace,project_id,id),
  FOREIGN KEY(namespace,project_id,id) REFERENCES operation_headers(namespace,project_id,id));
CREATE TABLE operation_counters (namespace TEXT NOT NULL, project_id TEXT NOT NULL, sequence INTEGER NOT NULL, PRIMARY KEY(namespace,project_id));
CREATE TABLE run_headers (id TEXT PRIMARY KEY, admission_sequence INTEGER NOT NULL UNIQUE, project_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
  root_run_id TEXT NOT NULL, kind TEXT NOT NULL, mode TEXT NOT NULL, active INTEGER NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL);
CREATE INDEX run_project ON run_headers(project_id,kind,admission_sequence DESC);
CREATE INDEX run_conversation ON run_headers(project_id,conversation_id,kind,admission_sequence DESC);
CREATE INDEX run_history ON run_headers(project_id,conversation_id,kind,mode,active,admission_sequence DESC);
CREATE INDEX run_root ON run_headers(root_run_id,admission_sequence);
CREATE INDEX run_active ON run_headers(active,admission_sequence);
CREATE TABLE run_inputs (id TEXT PRIMARY KEY REFERENCES run_headers(id), payload TEXT NOT NULL);
CREATE TABLE run_results (id TEXT PRIMARY KEY REFERENCES run_headers(id), payload TEXT NOT NULL);
CREATE TABLE run_counters (id INTEGER PRIMARY KEY CHECK(id=1), sequence INTEGER NOT NULL);
CREATE TABLE trace_nodes (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES run_headers(id), run_sequence INTEGER NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, UNIQUE(run_id,run_sequence));
CREATE TABLE trace_text_chunks (node_id TEXT NOT NULL REFERENCES trace_nodes(id), ordinal INTEGER NOT NULL, start_offset INTEGER NOT NULL, characters INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(node_id,ordinal));
CREATE INDEX trace_text_offset ON trace_text_chunks(node_id,start_offset);
CREATE TABLE transcript_frames (run_id TEXT NOT NULL REFERENCES run_headers(id), ordinal INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(run_id,ordinal));
PRAGMA user_version = 5;
`;
const scopeArgs = (scope: JournalScope, id: string) => [scope.namespace, scope.projectId, id];
const decode = <T>(row: {
    payload: string;
} | null): T | undefined => row ? JSON.parse(row.payload) as T : undefined;
export async function createSqliteBusinessStore(db: SQLiteDatabase, instanceId: () => string): Promise<BusinessStore> {
    await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    const table = await db.getFirstAsync("SELECT name FROM sqlite_master WHERE type='table' AND name='application_format'");
    if (!table) {
        const existing = await db.getFirstAsync("SELECT name FROM sqlite_master WHERE type='table' AND name='records'");
        if (existing)
            throw new AppError('DATA_FORMAT', '开发数据格式不匹配，请重建此开发实例。');
        await db.withExclusiveTransactionAsync(async (tx) => {
            await tx.execAsync(schema);
            await tx.runAsync('INSERT INTO application_format VALUES (1,?,?)', CURRENT_DATA_FORMAT, instanceId());
        });
    }
    const format = await db.getFirstAsync<{
        format: string;
        instance_id: string;
    }>('SELECT format,instance_id FROM application_format WHERE id=1');
    if (!format || format.format !== CURRENT_DATA_FORMAT)
        throw new AppError('DATA_FORMAT', '开发数据格式不匹配，请重建此开发实例。');
    let writes: Promise<unknown> = Promise.resolve();
    const atomic = <T>(work: (tx: SQLiteDatabase) => Promise<T>): Promise<T> => {
        const next = writes.catch(() => { }).then(async () => {
            let result!: T;
            try {
                await db.withExclusiveTransactionAsync(async (tx) => { result = await work(tx); });
            }
            catch (error) {
                if (error instanceof AppError)
                    throw error;
                throw new AppError('STORAGE', '本地数据库事务失败。');
            }
            return result;
        });
        writes = next;
        return next;
    };
    const metadataRows = async (tx: SQLiteDatabase, entries: readonly MetadataEntry[]) => {
        for (const entry of entries)
            await tx.runAsync('INSERT INTO records VALUES (?,?,?) ON CONFLICT(bucket,id) DO UPDATE SET payload=excluded.payload', entry.bucket, entry.id, JSON.stringify(entry.value));
    };
    const headerRow = async (tx: SQLiteDatabase, header: OperationHeader) => tx.runAsync('INSERT INTO operation_headers VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(namespace,project_id,id) DO UPDATE SET revision=excluded.revision,pending=excluded.pending,payload=excluded.payload', ...scopeArgs(header.scope, header.id), header.sequence, header.revision, header.ownerRootRunId ?? null, header.phase === 'recorded' ? 0 : 1, JSON.stringify(header));
    return {
        dataInstanceId: format.instance_id,
        get: async <T>(bucket: string, id: string) => decode<T>(await db.getFirstAsync('SELECT payload FROM records WHERE bucket=? AND id=?', bucket, id)),
        async put(bucket, id, value) { await atomic(tx => metadataRows(tx, [{ bucket, id, value }])); },
        async batch(entries) { await atomic(tx => metadataRows(tx, entries)); },
        all: async <T>(bucket: string) => (await db.getAllAsync<{
            payload: string;
        }>('SELECT payload FROM records WHERE bucket=?', bucket)).map(row => JSON.parse(row.payload) as T),
        operation: async (scope, id) => decode<OperationHeader>(await db.getFirstAsync('SELECT payload FROM operation_headers WHERE namespace=? AND project_id=? AND id=?', ...scopeArgs(scope, id))),
        operationBody: async (scope, id) => decode<OperationBody>(await db.getFirstAsync('SELECT payload FROM operation_bodies WHERE namespace=? AND project_id=? AND id=?', ...scopeArgs(scope, id))),
        run: async (id) => decode<RunHeader>(await db.getFirstAsync('SELECT payload FROM run_headers WHERE id=?', id)),
        runInput: async (id) => decode<RunInput>(await db.getFirstAsync('SELECT payload FROM run_inputs WHERE id=?', id)),
        runResult: async (id) => decode<RunResult>(await db.getFirstAsync('SELECT payload FROM run_results WHERE id=?', id)),
        traceNode: async (id) => decode<TraceNode>(await db.getFirstAsync('SELECT payload FROM trace_nodes WHERE id=?', id)),
        traceNodes: async (id, after, limit) => (await db.getAllAsync<{
            payload: string;
        }>('SELECT payload FROM trace_nodes WHERE run_id=? AND run_sequence>? ORDER BY run_sequence LIMIT ?', id, after, limit)).map(row => JSON.parse(row.payload) as TraceNode),
        traceChunks: async (id, after, limit) => (await db.getAllAsync<{
            payload: string;
        }>('SELECT payload FROM trace_text_chunks WHERE node_id=? AND ordinal>? ORDER BY ordinal LIMIT ?', id, after, limit)).map(row => JSON.parse(row.payload) as TraceTextChunk),
        async traceTextRange(id, offset, limit) {
            const first = await db.getFirstAsync<{
                ordinal: number;
            }>('SELECT ordinal FROM trace_text_chunks WHERE node_id=? AND start_offset<=? ORDER BY start_offset DESC LIMIT 1', id, offset);
            return first ? (await db.getAllAsync<{
                payload: string;
            }>('SELECT payload FROM trace_text_chunks WHERE node_id=? AND ordinal>=? ORDER BY ordinal LIMIT ?', id, first.ordinal, limit)).map(row => JSON.parse(row.payload) as TraceTextChunk) : [];
        },
        transcriptFrames: async (id, after, limit) => (await db.getAllAsync<{
            payload: string;
        }>('SELECT payload FROM transcript_frames WHERE run_id=? AND ordinal>? ORDER BY ordinal LIMIT ?', id, after, limit)).map(row => JSON.parse(row.payload) as TranscriptFrame),
        async runs(query) {
            if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100)
                throw new AppError('VALIDATION', '运行查询每页需要 1–100 条。');
            if (!query.projectId && !query.rootRunId && query.active === undefined)
                throw new AppError('VALIDATION', '运行查询需要明确范围。');
            const clauses: string[] = [];
            const args: SQLiteBindValue[] = [];
            const fields = { projectId: 'project_id', conversationId: 'conversation_id', rootRunId: 'root_run_id', kind: 'kind', mode: 'mode' } as const;
            for (const [field, column] of Object.entries(fields)) {
                const value = query[field as keyof typeof fields];
                if (value !== undefined) {
                    clauses.push(column + '=?');
                    args.push(value);
                }
            }
            if (query.active !== undefined) {
                clauses.push('active=?');
                args.push(query.active ? 1 : 0);
            }
            if (query.highWater !== undefined) {
                clauses.push('admission_sequence<=?');
                args.push(query.highWater);
            }
            if (query.beforeSequence !== undefined) {
                clauses.push('admission_sequence<?');
                args.push(query.beforeSequence);
            }
            return (await db.getAllAsync<{
                payload: string;
            }>('SELECT payload FROM run_headers WHERE ' + clauses.join(' AND ') + ' ORDER BY admission_sequence DESC LIMIT ?', ...args, query.limit))
                .map(row => JSON.parse(row.payload) as RunHeader);
        },
        async prepareOperation(draft: OperationDraft, body: OperationBody) {
            return atomic(async (tx) => {
                const previous = decode<OperationHeader>(await tx.getFirstAsync('SELECT payload FROM operation_headers WHERE namespace=? AND project_id=? AND id=?', ...scopeArgs(draft.scope, draft.id)));
                if (previous) {
                    if (!sameOperation(previous, draft))
                        throw new AppError('CONFLICT', '操作 ID 与已保存意图不匹配。');
                    return previous;
                }
                const counter = await tx.getFirstAsync<{
                    sequence: number;
                }>('SELECT sequence FROM operation_counters WHERE namespace=? AND project_id=?', draft.scope.namespace, draft.scope.projectId);
                const header: OperationHeader = { ...draft, sequence: (counter?.sequence ?? 0) + 1, revision: 1 };
                await tx.runAsync('INSERT INTO operation_counters VALUES (?,?,?) ON CONFLICT(namespace,project_id) DO UPDATE SET sequence=excluded.sequence', draft.scope.namespace, draft.scope.projectId, header.sequence);
                await headerRow(tx, header);
                await tx.runAsync('INSERT INTO operation_bodies VALUES (?,?,?,?)', ...scopeArgs(draft.scope, draft.id), JSON.stringify(body));
                return header;
            });
        },
        async operations(query) {
            if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100)
                throw new AppError('VALIDATION', '操作查询每页需要 1–100 条。');
            const clauses: string[] = [];
            const args: SQLiteBindValue[] = [];
            if (query.scope) {
                clauses.push('namespace=?', 'project_id=?');
                args.push(query.scope.namespace, query.scope.projectId);
            }
            else if (query.namespace) {
                clauses.push('namespace=?');
                args.push(query.namespace);
            }
            else
                throw new AppError('VALIDATION', '操作查询需要日志范围。');
            if (query.ownerRootRunId) {
                clauses.push('owner_root_run_id=?');
                args.push(query.ownerRootRunId);
            }
            if (query.pending)
                clauses.push('pending=1');
            if (query.beforeSequence !== undefined) {
                clauses.push('sequence<?');
                args.push(query.beforeSequence);
            }
            const order = query.pending ? 'project_id ASC,sequence ASC' : 'sequence DESC';
            return (await db.getAllAsync<{
                payload: string;
            }>('SELECT payload FROM operation_headers WHERE ' + clauses.join(' AND ') + ' ORDER BY ' + order + ' LIMIT ?', ...args, query.limit)).map(row => JSON.parse(row.payload) as OperationHeader);
        },
        async writeBusiness(batch: BusinessWriteBatch) {
            await atomic(async (tx) => {
                for (const update of batch.runs ?? []) {
                    const previous = decode<RunHeader>(await tx.getFirstAsync('SELECT payload FROM run_headers WHERE id=?', update.header.id));
                    assertRunWrite(previous, update);
                    let sequence = previous?.admissionSequence;
                    if (sequence === undefined) {
                        sequence = (await tx.getFirstAsync<{
                            sequence: number;
                        }>('SELECT sequence FROM run_counters WHERE id=1'))?.sequence ?? 0;
                        sequence++;
                        await tx.runAsync('INSERT INTO run_counters VALUES (1,?) ON CONFLICT(id) DO UPDATE SET sequence=excluded.sequence', sequence);
                    }
                    const header: RunHeader = { ...update.header, revision: update.expectedRevision + 1, admissionSequence: sequence };
                    await tx.runAsync('INSERT INTO run_headers VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET mode=excluded.mode,active=excluded.active,revision=excluded.revision,payload=excluded.payload', header.id, sequence, header.projectId, header.conversationId, header.rootRunId, header.kind, header.mode, terminalRun(header.state) ? 0 : 1, header.revision, JSON.stringify(header));
                    if (update.input)
                        await tx.runAsync('INSERT INTO run_inputs VALUES (?,?)', header.id, JSON.stringify(update.input));
                    if (update.result)
                        await tx.runAsync('INSERT INTO run_results VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload', header.id, JSON.stringify(update.result));
                }
                for (const update of batch.operations ?? []) {
                    const previous = decode<OperationHeader>(await tx.getFirstAsync('SELECT payload FROM operation_headers WHERE namespace=? AND project_id=? AND id=?', ...scopeArgs(update.header.scope, update.header.id)));
                    assertOperationUpdate(previous, update.header, update.expectedRevision);
                    await headerRow(tx, update.header);
                }
                for (const update of batch.trace?.nodes ?? []) {
                    const previous = decode<TraceNode>(await tx.getFirstAsync('SELECT payload FROM trace_nodes WHERE id=?', update.node.id));
                    assertTraceUpdate(previous, update.node, update.expectedRevision);
                    assertTraceAppend(previous, update.node, batch.trace?.chunks ?? []);
                    const owner = decode<RunHeader>(await tx.getFirstAsync('SELECT payload FROM run_headers WHERE id=?', update.node.runId));
                    if (!owner || (terminalRun(owner.state) && !batch.runs?.some(run => run.header.id === owner.id)))
                        throw new AppError('CONFLICT', '终态运行不能追加轨迹。');
                    await tx.runAsync('INSERT INTO trace_nodes VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload', update.node.id, update.node.runId, update.node.runSequence, update.node.revision, JSON.stringify(update.node));
                }
                for (const chunk of batch.trace?.chunks ?? []) {
                    const previous = decode<TraceTextChunk>(await tx.getFirstAsync('SELECT payload FROM trace_text_chunks WHERE node_id=? AND ordinal=?', chunk.nodeId, chunk.ordinal));
                    if (chunk.characters !== chunk.text.length || (previous && JSON.stringify(previous) !== JSON.stringify(chunk)))
                        throw new AppError('CONFLICT', '轨迹文本块与已保存内容冲突。');
                    if (!previous && !batch.trace?.nodes?.some(update => update.node.id === chunk.nodeId))
                        throw new AppError('CONFLICT', '追加正文必须同时更新轨迹节点。');
                    if (!previous)
                        await tx.runAsync('INSERT INTO trace_text_chunks VALUES (?,?,?,?,?)', chunk.nodeId, chunk.ordinal, chunk.offset, chunk.characters, JSON.stringify(chunk));
                }
                for (const frame of batch.trace?.frames ?? []) {
                    const previous = decode<TranscriptFrame>(await tx.getFirstAsync('SELECT payload FROM transcript_frames WHERE run_id=? AND ordinal=?', frame.runId, frame.ordinal));
                    if (frame.schemaVersion !== 1 || (previous && JSON.stringify(previous) !== JSON.stringify(frame)))
                        throw new AppError('CONFLICT', '引擎消息帧与已保存内容冲突。');
                    if (!previous) {
                        const latest = await tx.getFirstAsync<{
                            ordinal: number;
                        }>('SELECT ordinal FROM transcript_frames WHERE run_id=? ORDER BY ordinal DESC LIMIT 1', frame.runId);
                        const owner = decode<RunHeader>(await tx.getFirstAsync('SELECT payload FROM run_headers WHERE id=?', frame.runId));
                        if (!owner || frame.ordinal !== (latest?.ordinal ?? -1) + 1 || (terminalRun(owner.state) && !batch.runs?.some(run => run.header.id === owner.id)))
                            throw new AppError('CONFLICT', '消息帧必须按运行顺序追加。');
                    }
                    if (!previous)
                        await tx.runAsync('INSERT INTO transcript_frames VALUES (?,?,?)', frame.runId, frame.ordinal, JSON.stringify(frame));
                }
                await metadataRows(tx, batch.metadata ?? []);
            });
        },
    };
}
