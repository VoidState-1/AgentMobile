import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { adb, waitFor, metroPort } from './android-ui.mjs';
import { readRuns, writeRun, readTrace, writeTraceFixture } from './native-runs.mjs';

// Synthetic data and failure injection on the caller's isolated test emulator.
const target = 'work/r2-native-runs.sqlite';
const execute = promisify(execFile);
const binary = path.join(process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
async function pull() {
  for (const suffix of ['', '-wal']) {
    try {
      const { stdout } = await execute(binary, ['-s', process.argv[2], 'exec-out', 'run-as', 'com.agentmobile.app', 'cat', 'files/SQLite/agent-mobile.sqlite' + suffix], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });
      await fs.writeFile(target + suffix, stdout);
    } catch (error) { if (suffix) await fs.rm(target + suffix, { force: true }); else throw error; }
  }
}
async function install() {
  await adb('push', target, '/data/local/tmp/r2-native-runs.sqlite');
  await adb('shell', 'run-as', 'com.agentmobile.app', 'rm', '-f', 'files/SQLite/agent-mobile.sqlite-wal', 'files/SQLite/agent-mobile.sqlite-shm');
  await adb('shell', 'run-as', 'com.agentmobile.app', 'cp', '/data/local/tmp/r2-native-runs.sqlite', 'files/SQLite/agent-mobile.sqlite');
}
const restart = () => adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d',
  'exp+agent-mobile://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A' + metroPort, 'com.agentmobile.app');
const stopped = () => adb('shell', 'am', 'force-stop', 'com.agentmobile.app');
const read = (db, bucket, id) => { const row = db.prepare('SELECT payload FROM records WHERE bucket=? AND id=?').get(bucket, id); return row && JSON.parse(row.payload); };
const write = (db, bucket, id, value) => db.prepare('INSERT OR REPLACE INTO records(bucket,id,payload) VALUES(?,?,?)').run(bucket, id, JSON.stringify(value));
const stamp = Date.now(); const rootId = 'r2-root-' + stamp; const childId = 'r2-child-' + stamp; const queuedId = 'r2-queued-' + stamp;
await stopped(); await pull();
let projectId; let conversationId; let operationCount;
{
  const db = new DatabaseSync(target);
  try {
    const source = readRuns(db).filter((run) => run.schemaVersion === 3 && run.state === 'completed').sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
    if (!source) throw new Error('先在本模拟器完成 android-smoke.mjs');
    projectId = source.projectId; conversationId = source.conversationId;
    const group = read(db, 'run-groups', source.id);
    if (group?.requests !== 4 || group.tools !== 3 || !read(db, 'run-launches', source.id)?.agent || !db.prepare('SELECT ordinal FROM transcript_frames WHERE run_id=? LIMIT 1').get(source.id)) throw new Error('实际执行未使用当前运行仓库、预算和消息帧。');
    const { trace, ...record } = source;
    const launch = read(db, 'run-launches', source.launchSnapshotRef);
    const base = { ...record, rootRunId: rootId, launchSnapshotRef: rootId, createdAt: new Date().toISOString(), response: '保留的部分结果', changedPaths: undefined, finalSnapshot: undefined, finalIndexSnapshot: undefined, finalCommit: undefined };
    writeRun(db, { ...base, id: rootId, state: 'waiting_children', prompt: 'Native R2 interrupted root' }, launch);
    writeTraceFixture(db, rootId, rootId, '保留的部分结果');
    writeRun(db, { ...base, id: childId, kind: 'child', parentRunId: rootId, depth: 1, state: 'running', agentDefinitionId: 'reader', launchSnapshotRef: childId, prompt: 'Native R2 interrupted child' }, { ...launch, agent: { ...launch.agent, id: 'reader', workspace: 'snapshot', mayDelegate: false, allowedEffects: ['read'] } });
    const state = read(db, 'conversations', 'state'); const revision = state.drafts[conversationId].revision + 1;
    state.drafts[conversationId] = { text: 'Native R2 queued draft', revision }; write(db, 'conversations', 'state', state);
    writeRun(db, { ...base, id: queuedId, rootRunId: queuedId, launchSnapshotRef: queuedId, state: 'queued', prompt: 'Native R2 queued draft', draftRevision: revision, baseCommit: undefined, baseSnapshot: undefined, baseIndexSnapshot: undefined }, launch);

    write(db, 'accepted-drafts', conversationId + '/' + revision, { projectId, conversationId, runId: queuedId });
    operationCount = db.prepare("SELECT count(*) AS n FROM operation_headers").get().n;
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally { db.close(); }
}
await install(); await restart(); await waitFor('已中断'); await stopped(); await pull();
{
  const db = new DatabaseSync(target, { readOnly: true });
  try {
    for (const id of [rootId, childId, queuedId]) if (readRuns(db).find(run => run.id === id)?.state !== 'interrupted') throw new Error(id + ' 未收束为 interrupted');
    if (readTrace(db, rootId)[0].state !== 'interrupted' || db.prepare('SELECT COUNT(*) AS n FROM run_headers WHERE active=1').get().n) throw new Error('运行轨迹或活动索引未恢复');
    if (read(db, 'conversations', 'state').drafts[conversationId].text) throw new Error('入队回执没有修复已消费草稿');
    if (db.prepare("SELECT count(*) AS n FROM operation_headers").get().n !== operationCount) throw new Error('恢复重放了文件工具');
    process.stdout.write('R2 native verified: actual v3 execution/budget/transcript, interrupted root/child/queue, draft acknowledgement, no tool replay.\n');
  } finally { db.close(); }
}
await restart();
