import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'vite';
import { pathToFileURL } from 'node:url';
import { adb, tap, waitFor, metroPort } from './android-ui.mjs';
import { measurementImage } from './measurement-image.mjs';

// Destructive only to emulator-5572's disposable app DB/workspace. SecureStore
// and the original AVD are outside this sample. Never run on another device.
if (process.argv[2] !== 'emulator-5572')
  throw new Error('仅允许已指定的只读隔离模拟器 emulator-5572。');
const appRoot = (await adb('shell', 'run-as', 'com.agentmobile.app', 'pwd')).trim();
if (appRoot !== '/data/user/0/com.agentmobile.app') throw new Error('隔离应用目录不匹配。');
await fs.mkdir('work/validation/native-measurement', { recursive: true });
await build({
  configFile: false,
  logLevel: 'error',
  resolve: { alias: { '@': path.resolve('src') } },
  build: {
    ssr: '\u0000native-measurement-entry',
    outDir: 'work/validation/native-measurement/modules',
    emptyOutDir: false,
    rolldownOptions: { output: { entryFileNames: 'entry.mjs' } },
  },
  plugins: [
    {
      name: 'measurement-native-source',
      resolveId: id =>
        id.endsWith('native-measurement-entry') ? '\u0000native-measurement-entry' : undefined,
      load: id =>
        id.endsWith('native-measurement-entry')
          ? `
      export { createWorkspace } from '@/bootstrap/workspace';
      export { createSqliteBusinessStore } from '@/adapters/storage/sqlite-business';
      export { RunRepository } from '@/application/runs/repository';
      export { ConversationService } from '@/application/conversations/service';
      export { contentCodec } from '@/adapters/storage/codec';
    `
          : undefined,
    },
  ],
});
const modules = await import(
  pathToFileURL(path.resolve('work/validation/native-measurement/modules/entry.mjs')).href
);
const samples = [
  { name: 'ordinary', files: 20, runs: 50, operations: 200 },
  { name: 'history', files: 200, runs: 1000, operations: 3000 },
  { name: 'large', files: 20, runs: 50, operations: 32, large: true },
];
const report = {
  environment: {
    device: 'Medium_Phone_API_36.1, x86_64, read-only isolated emulator-5572',
    build: 'Expo development build/Hermes, Metro ' + metroPort,
    host: os.cpus()[0]?.model,
    timing:
      'wall time includes adb/uiautomator observation (about 1s granularity); filesystem/OS caches not evicted',
    memory:
      'dumpsys meminfo sampled approximately every 250ms; PSS/native heap are sampled peaks, not exact allocations; not arm64/physical-device evidence',
  },
  samples: [],
};
const selectedSample = process.argv
  .find(argument => argument.startsWith('--sample='))
  ?.slice('--sample='.length);
if (selectedSample) {
  const previous = JSON.parse(
    await fs.readFile('work/validation/android-measurement.json', 'utf8'),
  );
  report.samples = previous.samples.filter(sample => sample.name !== selectedSample);
}

