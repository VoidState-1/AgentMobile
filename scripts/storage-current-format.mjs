import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from '@playwright/test';
import { sourceModule } from './source-module.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
const { createSqliteBusinessStore } = await import(
  await sourceModule('src/adapters/storage/sqlite-business.ts')
);
await fs.mkdir('work/validation', { recursive: true });
const target = 'work/validation/current-format-' + randomUUID() + '.sqlite';
const db = new DatabaseSync(target);
let failBody = false;
let failRunBody = false;
let failFormat = true;
const bridge = {
  async execAsync(sql) {
    db.exec(sql);
  },
  async getFirstAsync(sql, ...args) {
    return db.prepare(sql).get(...args) ?? null;
  },
  async getAllAsync(sql, ...args) {
    return db.prepare(sql).all(...args);
  },
  async runAsync(sql, ...args) {
    if (
      (failBody && sql.startsWith('INSERT INTO operation_bodies')) ||
      (failRunBody && sql.startsWith('INSERT INTO run_results')) ||
      (failFormat && sql.startsWith('INSERT INTO application_format'))
    )
      throw new Error('fixture power loss');
    return db.prepare(sql).run(...args);
  },
  async withExclusiveTransactionAsync(action) {
    db.exec('BEGIN IMMEDIATE');
    try {
      await action(bridge);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  },
};
await createSqliteBusinessStore(bridge, randomUUID).then(
  () => {
    throw new Error('initialization failure expected');
  },
  () => {},
);
assert(
  db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n === 0,
  'initialization DDL rollback lost',
);
assert(
  db.prepare('PRAGMA user_version').get().user_version === 0,
  'initialization version rollback lost',
);
failFormat = false;
const store = await createSqliteBusinessStore(bridge, randomUUID);
const draft = id => ({
  schemaVersion: 2,
  id,
  scope: { namespace: 'projects', projectId: 'project' },
  kind: 'files',
  phase: 'prepared',
  expectedHead: 'head',
  changedPaths: ['a.md'],
  bodyFingerprint: 'body-' + id,
  message: id,
  createdAt: new Date().toISOString(),
});
const body = { changes: [{ path: 'a.md', before: null, after: 'eA==' }] };
try {
  failBody = true;
  await store.prepareOperation(draft('failed'), body).then(
    () => {
      throw new Error('failure expected');
    },
    () => {},
  );
  assert(
    db.prepare('SELECT COUNT(*) AS n FROM operation_headers').get().n === 0,
    'prepare rollback lost',
  );
  assert(
    db.prepare('SELECT COUNT(*) AS n FROM operation_counters').get().n === 0,
    'counter rollback lost',
  );
  failBody = false;
  const prepared = await Promise.all(
    Array.from({ length: 105 }, (_, id) => store.prepareOperation(draft(String(id)), body)),
  );
  assert(prepared[104].sequence === 105, 'atomic sequence lost');
  const retry = await store.prepareOperation(draft('0'), body);
  assert(retry.sequence === 1, 'duplicate allocated sequence');
  const original = await store.operation(draft('0').scope, '0');
  await store
    .writeBusiness({
      operations: [
        { header: { ...original, phase: 'applied', revision: 2 }, expectedRevision: 1 },
        { header: { ...original, phase: 'recorded', revision: 99 }, expectedRevision: 98 },
      ],
      metadata: [{ bucket: 'fixture', id: 'atomic', value: { written: true } }],
    })
    .then(
      () => {
        throw new Error('conflict expected');
      },
      () => {},
    );
  assert(
    (await store.operation(original.scope, original.id)).phase === 'prepared',
    'receipt rollback lost',
  );
  assert(!(await store.get('fixture', 'atomic')), 'cross-table rollback lost');
  const page = await store.operations({ scope: original.scope, limit: 30 });
  assert(
    page.length === 30 && page[0].sequence === 105 && !('changes' in page[0]),
    'summary paging lost',
  );
  const runHeader = id => ({
    schemaVersion: 3,
    id,
    projectId: 'project',
    conversationId: 'conversation',
    rootRunId: id,
    kind: 'root',
    depth: 0,
    agentDefinitionId: 'main',
    agentDefinitionRevision: 1,
    launchSnapshotRef: id,
    state: 'queued',
    mode: 'demo',
    createdAt: '2026-10-14',
    promptPreview: id,
    responsePreview: '',
    promptCharacters: id.length,
    responseCharacters: 0,
    childCount: 0,
    changedFileCount: 0,
  });
  const runWrite = id => ({
    header: runHeader(id),
    expectedRevision: 0,
    input: { prompt: id },
    result: { response: '' },
  });
  failRunBody = true;
  await store
    .writeBusiness({
      runs: [runWrite('failed-run')],
      metadata: [{ bucket: 'fixture', id: 'run', value: true }],
    })
    .then(
      () => {
        throw new Error('rollback expected');
      },
      () => {},
    );
  assert(
    !(await store.run('failed-run')) &&
      !(await store.runInput('failed-run')) &&
      !(await store.get('fixture', 'run')),
    'run admission rollback lost',
  );
  assert(
    db.prepare('SELECT COUNT(*) AS n FROM run_counters').get().n === 0,
    'run counter rollback lost',
  );
  failRunBody = false;
  for (let index = 0; index < 105; index++)
    await store.writeBusiness({ runs: [runWrite('run-' + index)] });
  const runPage = await store.runs({
    projectId: 'project',
    conversationId: 'conversation',
    kind: 'root',
    limit: 30,
  });
  assert(
    runPage.length === 30 && runPage[0].admissionSequence === 105 && !('prompt' in runPage[0]),
    'run paging read input',
  );
  const nextPage = await store.runs({
    projectId: 'project',
    conversationId: 'conversation',
    highWater: 105,
    beforeSequence: runPage.at(-1).admissionSequence,
    limit: 30,
  });
  assert(nextPage[0].admissionSequence === 75, 'run cursor range lost');
  const trace = {
    id: 'trace-fixture',
    runId: 'run-0',
    rootRunId: 'run-0',
    runSequence: 1,
    groupSequence: 1,
    revision: 1,
    kind: 'text',
    round: 1,
    contentIndex: 0,
    state: 'running',
    startedAt: '2026-10-15',
    textPreview: 'first',
    textCharacters: 5,
    textChunks: 1,
  };
  const chunk = { nodeId: trace.id, ordinal: 0, offset: 0, characters: 5, text: 'first' };
  await store.writeBusiness({
    trace: {
      nodes: [{ node: trace, expectedRevision: 0 }],
      chunks: [chunk],
      frames: [
        {
          runId: 'run-0',
          ordinal: 0,
          schemaVersion: 1,
          payload: { role: 'user', content: 'first' },
        },
      ],
    },
  });
  await store.writeBusiness({ trace: { chunks: [chunk] } });
  assert(
    (await store.traceTextRange(trace.id, 1, 2))[0].text === 'first',
    'indexed text range lost',
  );
  await store.writeBusiness({ trace: { chunks: [{ ...chunk, text: 'other' }] } }).then(
    () => {
      throw new Error('chunk conflict expected');
    },
    () => {},
  );
  await store
    .writeBusiness({
      trace: { frames: [{ runId: 'run-0', ordinal: 2, schemaVersion: 1, payload: {} }] },
    })
    .then(
      () => {
        throw new Error('frame gap accepted');
      },
      () => {},
    );
  const owner = await store.run('run-0');
  const { revision: _ownerRevision, admissionSequence: _ownerSequence, ...ownerFields } = owner;
  await store.writeBusiness({
    runs: [{ header: { ...ownerFields, state: 'completed' }, expectedRevision: owner.revision }],
    trace: {
      nodes: [{ node: { ...trace, state: 'completed', revision: 2 }, expectedRevision: 1 }],
      frames: [
        {
          runId: 'run-0',
          ordinal: 1,
          schemaVersion: 1,
          payload: { role: 'assistant', content: 'done' },
        },
      ],
    },
  });
  assert(
    (await store.traceNode(trace.id)).state === 'completed' &&
      (await store.run('run-0')).state === 'completed',
    'terminal trace batch lost',
  );
  const reopened = await createSqliteBusinessStore(bridge, randomUUID);
  assert(reopened.dataInstanceId === store.dataInstanceId, 'instance identity changed');
  db.prepare("UPDATE application_format SET format='other'").run();
  await createSqliteBusinessStore(bridge, randomUUID).then(
    () => {
      throw new Error('format mismatch accepted');
    },
    () => {},
  );
  console.log(
    'SQLite source adapter: current schema/reopen, journal and run body+counter rollback, concurrent sequence, idempotency, header-only paging, CAS rollback, format mismatch passed.',
  );
} finally {
  db.close();
}

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await (await browser.newContext()).newPage();
  await page.goto(process.env.PREVIEW_URL ?? 'http://127.0.0.1:4180');
  const result = await page.evaluate(
    async url => {
      const { openWebDatabase, createWebBusinessStore } = await import(url);
      const name = 'journal-fixture-' + crypto.randomUUID();
      const db = await openWebDatabase(name);
      const store = await createWebBusinessStore(db);
      const scope = { namespace: 'skills', projectId: 'library' };
      const body = { changes: [{ path: 'skills/a/SKILL.md', before: null, after: 'eA==' }] };
      const draft = id => ({
        schemaVersion: 2,
        id,
        scope,
        kind: 'files_commit',
        phase: 'prepared',
        expectedHead: 'head',
        changedPaths: ['skills/a/SKILL.md'],
        bodyFingerprint: id,
        message: id,
        createdAt: new Date().toISOString(),
      });
      const records = await Promise.all(
        Array.from({ length: 105 }, (_, id) => store.prepareOperation(draft(String(id)), body)),
      );
      if (new Set(records.map(header => header.sequence)).size !== 105)
        throw new Error('sequence collision');
      if ((await store.prepareOperation(draft('0'), body)).sequence !== 1)
        throw new Error('retry allocated sequence');
      const first = records[0];
      await store
        .writeBusiness({
          operations: [
            { header: { ...first, phase: 'applied', revision: 2 }, expectedRevision: 1 },
            { header: { ...first, phase: 'recorded', revision: 99 }, expectedRevision: 98 },
          ],
          metadata: [{ bucket: 'fixture', id: 'atomic', value: {} }],
        })
        .then(
          () => {
            throw new Error('conflict expected');
          },
          () => {},
        );
      if (
        (await store.operation(scope, first.id)).phase !== 'prepared' ||
        (await store.get('fixture', 'atomic'))
      )
        throw new Error('rollback lost');
      const touchedStores = [];
      const transaction = db.transaction.bind(db);
      db.transaction = (names, ...args) => {
        touchedStores.push(names);
        return transaction(names, ...args);
      };
      const page = await store.operations({ scope, limit: 30 });
      const second = await store.operations({
        scope,
        beforeSequence: page.at(-1).sequence,
        limit: 30,
      });
      if (
        page[0].sequence !== 105 ||
        second[0].sequence !== 75 ||
        page.some(header => 'changes' in header)
      )
        throw new Error('paging lost');
      const pending = await store.operations({
        namespace: 'skills',
        scope,
        pending: true,
        limit: 100,
      });
      if (pending[0].sequence !== 1 || pending.at(-1).sequence !== 100)
        throw new Error('recovery order lost');
      if (touchedStores.some(names => names !== 'operation_headers'))
        throw new Error('summary query read body store');
      const header = id => ({
        schemaVersion: 3,
        id,
        projectId: 'project',
        conversationId: 'conversation',
        rootRunId: id,
        kind: 'root',
        depth: 0,
        agentDefinitionId: 'main',
        agentDefinitionRevision: 1,
        launchSnapshotRef: id,
        state: 'queued',
        mode: 'demo',
        createdAt: '2026-10-14',
        promptPreview: id,
        responsePreview: '',
        promptCharacters: id.length,
        responseCharacters: 0,
        childCount: 0,
        changedFileCount: 0,
      });
      for (let index = 0; index < 105; index++)
        await store.writeBusiness({
          runs: [
            {
              header: header('run-' + index),
              expectedRevision: 0,
              input: { prompt: 'run-' + index },
              result: { response: 'large-body'.repeat(1000) },
            },
          ],
        });
      touchedStores.length = 0;
      const runPage = await store.runs({
        projectId: 'project',
        conversationId: 'conversation',
        kind: 'root',
        limit: 30,
      });
      if (
        runPage[0].admissionSequence !== 105 ||
        runPage.length !== 30 ||
        touchedStores.some(names => names !== 'run_headers')
      )
        throw new Error('run query read body store');
      const previousRun = runPage[0];
      const { revision: _revision, admissionSequence: _sequence, ...fields } = previousRun;
      await store
        .writeBusiness({
          runs: [
            { header: { ...fields, state: 'completed' }, expectedRevision: previousRun.revision },
            { header: header('run-0'), expectedRevision: 999 },
          ],
          metadata: [{ bucket: 'fixture', id: 'run-rollback', value: true }],
        })
        .then(
          () => {
            throw new Error('conflict expected');
          },
          () => {},
        );
      if (
        (await store.run(previousRun.id)).state !== 'queued' ||
        (await store.get('fixture', 'run-rollback'))
      )
        throw new Error('run CAS rollback lost');
      const trace = {
        id: 'trace-fixture',
        runId: previousRun.id,
        rootRunId: previousRun.id,
        runSequence: 1,
        groupSequence: 1,
        revision: 1,
        kind: 'text',
        round: 1,
        contentIndex: 0,
        state: 'running',
        startedAt: '2026-10-15',
        textPreview: 'first',
        textCharacters: 5,
        textChunks: 1,
      };
      const chunk = { nodeId: trace.id, ordinal: 0, offset: 0, characters: 5, text: 'first' };
      await store.writeBusiness({
        trace: {
          nodes: [{ node: trace, expectedRevision: 0 }],
          chunks: [chunk],
          frames: [{ runId: previousRun.id, ordinal: 0, schemaVersion: 1, payload: {} }],
        },
      });
      await store.writeBusiness({ trace: { chunks: [chunk] } });
      if ((await store.traceTextRange(trace.id, 1, 2))[0].text !== 'first')
        throw new Error('text range failed');
      await store.writeBusiness({ trace: { chunks: [{ ...chunk, text: 'other' }] } }).then(
        () => {
          throw new Error('conflict expected');
        },
        () => {},
      );
      await store
        .writeBusiness({
          trace: { frames: [{ runId: previousRun.id, ordinal: 2, schemaVersion: 1, payload: {} }] },
        })
        .then(
          () => {
            throw new Error('frame gap accepted');
          },
          () => {},
        );
      await store.writeBusiness({
        runs: [
          { header: { ...fields, state: 'completed' }, expectedRevision: previousRun.revision },
        ],
        trace: {
          nodes: [{ node: { ...trace, state: 'completed', revision: 2 }, expectedRevision: 1 }],
          frames: [{ runId: previousRun.id, ordinal: 1, schemaVersion: 1, payload: {} }],
        },
      });
      if (
        (await store.traceNode(trace.id)).state !== 'completed' ||
        (await store.transcriptFrames(previousRun.id, -1, 10)).length !== 2
      )
        throw new Error('terminal trace/frame batch lost');
      const instance = store.dataInstanceId;
      db.close();
      const reopened = await openWebDatabase(name);
      const again = await createWebBusinessStore(reopened);
      if (again.dataInstanceId !== instance) throw new Error('instance changed');
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      let closedHint = false;
      try {
        await again.get('fixture', 'closed');
      } catch (error) {
        closedHint = error.code === 'CONFLICT' && error.message.includes('刷新页面');
      }
      if (!closedHint)
        throw new Error('versionchange did not close old connection with refresh hint');
      const oldName = 'old-fixture-' + crypto.randomUUID();
      await new Promise((resolve, reject) => {
        const request = indexedDB.open(oldName, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('records');
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
      await openWebDatabase(oldName).then(
        () => {
          throw new Error('old format accepted');
        },
        () => {},
      );
      return {
        pages: [page.length, second.length],
        runPage: runPage.length,
        pending: pending.length,
        instanceStable: true,
        oldFormatBlocked: true,
        runRollback: true,
        traceFrames: true,
        closedHint,
      };
    },
    await sourceModule('src/adapters/storage/indexeddb-business.ts'),
  );
  console.log('IndexedDB source adapter:', JSON.stringify(result));
  await fs.writeFile('work/validation/current-format.json', JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
