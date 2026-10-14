import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { adb, dump, tap, waitFor, sleep, metroPort } from './android-ui.mjs';
import { readRuns } from './native-runs.mjs';

// Run after android-delegation configured the isolated local fixture model.
const stop = () => adb('shell', 'am', 'force-stop', 'com.agentmobile.app');
async function open() {
  await adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'exp+agent-mobile://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A' + metroPort, 'com.agentmobile.app');
  await waitFor('设置');
}
async function create(name) {
  if (!(await dump()).includes('新建项目')) await tap('切换项目'); await tap('新建项目'); await tap('项目名称');
  await adb('shell', 'input', 'text', name); await tap('创建工作区'); await waitFor('任务目标');
}
async function send(goal) { await tap('任务目标'); await adb('shell', 'input', 'text', goal.replaceAll(' ', '%s')); await tap('发送任务'); }
async function held(count) {
  for (let index = 0; index < 40; index++) { const stats = await (await fetch('http://127.0.0.1:4181/stats')).json(); if (stats.maximum > 2) throw new Error('模型请求并发超限');
    if (stats.waiting === count) return; await sleep(500); } throw new Error('两个项目根任务未并行到达模型等待阶段');
}
await adb('reverse', 'tcp:4181', 'tcp:4181'); await open();
const stamp = Date.now(); const goals = ['Native R4 A ' + stamp, 'Native R4 B ' + stamp, 'Native R4 C ' + stamp, 'Native R4 D ' + stamp];
await create('Parallel-A-' + stamp); await send(goals[0]); await held(1);
await create('Parallel-B-' + stamp); await send(goals[1]); await held(2);
await tap('停止任务'); await waitFor('已停止'); await held(1);
await tap('查看活动任务 ' + goals[0]); await fetch('http://127.0.0.1:4181/release'); await waitFor('Parallel root complete: ' + goals[0]);
await create('Parallel-C-' + stamp); await send(goals[2]); await held(1);
await create('Parallel-D-' + stamp); await send(goals[3]); await held(2);
await stop(); await open(); await waitFor('已中断'); await stop();
const execute = promisify(execFile); const binary = path.join(process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const target = 'work/r4-native-parallel.sqlite';
for (const suffix of ['', '-wal']) try {
  const { stdout } = await execute(binary, ['-s', process.argv[2], 'exec-out', 'run-as', 'com.agentmobile.app', 'cat', 'files/SQLite/agent-mobile.sqlite' + suffix], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 }); await fs.writeFile(target + suffix, stdout);
} catch (error) { if (suffix) await fs.rm(target + suffix, { force: true }); else throw error; }
{
  const db = new DatabaseSync(target, { readOnly: true });
  try {
    const runs = readRuns(db); const matched = goals.map((goal) => runs.find((run) => run.prompt === goal));
    if (matched.map((run) => run?.state).join(',') !== 'completed,cancelled,interrupted,interrupted' || new Set(matched.map((run) => run.projectId)).size !== 4) throw new Error('并行项目终态或身份隔离失败');
    const operations = db.prepare("SELECT payload FROM records WHERE bucket='operations'").all().map((row) => JSON.parse(row.payload));
    for (const run of matched) if (!operations.some((operation) => operation.runId === run.id && operation.projectId === run.projectId && operation.phase === 'recorded' && operation.changes.some((change) => change.path === 'documents/parallel.md')))
      throw new Error('并行项目文件回执缺失或串项目');
    const active = JSON.parse(db.prepare("SELECT payload FROM records WHERE bucket='run-indexes' AND id='active'").get().payload); if (active.ids.length) throw new Error('中断恢复后仍有活动运行');
    process.stdout.write('R4 native verified: separate-project writes and two simultaneous model requests, targeted cancellation, two-root process interruption recovery, serialized SQLite writes.\n');
  } finally { db.close(); }
}
await open();