function png(size) {
  return Buffer.from(measurementImage(size));
}
async function seed(spec) {
  const target = path.resolve('work/validation/native-measurement', spec.name + '-' + randomUUID());
  const fileRoot = path.join(target, 'filesystem');
  await fs.mkdir(fileRoot, { recursive: true });
  const database = new DatabaseSync(path.join(target, 'agent-mobile.sqlite'));
  const bridge = {
    execAsync: async sql => database.exec(sql),
    getFirstAsync: async (sql, ...args) => database.prepare(sql).get(...args) ?? null,
    getAllAsync: async (sql, ...args) => database.prepare(sql).all(...args),
    runAsync: async (sql, ...args) => database.prepare(sql).run(...args),
    withExclusiveTransactionAsync: async action => {
      database.exec('BEGIN IMMEDIATE');
      try {
        await action(bridge);
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const resolve = value => path.join(fileRoot, value.replace(/^\/+/, ''));
  const host = {
    read: async value => new Uint8Array(await fs.readFile(resolve(value))),
    write: async (value, bytes) => {
      await fs.mkdir(path.dirname(resolve(value)), { recursive: true });
      await fs.writeFile(resolve(value), bytes);
    },
    mkdir: async value => {
      await fs.mkdir(resolve(value), { recursive: true });
    },
    remove: async value => fs.rm(resolve(value)),
    moveFile: async (from, to) => {
      try {
        await fs.stat(resolve(to));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await fs.mkdir(path.dirname(resolve(to)), { recursive: true });
        await fs.rename(resolve(from), resolve(to));
        return;
      }
      throw new Error('移动目标已存在');
    },
    list: async value => fs.readdir(resolve(value)),
    stat: async value => {
      const stat = await fs.stat(resolve(value));
      return {
        kind: stat.isDirectory() ? 'directory' : 'file',
        size: stat.size,
        mtime: stat.mtimeMs,
      };
    },
  };
  try {
    const metadata = await modules.createSqliteBusinessStore(bridge, randomUUID);
    const workspace = modules.createWorkspace(host, metadata, randomUUID);
    const project = await workspace.create(
      'Native-Bench-' + spec.name,
      'native-bench-' + spec.name,
    );
    const base = workspace.git.dir(project.id);
    const paths = ['project.json', 'documents/notes.md'];
    for (let index = 2; index < spec.files - (spec.large ? 2 : 0); index++) {
      const name = 'documents/item-' + index + '.md';
      paths.push(name);
      await host.write(
        base + '/' + name,
        Buffer.from('# item ' + index + '\n' + 'sample content\n'.repeat(80)),
      );
    }
    if (spec.large) {
      await host.write(base + '/documents/notes.md', Buffer.alloc(1024 * 1024, 120));
      for (const size of [4, 20]) {
        const name = 'assets/image-' + size + '.png';
        paths.push(name);
        await host.write(base + '/' + name, png(size * 1024 * 1024));
      }
    }
    const head = await workspace.git.commit(project.id, paths, '测量基线');
    const conversations = new modules.ConversationService(metadata, randomUUID);
    await conversations.initialize([project]);
    const conversation = await conversations.ensureProject(project.id);
    const repository = new modules.RunRepository(metadata);
    for (let index = 0; index < spec.runs; index++) {
      const id = project.id + '-run-' + index;
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
              text: 'trajectory ' + step + ' ' + 'z'.repeat(3000),
            }))
          : [];
      await repository.save(
        {
          schemaVersion: 4,
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

          prompt: 'Native measurement ' + index,
          response:
            spec.large && index === spec.runs - 1
              ? 'Final answer ' + 'result '.repeat(20000)
              : 'Measurement complete ' + index,
          createdAt: new Date().toISOString(),
        },
        undefined,
        trace,
      );
    }
    for (let index = 0; index < spec.operations; index++) {
      const bytes = spec.large
        ? index % 4 < 2
          ? png((index % 4 === 0 ? 20 : 4) * 1024 * 1024)
          : Buffer.from(String(index) + 'v'.repeat(1024 * 1024 - 2))
        : Buffer.from('historical ' + index + ' ' + 'entry '.repeat(100));
      const operation = await workspace.journal.prepare(
        {
          id: 'operation-' + index,
          projectId: project.id,
          kind: 'files',
          expectedHead: head,
          checkpoint: head,
          phase: 'prepared',
          message: 'measurement ' + index,
          createdAt: new Date().toISOString(),
        },
        {
          changes: [{ path: 'documents/notes.md', before: null, after: bytes.toString('base64') }],
        },
      );
      await workspace.journal.save({ ...operation, phase: 'recorded' });
    }
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return target;
  } finally {
    database.close();
  }
}
async function measure(action) {
  let collecting = true;
  let pssPeakKB = 0;
  let nativeHeapPeakKB = 0;
  let count = 0;
  const collection = (async () => {
    while (collecting) {
      const data = await adb('shell', 'dumpsys', 'meminfo', 'com.agentmobile.app').catch(() => '');
      count++;
      pssPeakKB = Math.max(pssPeakKB, Number(data.match(/TOTAL PSS:\s*(\d+)/)?.[1] ?? 0));
      nativeHeapPeakKB = Math.max(
        nativeHeapPeakKB,
        Number(data.match(/Native Heap\s+(\d+)/)?.[1] ?? 0),
      );
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  })();
  const start = performance.now();
  let elapsed;
  try {
    await action();
    elapsed = performance.now() - start;
  } finally {
    collecting = false;
    await collection;
  }
  return { ms: elapsed, pssPeakKB, nativeHeapPeakKB, memorySamples: count };
}
const prepared = [];
const reusable = process.argv.includes('--prepared')
  ? JSON.parse(await fs.readFile('work/validation/native-measurement/prepared.json', 'utf8'))
  : [];
for (const spec of samples.filter(sample => !selectedSample || sample.name === selectedSample)) {
  const target = reusable.find(sample => sample.name === spec.name)?.target ?? (await seed(spec));
  prepared.push({ name: spec.name, target });
  if (process.argv.includes('--prepare')) {
    console.log('Prepared isolated native sample:', spec.name);
    continue;
  }
  const remote = '/data/local/tmp/agent-mobile-measurement-' + spec.name + '-' + randomUUID();
  await adb('shell', 'am', 'force-stop', 'com.agentmobile.app');
  await adb('push', target, remote);
  // Literal app-owned paths checked above, inside the disposable read-only AVD.
  await adb('shell', 'run-as', 'com.agentmobile.app', 'rm', '-rf', 'files/agent-mobile');
  await adb(
    'shell',
    'run-as',
    'com.agentmobile.app',
    'rm',
    '-f',
    'files/SQLite/agent-mobile.sqlite-wal',
    'files/SQLite/agent-mobile.sqlite-shm',
  );
  await adb(
    'shell',
    'run-as',
    'com.agentmobile.app',
    'cp',
    remote + '/agent-mobile.sqlite',
    'files/SQLite/agent-mobile.sqlite',
  );
  await adb(
    'shell',
    'run-as',
    'com.agentmobile.app',
    'cp',
    '-R',
    remote + '/filesystem',
    'files/agent-mobile',
  );
  const rounds = [];
  for (let repeat = 0; repeat < 5; repeat++) {
    await adb('shell', 'am', 'force-stop', 'com.agentmobile.app');
    const cold = await measure(async () => {
      await adb(
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.VIEW',
        '-d',
        'exp+agent-mobile://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A' + metroPort,
        'com.agentmobile.app',
      );
      await waitFor('发送任务', 60000);
      await waitFor('Native-Bench-' + spec.name);
    });
    const refresh = await measure(async () => {
      await tap('文件');
      await waitFor(spec.files - 1 + ' 个文件 · 保存在此设备', 120000);
    });
    // Large samples have image rows above the text list. Selecting a document
    // is outside the refresh timing, and must not depend on viewport position.
    await tap('搜索文件');
    await adb('shell', 'input', 'text', 'item-10');
    await tap('打开 documents/item-10.md');
    await tap('编辑');
    await tap('正文');
    await adb('shell', 'input', 'keyevent', '123');
    await adb('shell', 'input', 'text', 'edit-' + repeat);
    const save = await measure(async () => {
      await tap('保存');
      await waitFor('所有修改已保存', 300000);
    });
    rounds.push({ cold, refresh, save });
    console.log(spec.name, repeat + 1, 'measured');
    await tap('关闭文件');
  }
  const statistics = Object.fromEntries(
    ['cold', 'refresh', 'save'].map(phase => {
      const rows = rounds.map(round => round[phase]);
      const times = rows.map(row => row.ms).sort((a, b) => a - b);
      return [
        phase,
        {
          medianMs: times[2],
          maxMs: times[4],
          pssPeakKB: Math.max(...rows.map(row => row.pssPeakKB)),
          nativeHeapPeakKB: Math.max(...rows.map(row => row.nativeHeapPeakKB)),
        },
      ];
    }),
  );
  report.samples.push({ ...spec, rounds, statistics });
  await fs.writeFile('work/validation/android-measurement.json', JSON.stringify(report, null, 2));
}
if (process.argv.includes('--prepare'))
  await fs.writeFile(
    'work/validation/native-measurement/prepared.json',
    JSON.stringify(prepared, null, 2),
  );
console.log(
  JSON.stringify(
    report.samples.map(({ name, statistics }) => ({ name, statistics })),
    null,
    2,
  ),
);
