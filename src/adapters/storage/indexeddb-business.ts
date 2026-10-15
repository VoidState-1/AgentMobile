import { AppError } from '@/core/errors';
import { CURRENT_DATA_FORMAT, type BusinessStore, type BusinessWriteBatch } from '@/core/storage/business-store';
import { assertOperationUpdate, sameOperation, type JournalScope, type OperationBody, type OperationDraft, type OperationHeader, type OperationQuery } from '@/core/workspace/journal';
import type { MetadataEntry } from '@/core/storage/contracts';
import { assertRunWrite, terminalRun, type RunHeader } from '@/core/runs/records';
import { assertTraceAppend, assertTraceUpdate } from '@/core/runs/trace-storage';
const key = (scope: JournalScope, id: string): IDBValidKey[] => [scope.namespace, scope.projectId, id];
const scopeKey = (scope: JournalScope): IDBValidKey[] => [scope.namespace, scope.projectId];
const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});
export async function openWebDatabase(name = 'agent-mobile-prototype'): Promise<IDBDatabase> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
        let formatMismatch = false;
        let rejected = false;
        const request = indexedDB.open(name, 5);
        request.onupgradeneeded = event => {
            if (event.oldVersion !== 0) {
                formatMismatch = true;
                request.transaction!.abort();
                return;
            }
            const database = request.result;
            database.createObjectStore('records');
            database.createObjectStore('files', { keyPath: 'path' })
                .createIndex('stat', ['path', 'kind', 'size', 'mtime', 'contentVersion']);
            database.createObjectStore('format').put({ format: CURRENT_DATA_FORMAT, instanceId: crypto.randomUUID() }, 'current');
            const operations = database.createObjectStore('operation_headers');
            operations.createIndex('scope', ['scope.namespace', 'scope.projectId', 'sequence'], { unique: true });
            operations.createIndex('owner', ['scope.namespace', 'scope.projectId', 'ownerRootRunId', 'sequence']);
            operations.createIndex('pending', ['scope.namespace', 'pending', 'scope.projectId', 'sequence']);
            database.createObjectStore('operation_bodies');
            database.createObjectStore('operation_counters');
            const runs = database.createObjectStore('run_headers');
            runs.createIndex('project', ['projectId', 'admissionSequence']);
            runs.createIndex('conversation', ['projectId', 'conversationId', 'admissionSequence']);
            runs.createIndex('root', ['rootRunId', 'admissionSequence']);
            runs.createIndex('active', ['active', 'admissionSequence']);
            runs.createIndex('history', ['projectId', 'conversationId', 'kind', 'mode', 'active', 'admissionSequence']);
            database.createObjectStore('run_inputs');
            database.createObjectStore('run_results');
            database.createObjectStore('run_counters');
            const nodes = database.createObjectStore('trace_nodes');
            nodes.createIndex('run', ['runId', 'runSequence'], { unique: true });
            database.createObjectStore('trace_text_chunks').createIndex('offset', ['nodeId', 'offset'], { unique: true });
            database.createObjectStore('transcript_frames');
        };
        request.onsuccess = () => { if (rejected)
            request.result.close();
        else
            resolve(request.result); };
        request.onerror = () => reject(new AppError(formatMismatch ? 'DATA_FORMAT' : 'STORAGE', formatMismatch ?
            '开发数据格式不匹配，请重建此开发实例。' : '浏览器存储无法打开，请检查可用空间和浏览器设置。'));
        request.onblocked = () => { rejected = true; reject(new AppError('CONFLICT', '存储连接被旧页面占用，请关闭其他页面并刷新。')); };
    });
    const transaction = db.transaction.bind(db);
    let invalidated = false;
    db.transaction = (...args: Parameters<IDBDatabase['transaction']>) => {
        if (invalidated)
            throw new AppError('CONFLICT', '开发存储连接已关闭，请刷新页面后继续。');
        return transaction(...args);
    };
    db.onversionchange = () => { invalidated = true; db.close(); };
    const format = await requestResult(db.transaction('format').objectStore('format').get('current'));
    if (format?.format !== CURRENT_DATA_FORMAT) {
        db.close();
        throw new AppError('DATA_FORMAT', '开发数据格式不匹配，请重建此开发实例。');
    }
    return db;
}
export async function createWebBusinessStore(db: IDBDatabase): Promise<BusinessStore> {
    const format = await requestResult(db.transaction('format').objectStore('format').get('current'));
    async function transaction<T>(stores: string[], mode: IDBTransactionMode, action: (tx: IDBTransaction) => Promise<T>): Promise<T> {
        const tx = db.transaction(stores, mode);
        const complete = new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(new AppError('STORAGE', '浏览器存储事务未完成。'));
            tx.onerror = () => reject(new AppError('STORAGE', '浏览器存储事务失败。'));
        });
        try {
            const result = await action(tx);
            await complete;
            return result;
        }
        catch (error) {
            try {
                tx.abort();
            }
            catch { /* Already aborted/completed. */ }
            await complete.catch(() => { });
            throw error;
        }
    }
    const savedHeader = (header: OperationHeader) => ({ ...header, pending: header.phase === 'recorded' ? 0 : 1 });
    const publicHeader = (header: OperationHeader & {
        pending?: number;
    }): OperationHeader => {
        const { pending: _pending, ...value } = header;
        return value;
    };
    const publicRun = (header: RunHeader & {
        active?: number;
    }): RunHeader => {
        const { active: _active, ...value } = header;
        return value;
    };
    const metadataRows = async (tx: IDBTransaction, entries: readonly MetadataEntry[]) => {
        const records = tx.objectStore('records');
        for (const entry of entries)
            await requestResult(records.put(entry.value, entry.bucket + '/' + entry.id));
    };
    return {
        dataInstanceId: format.instanceId,
        get: async <T>(bucket: string, id: string) => requestResult(db.transaction('records').objectStore('records').get(bucket + '/' + id)) as Promise<T | undefined>,
        async put(bucket, id, value) { await transaction(['records'], 'readwrite', tx => metadataRows(tx, [{ bucket, id, value }])); },
        async batch(entries) { await transaction(['records'], 'readwrite', tx => metadataRows(tx, entries)); },
        all: async <T>(bucket: string) => requestResult(db.transaction('records').objectStore('records').getAll(IDBKeyRange.bound(bucket + '/', bucket + '0', false, true))) as Promise<T[]>,
        operation: async (scope, id) => {
            const value = await requestResult(db.transaction('operation_headers').objectStore('operation_headers').get(key(scope, id)));
            return value && publicHeader(value);
        },
        operationBody: async (scope, id) => requestResult(db.transaction('operation_bodies').objectStore('operation_bodies').get(key(scope, id))),
        run: async (id) => {
            const value = await requestResult(db.transaction('run_headers').objectStore('run_headers').get(id));
            return value && publicRun(value);
        },
        runInput: async (id) => requestResult(db.transaction('run_inputs').objectStore('run_inputs').get(id)),
        runResult: async (id) => requestResult(db.transaction('run_results').objectStore('run_results').get(id)),
        traceNode: async (id) => requestResult(db.transaction('trace_nodes').objectStore('trace_nodes').get(id)),
        traceNodes: async (id, after, limit) => requestResult(db.transaction('trace_nodes').objectStore('trace_nodes').index('run').getAll(IDBKeyRange.bound([id, after], [id, Number.MAX_SAFE_INTEGER], true, false), limit)),
        traceChunks: async (id, after, limit) => requestResult(db.transaction('trace_text_chunks').objectStore('trace_text_chunks').getAll(IDBKeyRange.bound([id, after], [id, Number.MAX_SAFE_INTEGER], true, false), limit)),
        async traceTextRange(id, offset, limit) {
            const store = db.transaction('trace_text_chunks').objectStore('trace_text_chunks');
            const cursor = await requestResult(store.index('offset').openCursor(IDBKeyRange.bound([id, 0], [id, offset]), 'prev'));
            return cursor ? requestResult(store.getAll(IDBKeyRange.bound([id, cursor.value.ordinal], [id, Number.MAX_SAFE_INTEGER]), limit)) : [];
        },
        transcriptFrames: async (id, after, limit) => requestResult(db.transaction('transcript_frames').objectStore('transcript_frames').getAll(IDBKeyRange.bound([id, after], [id, Number.MAX_SAFE_INTEGER], true, false), limit)),
        async runs(query) {
            if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100)
                throw new AppError('VALIDATION', '运行查询每页需要 1–100 条。');
            const store = db.transaction('run_headers').objectStore('run_headers');
            let index: IDBIndex;
            let prefix: IDBValidKey[];
            if (query.projectId && query.conversationId && query.mode && query.active === false) {
                index = store.index('history');
                prefix = [query.projectId, query.conversationId, query.kind ?? 'root', query.mode, 0];
            }
            else if (query.rootRunId) {
                index = store.index('root');
                prefix = [query.rootRunId];
            }
            else if (query.projectId && query.conversationId) {
                index = store.index('conversation');
                prefix = [query.projectId, query.conversationId];
            }
            else if (query.projectId) {
                index = store.index('project');
                prefix = [query.projectId];
            }
            else if (query.active !== undefined) {
                index = store.index('active');
                prefix = [query.active ? 1 : 0];
            }
            else
                throw new AppError('VALIDATION', '运行查询需要明确范围。');
            const upper = Math.min(query.highWater ?? Number.MAX_SAFE_INTEGER, query.beforeSequence !== undefined ? query.beforeSequence - 1 : Number.MAX_SAFE_INTEGER);
            if (upper < 1)
                return [];
            const range = IDBKeyRange.bound([...prefix, 1], [...prefix, upper]);
            return new Promise<RunHeader[]>((resolve, reject) => {
                const rows: RunHeader[] = [];
                const request = index.openCursor(range, 'prev');
                request.onerror = () => reject(new AppError('STORAGE', '运行摘要读取失败。'));
                request.onsuccess = () => {
                    const cursor = request.result;
                    if (!cursor || rows.length === query.limit) {
                        resolve(rows);
                        return;
                    }
                    const header = cursor.value as RunHeader;
                    if ((!query.kind || header.kind === query.kind) && (!query.mode || header.mode === query.mode) &&
                        (query.active === undefined || query.active === !terminalRun(header.state)))
                        rows.push(publicRun(header));
                    cursor.continue();
                };
            });
        },
        async prepareOperation(draft: OperationDraft, body: OperationBody) {
            return transaction(['operation_headers', 'operation_bodies', 'operation_counters'], 'readwrite', async (tx) => {
                const headers = tx.objectStore('operation_headers');
                const id = key(draft.scope, draft.id);
                const previous = await requestResult(headers.get(id));
                if (previous) {
                    if (!sameOperation(previous, draft))
                        throw new AppError('CONFLICT', '操作 ID 与已保存意图不匹配。');
                    return publicHeader(previous);
                }
                const counters = tx.objectStore('operation_counters');
                const sequence = (await requestResult(counters.get(scopeKey(draft.scope))) ?? 0) + 1;
                const header: OperationHeader = { ...draft, sequence, revision: 1 };
                await requestResult(counters.put(sequence, scopeKey(draft.scope)));
                await requestResult(tx.objectStore('operation_bodies').add(body, id));
                await requestResult(headers.add(savedHeader(header), id));
                return header;
            });
        },
        async operations(query: OperationQuery) {
            if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100)
                throw new AppError('VALIDATION', '操作查询每页需要 1–100 条。');
            const store = db.transaction('operation_headers').objectStore('operation_headers');
            let index: IDBIndex;
            let range: IDBKeyRange;
            let direction: IDBCursorDirection = 'prev';
            if (query.pending) {
                if (!query.namespace)
                    throw new AppError('VALIDATION', '恢复查询需要日志命名空间。');
                const prefix: IDBValidKey[] = [query.namespace, 1];
                if (query.scope)
                    prefix.push(query.scope.projectId);
                index = store.index('pending');
                range = IDBKeyRange.bound(prefix, [...prefix, []]);
                direction = 'next';
            }
            else {
                if (!query.scope)
                    throw new AppError('VALIDATION', '操作查询需要项目范围。');
                const prefix = scopeKey(query.scope);
                if (query.ownerRootRunId)
                    prefix.push(query.ownerRootRunId);
                index = store.index(query.ownerRootRunId ? 'owner' : 'scope');
                range = IDBKeyRange.bound([...prefix, 0], [...prefix, query.beforeSequence ?? Number.MAX_SAFE_INTEGER], false, query.beforeSequence !== undefined);
            }
            return new Promise<OperationHeader[]>((resolve, reject) => {
                const rows: OperationHeader[] = [];
                const request = index.openCursor(range, direction);
                request.onerror = () => reject(new AppError('STORAGE', '操作摘要读取失败。'));
                request.onsuccess = () => {
                    const cursor = request.result;
                    if (!cursor || rows.length === query.limit) {
                        resolve(rows);
                        return;
                    }
                    rows.push(publicHeader(cursor.value));
                    cursor.continue();
                };
            });
        },
        async writeBusiness(batch: BusinessWriteBatch) {
            await transaction(['records', 'operation_headers', 'run_headers', 'run_inputs', 'run_results', 'run_counters', 'trace_nodes', 'trace_text_chunks', 'transcript_frames'], 'readwrite', async (tx) => {
                const runs = tx.objectStore('run_headers');
                for (const update of batch.runs ?? []) {
                    const previous = await requestResult(runs.get(update.header.id));
                    assertRunWrite(previous, update);
                    let sequence = previous?.admissionSequence;
                    if (sequence === undefined) {
                        const counter = tx.objectStore('run_counters');
                        sequence = (await requestResult(counter.get('admission')) ?? 0) + 1;
                        await requestResult(counter.put(sequence, 'admission'));
                    }
                    const header: RunHeader = { ...update.header, revision: update.expectedRevision + 1, admissionSequence: sequence };
                    await requestResult(runs.put({ ...header, active: terminalRun(header.state) ? 0 : 1 }, header.id));
                    if (update.input)
                        await requestResult(tx.objectStore('run_inputs').add(update.input, header.id));
                    if (update.result)
                        await requestResult(tx.objectStore('run_results').put(update.result, header.id));
                }
                const headers = tx.objectStore('operation_headers');
                for (const update of batch.operations ?? []) {
                    const id = key(update.header.scope, update.header.id);
                    const previous = await requestResult(headers.get(id));
                    assertOperationUpdate(previous, update.header, update.expectedRevision);
                    await requestResult(headers.put(savedHeader(update.header), id));
                }
                const nodes = tx.objectStore('trace_nodes');
                for (const update of batch.trace?.nodes ?? []) {
                    const previous = await requestResult(nodes.get(update.node.id));
                    assertTraceUpdate(previous, update.node, update.expectedRevision);
                    assertTraceAppend(previous, update.node, batch.trace?.chunks ?? []);
                    const owner = await requestResult(runs.get(update.node.runId));
                    if (!owner || (terminalRun(owner.state) && !batch.runs?.some(run => run.header.id === owner.id)))
                        throw new AppError('CONFLICT', '终态运行不能追加轨迹。');
                    await requestResult(nodes.put(update.node, update.node.id));
                }
                const chunks = tx.objectStore('trace_text_chunks');
                for (const chunk of batch.trace?.chunks ?? []) {
                    const id = [chunk.nodeId, chunk.ordinal];
                    const previous = await requestResult(chunks.get(id));
                    if (!await requestResult(nodes.get(chunk.nodeId)) || chunk.characters !== chunk.text.length || (previous && JSON.stringify(previous) !== JSON.stringify(chunk)))
                        throw new AppError('CONFLICT', '轨迹文本块与已保存内容冲突。');
                    if (!previous && !batch.trace?.nodes?.some(update => update.node.id === chunk.nodeId))
                        throw new AppError('CONFLICT', '追加正文必须同时更新轨迹节点。');
                    if (!previous)
                        await requestResult(chunks.add(chunk, id));
                }
                const frames = tx.objectStore('transcript_frames');
                for (const frame of batch.trace?.frames ?? []) {
                    const id = [frame.runId, frame.ordinal];
                    const previous = await requestResult(frames.get(id));
                    if (!await requestResult(runs.get(frame.runId)) || frame.schemaVersion !== 1 || (previous && JSON.stringify(previous) !== JSON.stringify(frame)))
                        throw new AppError('CONFLICT', '引擎消息帧与已保存内容冲突。');
                    if (!previous) {
                        const last = await requestResult(frames.openCursor(IDBKeyRange.bound([frame.runId, 0], [frame.runId, Number.MAX_SAFE_INTEGER]), 'prev'));
                        const owner = await requestResult(runs.get(frame.runId));
                        if (frame.ordinal !== (last?.value.ordinal ?? -1) + 1 || (terminalRun(owner.state) && !batch.runs?.some(run => run.header.id === owner.id)))
                            throw new AppError('CONFLICT', '消息帧必须按运行顺序追加。');
                    }
                    if (!previous)
                        await requestResult(frames.add(frame, id));
                }
                await metadataRows(tx, batch.metadata ?? []);
            });
        },
    };
}
