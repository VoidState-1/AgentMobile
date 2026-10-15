import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { build } from 'vite';
import { chromium } from '@playwright/test';

// Uses production workspace/Git/IDB/run modules in disposable browser contexts.
// No model requests, app credentials or existing browser profile are involved.
await fs.mkdir('work/validation/measurement', { recursive: true });
const bundle = await build({
  configFile: false,
  logLevel: 'error',
  resolve: { alias: { '@': path.resolve('src') } },
  build: {
    write: false,
    minify: false,
    lib: { entry: '\u0000measurement-entry', name: 'Measurement', formats: ['iife'] },
  },
  plugins: [
    {
      name: 'measurement-source',
      resolveId: id => (id.endsWith('measurement-entry') ? '\u0000measurement-entry' : undefined),
      load: id =>
        id.endsWith('measurement-entry')
          ? `
      import { Buffer } from 'buffer';
      globalThis.Buffer = Buffer;
      export { createStorage } from '@/adapters/storage/platform.web';
      export { createWorkspace } from '@/bootstrap/workspace';
      export { RunRepository } from '@/application/runs/repository';
      export { ConversationService } from '@/application/conversations/service';
      export { contentCodec } from '@/adapters/storage/codec';
      export { measurementImage } from ${JSON.stringify(path.resolve('scripts/measurement-image.mjs'))};
    `
          : undefined,
    },
  ],
});
const source = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(
  item => item.type === 'chunk',
).code;
const browser = await chromium.launch({ channel: 'chrome' });
const report = {
  environment: {
    browser: browser.version(),
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model,
    memoryBytes: os.totalmem(),
    build: 'Expo production Web + source measurement bundle',
    memory:
      'CDP JSHeapUsedSize sampled every 50ms; logical IDB/FS boundary bytes, not physical disk bytes',
    cold: 'new page/JS/bootstrap per repeat; OS/IDB disk caches are not evicted',
    native: 'Not a mobile native performance claim',
  },
  samples: [],
};
const selectedSample = process.argv
  .find(argument => argument.startsWith('--sample='))
  ?.slice('--sample='.length);
if (selectedSample) {
  const previous = JSON.parse(
    await fs.readFile('work/validation/architecture-measurement.json', 'utf8'),
  );
  report.samples = previous.samples.filter(sample => sample.name !== selectedSample);
}
const samples = [
  { name: 'ordinary', files: 20, runs: 50, operations: 200 },
  { name: 'history', files: 200, runs: 1000, operations: 3000 },
  { name: 'large', files: 20, runs: 50, operations: 32, large: true },
];

function instrumentation() {
  const bytes = value =>
    value === undefined || value === null
      ? 0
      : ArrayBuffer.isView(value)
        ? value.byteLength
        : typeof value === 'string'
          ? new TextEncoder().encode(value).length
          : Array.isArray(value)
            ? value.reduce((total, item) => total + bytes(item), 0)
            : typeof value === 'object'
              ? Object.values(value).reduce((total, item) => total + bytes(item), 0)
              : 8;
  window.measurementIO = { readBytes: 0, writeBytes: 0, reads: {}, writes: {} };
  for (const method of ['get', 'getAll', 'openCursor', 'openKeyCursor', 'getAllKeys']) {
    const original = IDBObjectStore.prototype[method];
    IDBObjectStore.prototype[method] = function (...args) {
      const request = original.apply(this, args);
      const name = this.name;
      request.addEventListener('success', () => {
        const result = request.result;
        window.measurementIO.reads[name] = (window.measurementIO.reads[name] ?? 0) + 1;
        window.measurementIO.readBytes += bytes(
          result instanceof IDBCursorWithValue
            ? result.value
            : result instanceof IDBCursor
              ? result.key
              : result,
        );
      });
      return request;
    };
  }
  for (const method of ['get', 'getAll', 'openCursor', 'openKeyCursor']) {
    const original = IDBIndex.prototype[method];
    IDBIndex.prototype[method] = function (...args) {
      const request = original.apply(this, args);
      const name = this.objectStore.name + '.' + this.name;
      request.addEventListener('success', () => {
        const result = request.result;
        window.measurementIO.reads[name] = (window.measurementIO.reads[name] ?? 0) + 1;
        window.measurementIO.readBytes += bytes(
          result instanceof IDBCursorWithValue
            ? result.value
            : result instanceof IDBCursor
              ? result.key
              : result,
        );
      });
      return request;
    };
  }
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    window.measurementIO.writeBytes += bytes(args[0]);
    window.measurementIO.writes[this.name] = (window.measurementIO.writes[this.name] ?? 0) + 1;
    return put.apply(this, args);
  };
}

