import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { HostFileSystem } from '../src/core/storage/contracts';
import type { BusinessStore } from '../src/core/storage/business-store';
import {
  assertOperationUpdate,
  sameOperation,
  type JournalScope,
  type OperationBody,
  type OperationHeader,
} from '../src/core/workspace/journal';
import { AppError } from '../src/core/errors';
import {
  assertRunWrite,
  terminalRun,
  type RunHeader,
  type RunInput,
  type RunResult,
} from '../src/core/runs/records';
import {
  assertTraceAppend,
  assertTraceUpdate,
  type TraceNode,
  type TraceTextChunk,
  type TranscriptFrame,
} from '../src/core/runs/trace-storage';

export async function testStorage() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-mobile-'));
  const records = new Map<string, unknown>();
  const headers = new Map<string, OperationHeader>();
  const bodies = new Map<string, OperationBody>();
  const counters = new Map<string, number>();
  const runHeaders = new Map<string, RunHeader>();
  const runInputs = new Map<string, RunInput>();
  const runResults = new Map<string, RunResult>();
  const traceNodes = new Map<string, TraceNode>();
  const chunks = new Map<string, TraceTextChunk>();
  const frames = new Map<string, TranscriptFrame>();
  let runSequence = 0;
  const scopeKey = (scope: JournalScope) => JSON.stringify([scope.namespace, scope.projectId]);
  const operationKey = (scope: JournalScope, id: string) =>
    JSON.stringify([scope.namespace, scope.projectId, id]);
  const resolve = (internal: string) => path.join(root, internal.replace(/^\/+/, ''));
  const metadata: BusinessStore = {
    dataInstanceId: randomUUID(),
    run: async id => structuredClone(runHeaders.get(id)),
    runInput: async id => structuredClone(runInputs.get(id)),
    runResult: async id => structuredClone(runResults.get(id)),
    traceNode: async id => structuredClone(traceNodes.get(id)),
    traceNodes: async (id, after, limit) =>
      [...traceNodes.values()]
        .filter(node => node.runId === id && node.runSequence > after)
        .sort((a, b) => a.runSequence - b.runSequence)
        .slice(0, limit)
        .map(node => structuredClone(node)),
    traceChunks: async (id, after, limit) =>
      [...chunks.values()]
        .filter(chunk => chunk.nodeId === id && chunk.ordinal > after)
        .sort((a, b) => a.ordinal - b.ordinal)
        .slice(0, limit)
        .map(chunk => structuredClone(chunk)),
    traceTextRange: async (id, offset, limit) =>
      [...chunks.values()]
        .filter(chunk => chunk.nodeId === id && chunk.offset + chunk.characters > offset)
        .sort((a, b) => a.ordinal - b.ordinal)
        .slice(0, limit)
        .map(chunk => structuredClone(chunk)),
    transcriptFrames: async (id, after, limit) =>
      [...frames.values()]
        .filter(frame => frame.runId === id && frame.ordinal > after)
        .sort((a, b) => a.ordinal - b.ordinal)
        .slice(0, limit)
        .map(frame => structuredClone(frame)),
    runs: async query =>
      [...runHeaders.values()]
        .filter(
          header =>
            (!query.projectId || header.projectId === query.projectId) &&
            (!query.conversationId || header.conversationId === query.conversationId) &&
            (!query.rootRunId || header.rootRunId === query.rootRunId) &&
            (!query.kind || header.kind === query.kind) &&
            (query.active === undefined || query.active === !terminalRun(header.state)) &&
            (query.highWater === undefined || header.admissionSequence <= query.highWater) &&
            (query.beforeSequence === undefined || header.admissionSequence < query.beforeSequence),
        )
        .sort((a, b) => b.admissionSequence - a.admissionSequence)
        .slice(0, query.limit)
        .map(header => structuredClone(header)),
    prepareOperation: async (draft, body) => {
      const key = operationKey(draft.scope, draft.id);
      const previous = headers.get(key);
      if (previous) {
        if (!sameOperation(previous, draft))
          throw new AppError('CONFLICT', '操作 ID 与已保存意图不匹配。');
        return structuredClone(previous);
      }
      const sequence = (counters.get(scopeKey(draft.scope)) ?? 0) + 1;
      const header = structuredClone({ ...draft, sequence, revision: 1 });
      const copyBody = structuredClone(body);
      headers.set(key, header);
      bodies.set(key, copyBody);
      counters.set(scopeKey(draft.scope), sequence);
      return structuredClone(header);
    },
    operation: async (scope, id) => structuredClone(headers.get(operationKey(scope, id))),
    operationBody: async (scope, id) => structuredClone(bodies.get(operationKey(scope, id))),
    operations: async query =>
      [...headers.values()]
        .filter(
          header =>
            (!query.scope || scopeKey(header.scope) === scopeKey(query.scope)) &&
            (!query.namespace || header.scope.namespace === query.namespace) &&
            (!query.ownerRootRunId || header.ownerRootRunId === query.ownerRootRunId) &&
            (!query.pending || header.phase !== 'recorded') &&
            (query.beforeSequence === undefined || header.sequence < query.beforeSequence),
        )
        .sort((a, b) => (query.pending ? a.sequence - b.sequence : b.sequence - a.sequence))
        .slice(0, query.limit)
        .map(header => structuredClone(header)),
    writeBusiness: async batch => {
      let nextSequence = runSequence;
      const runs = (batch.runs ?? []).map(update => {
        const previous = runHeaders.get(update.header.id);
        assertRunWrite(previous, update);
        const header: RunHeader = structuredClone({
          ...update.header,
          revision: update.expectedRevision + 1,
          admissionSequence: previous?.admissionSequence ?? ++nextSequence,
        });
        return {
          header,
          input: update.input && structuredClone(update.input),
          result: update.result && structuredClone(update.result),
        };
      });
      const updates = (batch.operations ?? []).map(update => {
        const key = operationKey(update.header.scope, update.header.id);
        const previous = headers.get(key);
        assertOperationUpdate(previous, update.header, update.expectedRevision);
        return [key, structuredClone(update.header)] as const;
      });
      const entries = (batch.metadata ?? []).map(
        entry => [entry.bucket + '/' + entry.id, structuredClone(entry.value)] as const,
      );
      const nodeUpdates = (batch.trace?.nodes ?? []).map(update => {
        assertTraceUpdate(traceNodes.get(update.node.id), update.node, update.expectedRevision);
        assertTraceAppend(traceNodes.get(update.node.id), update.node, batch.trace?.chunks ?? []);
        return structuredClone(update.node);
      });
      const newChunks = (batch.trace?.chunks ?? []).map(chunk => {
        const key = JSON.stringify([chunk.nodeId, chunk.ordinal]);
        const previous = chunks.get(key);
        if (
          chunk.characters !== chunk.text.length ||
          (previous && JSON.stringify(previous) !== JSON.stringify(chunk))
        )
          throw new AppError('CONFLICT', '轨迹文本块冲突。');
        return [key, structuredClone(chunk)] as const;
      });
      const newFrames = (batch.trace?.frames ?? []).map(frame => {
        const key = JSON.stringify([frame.runId, frame.ordinal]);
        const previous = frames.get(key);
        if (previous && JSON.stringify(previous) !== JSON.stringify(frame))
          throw new AppError('CONFLICT', '消息帧冲突。');
        return [key, structuredClone(frame)] as const;
      });
      for (const [key, value] of updates) headers.set(key, value);
      for (const [key, value] of entries) records.set(key, value);
      for (const node of nodeUpdates) traceNodes.set(node.id, node);
      for (const [key, chunk] of newChunks) chunks.set(key, chunk);
      for (const [key, frame] of newFrames) frames.set(key, frame);
      for (const { header, input, result } of runs) {
        runHeaders.set(header.id, header);
        if (input) runInputs.set(header.id, input);
        if (result) runResults.set(header.id, result);
      }
      runSequence = nextSequence;
    },
    batch: async entries => {
      const copies = entries.map(
        entry => [entry.bucket + '/' + entry.id, structuredClone(entry.value)] as const,
      );
      for (const [key, value] of copies) records.set(key, value);
    },
    get: async <T>(bucket: string, id: string) =>
      structuredClone(records.get(bucket + '/' + id)) as T | undefined,
    put: async (bucket, id, value) => {
      records.set(bucket + '/' + id, structuredClone(value));
    },
    all: async <T>(bucket: string) =>
      [...records.entries()]
        .filter(([key]) => key.startsWith(bucket + '/'))
        .map(([, value]) => structuredClone(value) as T),
  };
  const files: HostFileSystem = {
    read: async file => new Uint8Array(await fs.readFile(resolve(file))),
    write: async (file, bytes) => {
      await fs.mkdir(path.dirname(resolve(file)), { recursive: true });
      await fs.writeFile(resolve(file), bytes);
    },
    mkdir: async directory => {
      await fs.mkdir(resolve(directory), { recursive: true });
    },
    remove: async file => {
      await fs.rm(resolve(file), { recursive: true });
    },
    moveFile: async (from, to) => {
      await fs.mkdir(path.dirname(resolve(to)), { recursive: true });
      try {
        await fs.lstat(resolve(to));
        throw new Error('移动目标已存在');
      } catch (error) {
        if ((error as { code?: string }).code !== 'ENOENT') throw error;
      }
      await fs.rename(resolve(from), resolve(to));
    },
    list: directory => fs.readdir(resolve(directory)),
    stat: async file => {
      const value = await fs.lstat(resolve(file));
      if (value.isSymbolicLink()) throw new Error('符号链接不可访问');
      return {
        kind: value.isDirectory() ? 'directory' : 'file',
        size: value.size,
        mtime: value.mtimeMs,
      };
    },
  };
  return {
    root,
    records,
    headers,
    bodies,
    metadata,
    files,
    resolve,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

export async function readOperations(
  store: BusinessStore,
  projectId: string,
  namespace: JournalScope['namespace'] = 'projects',
) {
  const headers = await store.operations({ scope: { namespace, projectId }, limit: 100 });
  return Promise.all(
    headers.map(async header => {
      const body = await store.operationBody(header.scope, header.id);
      if (!body) throw new Error('fixture body missing');
      return { ...header, ...body };
    }),
  );
}
