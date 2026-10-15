import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { adb, tap, waitFor, dump, sleep, metroPort } from './android-ui.mjs';
import { readRuns } from './native-runs.mjs';

// Isolated fixture emulator only. Adds a local no-auth model, no real secrets.
const target = 'work/r3-native-delegation.sqlite'; const execute = promisify(execFile);
const binary = path.join(process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
async function pull() {
  for (const suffix of ['', '-wal']) try {
    const { stdout } = await execute(binary, ['-s', process.argv[2], 'exec-out', 'run-as', 'com.agentmobile.app', 'cat', 'files/SQLite/agent-mobile.sqlite' + suffix], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });
    await fs.writeFile(target + suffix, stdout);
  } catch (error) { if (suffix) await fs.rm(target + suffix, { force: true }); else throw error; }
}
const stop = () => adb('shell', 'am', 'force-stop', 'com.agentmobile.app');
async function open() {
  await adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'exp+agent-mobile://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A' + metroPort, 'com.agentmobile.app');
  for (let index = 0; index < 30; index++) { const xml = await dump(); if (xml.includes('Continue')) { await tap('Continue'); continue; }
    if (xml.includes('Go home')) { await tap('Close'); continue; } if (xml.includes('content-desc="设置"')) return; await sleep(500); }
  throw new Error('开发客户端未就绪');
}
if (!process.argv.includes('--verify')) {
await adb('reverse', 'tcp:4181', 'tcp:4181'); await open();
if (!(await dump()).includes('新建项目')) await tap('切换项目'); await tap('新建项目');
await tap('项目名称'); await adb('shell', 'input', 'text', 'R3Native-' + Date.now()); await tap('创建工作区'); await waitFor('任务目标');
await stop(); await pull();
{
  const db = new DatabaseSync(target);
  try {
    const read = (bucket, id) => JSON.parse(db.prepare('SELECT payload FROM records WHERE bucket=? AND id=?').get(bucket, id).payload);
    const configuration = read('model-config', 'configuration'); const now = new Date().toISOString();
    configuration.connections = configuration.connections.filter(connection => connection.id !== 'r3-local');
    configuration.models = configuration.models.filter(model => model.id !== 'r3-model');
    configuration.revision++; configuration.mode = 'remote'; configuration.sessionModes = {};
    configuration.connections.push({ id: 'r3-local', name: 'R3 Fixture', presetId: 'custom', protocol: 'chat-completions', baseUrl: 'http://127.0.0.1:4181', auth: 'none', compatibility: 'standard', apiVersion: '2023-06-01', enabled: true, revision: 1, createdAt: now, updatedAt: now });
    configuration.models.push({ id: 'r3-model', connectionId: 'r3-local', apiId: 'r3-fixture', name: 'R3 Fixture', enabled: true, favorite: false, revision: 1,
      capabilities: Object.fromEntries(['tools', 'images', 'reasoning'].map((key) => [key, { support: key === 'tools' ? 'supported' : 'unsupported', source: 'user' }])),
      parameters: { maxOutputTokens: 8192, allowImages: false, reasoning: 'off' }, catalog: { source: 'manual', missing: false }, checks: {}, createdAt: now, updatedAt: now });
    configuration.defaults = { global: 'r3-model', projects: {}, sessions: {} };
    db.prepare("UPDATE records SET payload=? WHERE bucket='model-config' AND id='configuration'").run(JSON.stringify(configuration)); db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally { db.close(); }
}
await adb('push', target, '/data/local/tmp/r3-native-delegation.sqlite');
await adb('shell', 'run-as', 'com.agentmobile.app', 'rm', '-f', 'files/SQLite/agent-mobile.sqlite-wal', 'files/SQLite/agent-mobile.sqlite-shm');
await adb('shell', 'run-as', 'com.agentmobile.app', 'cp', '/data/local/tmp/r3-native-delegation.sqlite', 'files/SQLite/agent-mobile.sqlite'); await open();
async function send(goal) { await tap('任务目标'); await adb('shell', 'input', 'text', goal.replaceAll(' ', '%s')); await tap('发送任务'); }
async function held() {
  await waitFor('等待子任务');
  // The root publishes waiting_children before both children finish reading.
  // Wait for the observable server barrier rather than asserting at that tick.
  for (let attempt = 0; attempt < 40; attempt++) {
    const stats = await (await fetch('http://127.0.0.1:4181/stats')).json();
    if (stats.maximum > 2) throw new Error('请求池超限');
    if (stats.waiting === 2) return;
    await sleep(500);
  }
  throw new Error('子任务没有并行等待');
}
await send('Native R3 summary'); await held(); await fetch('http://127.0.0.1:4181/release'); await waitFor('Native root summary complete.');
await stop(); await open(); await waitFor('Native root summary complete.');
await tap('新建对话'); await send('Native R3 cancel'); await held(); await tap('停止任务'); await waitFor('已停止');
await tap('新建对话'); await send('Native R3 interrupt'); await held(); await stop(); await open(); await waitFor('已中断'); await stop(); await pull();
}
{
  const db = new DatabaseSync(target, { readOnly: true });
  try {
    const runs = readRuns(db).sort((a, b) => b.admissionSequence - a.admissionSequence);
    for (const [goal, state] of [['Native R3 summary', 'completed'], ['Native R3 cancel', 'cancelled'], ['Native R3 interrupt', 'interrupted']]) {
      const root = runs.find((run) => run.kind === 'root' && run.prompt === goal); const children = runs.filter((run) => run.parentRunId === root?.id);
      if (!root || root.state !== state || children.length !== 2 || children.some((child) => child.state !== state) || new Set(children.map((child) => child.inputSnapshotRef)).size !== 1) throw new Error(goal + ' 的父子终态或快照不一致');
      if (root.trace.filter((item) => item.tool === 'spawn_agent' && item.childRunIds?.length === 1).length !== 2 || children.some((child) => child.trace.some((item) => item.kind === 'tool' && !['read_text'].includes(item.tool)))) throw new Error('原生父子轨迹/授权不一致');
      if (state === 'completed' && (children.some((child) => !child.response.includes('Native child')) || !root.response.includes('summary complete'))) throw new Error('父任务未汇总持久化子结果');
    }
    process.stdout.write('R3 native verified: two independent read-only Pi children, shared fixed snapshot, request pool <=2, durable summary, recursive cancel, process interruption recovery.\n');
  } finally { db.close(); }
}
if (!process.argv.includes('--verify')) await open();