async function fixturePage(context) {
  const page = await context.newPage();
  await page.route('**/measurement', route =>
    route.fulfill({
      body: '<!doctype html><title>Isolated measurement</title>',
      contentType: 'text/html',
    }),
  );
  await page.goto('http://127.0.0.1:4180/measurement');
  await page.addScriptTag({ content: source });
  return page;
}
async function sampled(page, action) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  let peak = 0;
  let sampling = true;
  const collect = async () => {
    const metrics = await cdp.send('Performance.getMetrics');
    peak = Math.max(
      peak,
      metrics.metrics.find(value => value.name === 'JSHeapUsedSize')?.value ?? 0,
    );
  };
  const loop = (async () => {
    while (sampling) {
      await collect();
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  })();
  const start = performance.now();
  try {
    const result = await action();
    await collect();
    return { ms: performance.now() - start, jsHeapPeakBytes: peak, result };
  } finally {
    sampling = false;
    await loop;
    await cdp.detach();
  }
}
try {
  for (const spec of samples.filter(sample => !selectedSample || sample.name === selectedSample)) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(instrumentation);
    const setup = await fixturePage(context);
    const identity = await setup.evaluate(async spec => {
      const { createStorage, createWorkspace, RunRepository, ConversationService, contentCodec } =
        window.Measurement;
      const storage = await createStorage();
      const workspace = createWorkspace(storage.fs, storage.metadata, () => crypto.randomUUID());
      const project = await workspace.create(
        'measurement-' + spec.name,
        'measurement-' + spec.name,
      );
      const base = workspace.git.dir(project.id);
      const png = window.Measurement.measurementImage;
      const paths = ['project.json', 'documents/notes.md'];
      for (let index = 2; index < spec.files - (spec.large ? 2 : 0); index++) {
        const name = 'documents/item-' + index + '.md';
        paths.push(name);
        await storage.fs.write(
          base + '/' + name,
          contentCodec.encodeText('# ' + index + '\n' + ('资料 ' + index + '\n').repeat(80)),
        );
      }
      if (spec.large) {
        await storage.fs.write(
          base + '/documents/notes.md',
          contentCodec.encodeText('x'.repeat(1024 * 1024)),
        );
        for (const size of [4, 20]) {
          const name = 'assets/image-' + size + '.png';
          paths.push(name);
          await storage.fs.write(base + '/' + name, png(size * 1024 * 1024));
        }
      }
      const head = await workspace.git.commit(project.id, paths, '测量基线');
      const conversations = new ConversationService(storage.metadata, () => crypto.randomUUID());
      await conversations.initialize([project]);
      const conversation = await conversations.ensureProject(project.id);
      const repository = new RunRepository(storage.metadata);
      let latest;
      for (let index = 0; index < spec.runs; index++) {
        const id = project.id + '-run-' + index;
        latest = id;
        const trace =
          spec.large && index === spec.runs - 1
            ? Array.from({ length: 260 }, (_, step) => ({
                id: id + '-node-' + step,
                runId: id,
                rootRunId: id,
                runSequence: step + 1,
                groupSequence: step + 1,
                round: step + 1,
                kind: 'text',
                state: 'completed',
                contentIndex: 0,
                startedAt: new Date().toISOString(),
                endedAt: new Date().toISOString(),
                text: '轨迹正文 ' + step + ' ' + 'z'.repeat(3000),
              }))
            : [];
        await repository.save(
          {
            schemaVersion: 3,
            id,
            projectId: project.id,
            conversationId: conversation.id,
            rootRunId: id,
            kind: 'root',
            depth: 0,
            agentDefinitionId: 'root',
            agentDefinitionRevision: 1,
            launchSnapshotRef: id + '-launch',
            state: 'completed',
            mode: 'demo',
            prompt: '测量运行 ' + index,
            response:
              spec.large && index === spec.runs - 1
                ? '最终回答\n' + '结果\n'.repeat(50000)
                : '已完成测量 ' + index,
            createdAt: new Date().toISOString(),
          },
          undefined,
          trace,
        );
      }
      for (let index = 0; index < spec.operations; index++) {
        let bytes = contentCodec.encodeText(
          '不同历史正文 ' + index + '\n' + ('historical ' + index).repeat(80),
        );
        if (spec.large)
          bytes =
            index % 4 === 0
              ? png(20 * 1024 * 1024)
              : index % 4 === 1
                ? png(4 * 1024 * 1024)
                : contentCodec.encodeText(String(index) + 'v'.repeat(1024 * 1024 - 2));
        const header = await workspace.journal.prepare(
          {
            id: 'operation-' + index,
            projectId: project.id,
            kind: 'files',
            expectedHead: head,
            phase: 'prepared',
            message: '测量操作 ' + index,
            checkpoint: head,
            createdAt: new Date().toISOString(),
          },
          {
            changes: [
              {
                path:
                  index % 4 < 2 && spec.large
                    ? 'assets/image-' + (index % 4 === 0 ? 20 : 4) + '.png'
                    : 'documents/notes.md',
                before: null,
                after: contentCodec.encodeBase64(bytes),
              },
            ],
          },
        );
        await workspace.journal.save({ ...header, phase: 'recorded' });
      }
      return { projectId: project.id, conversationId: conversation.id, latest };
    }, spec);
    await setup.close();
    console.log('seeded', spec.name);
    const rounds = [];
    for (let repeat = 0; repeat < 5; repeat++) {
      const page = await context.newPage();
      const cold = await sampled(page, async () => {
        await page.goto('http://127.0.0.1:4180/');
        await page.getByRole('button', { name: '发送任务', exact: true }).waitFor();
        return page.evaluate(() => window.measurementIO);
      });
      if (cold.result.reads.operation_bodies || cold.result.reads.transcript_frames)
        throw new Error('First screen hydrated journal/transcript bodies');
      const firstScreen = await sampled(page, async () => {
        await page.getByText('测量运行 ' + (spec.runs - 1), { exact: true }).waitFor();
        return page.evaluate(() => window.measurementIO);
      });
      await page.close();
      const query = await fixturePage(context);
      await query.evaluate(async () => {
        const storage = await window.Measurement.createStorage();
        window.measurementRuntime = {
          storage,
          workspace: window.Measurement.createWorkspace(storage.fs, storage.metadata, () =>
            crypto.randomUUID(),
          ),
          runs: new window.Measurement.RunRepository(storage.metadata),
        };
      });
      const reset = () =>
        query.evaluate(() => {
          window.measurementIO = { readBytes: 0, writeBytes: 0, reads: {}, writes: {} };
        });
      await reset();
      const refresh = await sampled(query, () =>
        query.evaluate(async identity => {
          const { workspace, runs } = window.measurementRuntime;
          const [view, history] = await Promise.all([
            workspace.snapshot(identity.projectId),
            runs.list(identity.projectId, identity.conversationId),
          ]);
          return { io: window.measurementIO, files: view.files.length, rows: history.runs.length };
        }, identity),
      );
      await reset();
      const warmRefresh = await sampled(query, () =>
        query.evaluate(async identity => {
          await window.measurementRuntime.workspace.snapshot(identity.projectId);
          return window.measurementIO;
        }, identity),
      );
      await reset();
      const save = await sampled(query, () =>
        query.evaluate(
          async ({ identity, repeat }) => {
            const { workspace } = window.measurementRuntime;
            const previous = await workspace.readText(identity.projectId, 'documents/notes.md');
            await workspace.write(
              identity.projectId,
              'documents/notes.md',
              window.Measurement.contentCodec.encodeText(
                previous.text.replace(/^./, String(repeat)),
              ),
              previous.revision,
            );
            return window.measurementIO;
          },
          { identity, repeat },
        ),
      );
      rounds.push({
        cold,
        firstScreen: { ...firstScreen, ms: cold.ms + firstScreen.ms },
        refresh,
        warmRefresh,
        save,
      });
      await query.close();
      console.log(spec.name, repeat + 1, 'completed');
    }
    const statistics = {};
    for (const phase of ['cold', 'firstScreen', 'refresh', 'warmRefresh', 'save']) {
      const rows = rounds.map(round => round[phase]);
      const values = rows.map(row => row.ms).sort((a, b) => a - b);
      statistics[phase] = {
        medianMs: values[2],
        maxMs: values[4],
        jsHeapPeakBytes: Math.max(...rows.map(row => row.jsHeapPeakBytes)),
      };
    }
    report.samples.push({ ...spec, statistics, rounds });
    await context.close();
    await fs.writeFile(
      'work/validation/architecture-measurement.json',
      JSON.stringify(report, null, 2),
    );
  }
} finally {
  await browser.close();
}
console.log(
  JSON.stringify(
    report.samples.map(({ name, statistics }) => ({ name, statistics })),
    null,
    2,
  ),
);
