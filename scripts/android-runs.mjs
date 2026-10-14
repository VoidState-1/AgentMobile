import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { adb, waitFor, metroPort } from './android-ui.mjs';
import { readRuns } from './native-runs.mjs';

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
const stamp = Date.now(); const legacyId = 'r2-legacy-' + stamp; const rootId = 'r2-root-' + stamp; const childId = 'r2-child-' + stamp; const queuedId = 'r2-queued-' + stamp;
await stopped(); await pull();
let projectId; let conversationId; let operationCount;
{
  const db = new DatabaseSync(target);
  try {
    const source = readRuns(db).filter((run) => run.schemaVersion === 2 && run.state === 'completed').sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
    if (!source) throw new Error('先在本模拟器完成 android-smoke.mjs');
    projectId = source.projectId; conversationId = source.conversationId;
    const group = read(db, 'run-groups', source.id);
    if (group?.requests !== 4 || group.tools !== 3 || !read(db, 'run-launches', source.id)?.agent || !read(db, 'run-transcripts', source.id) || read(db, 'tasks', source.id)) throw new Error('实际执行未独占使用 v2 运行仓库、预算和 transcript。');
    const { trace, ...record } = source;
    const base = { ...record, rootRunId: rootId, launchSnapshotRef: rootId, createdAt: new Date().toISOString(), response: '保留的部分结果', events: [], changedPaths: undefined, finalSnapshot: undefined, finalIndexSnapshot: undefined, finalCommit: undefined };
    write(db, 'runs-v2', rootId, { ...base, id: rootId, state: 'waiting_children', prompt: 'Native R2 interrupted root' });
    write(db, 'run-traces', rootId, [{ id: rootId + ':text', round: 1, contentIndex: 0, kind: 'text', text: '保留的部分结果', startedAt: base.createdAt, state: 'running' }]);
    write(db, 'runs-v2', childId, { ...base, id: childId, kind: 'child', parentRunId: rootId, depth: 1, state: 'running', agentDefinitionId: 'reader', launchSnapshotRef: childId, prompt: 'Native R2 interrupted child' });
    write(db, 'run-indexes', 'root/' + rootId, { ids: [rootId, childId] });
    const state = read(db, 'conversations', 'state'); const revision = state.drafts[conversationId].revision + 1;
    state.drafts[conversationId] = { text: 'Native R2 queued draft', revision }; write(db, 'conversations', 'state', state);
    write(db, 'runs-v2', queuedId, { ...base, id: queuedId, rootRunId: queuedId, launchSnapshotRef: queuedId, state: 'queued', prompt: 'Native R2 queued draft', draftRevision: revision, baseCommit: undefined, baseSnapshot: undefined, baseIndexSnapshot: undefined });
    for (const id of ['project/' + projectId, 'conversation/' + projectId + '/' + conversationId]) {
      const index = read(db, 'run-indexes', id); write(db, 'run-indexes', id, { ids: [...index.ids, rootId, queuedId] });
    }
    write(db, 'run-indexes', 'root/' + queuedId, { ids: [queuedId] });
    write(db, 'run-indexes', 'active', { ids: [rootId, childId, queuedId] });
    write(db, 'tasks', legacyId, { id: legacyId, projectId, prompt: 'Native R2 legacy migration', response: '保留旧结果', state: 'completed', mode: 'demo', baseCommit: source.baseCommit, events: [], createdAt: new Date().toISOString() });
    db.exec("CREATE TRIGGER r2_migration_failure BEFORE INSERT ON records WHEN NEW.bucket='run-migrations' BEGIN SELECT RAISE(ABORT,'fixture atomic migration failure'); END;");
    operationCount = db.prepare("SELECT count(*) AS n FROM records WHERE bucket='operations'").get().n;
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally { db.close(); }
}
await install(); await restart(); await waitFor('暂时无法打开本地资料。请保留本地数据后重新打开应用。'); await stopped(); await pull();
{
  const db = new DatabaseSync(target);
  try {
    if (read(db, 'runs-v2', legacyId) || read(db, 'run-launches', legacyId) || read(db, 'run-traces', legacyId) || read(db, 'run-migrations', legacyId)) throw new Error('SQLite 元数据事务未回滚完整迁移批次');
    if (!read(db, 'tasks', legacyId) || read(db, 'run-indexes', 'project/' + projectId).ids.includes(legacyId)) throw new Error('迁移中断污染来源或索引');
    db.exec('DROP TRIGGER r2_migration_failure'); db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally { db.close(); }
}
await install(); await restart(); await waitFor('已中断'); await stopped(); await pull();
{
  const db = new DatabaseSync(target, { readOnly: true });
  try {
    for (const id of [rootId, childId, queuedId]) if (read(db, 'runs-v2', id)?.state !== 'interrupted') throw new Error(id + ' 未收束为 interrupted');
    if (read(db, 'run-traces', rootId)[0].state !== 'interrupted' || read(db, 'run-indexes', 'active').ids.length) throw new Error('运行轨迹或活动索引未恢复');
    if (read(db, 'runs-v2', legacyId)?.agentDefinitionRevision !== 0 || !read(db, 'run-migrations', legacyId) || !read(db, 'tasks', legacyId)) throw new Error('旧数据迁移未保留来源与历史证据');
    if (read(db, 'conversations', 'state').drafts[conversationId].text) throw new Error('入队回执没有修复已消费草稿');
    if (db.prepare("SELECT count(*) AS n FROM records WHERE bucket='operations'").get().n !== operationCount) throw new Error('恢复重放了文件工具');
    process.stdout.write('R2 native verified: actual v2 execution/budget/transcript, atomic SQLite migration rollback/retry, interrupted root/child/queue, draft acknowledgement, no tool replay.\n');
  } finally { db.close(); }
}
await restart();
