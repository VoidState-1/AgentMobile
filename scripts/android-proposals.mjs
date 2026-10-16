import { readOperations } from './native-journal.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { adb, dump, tap, waitFor, sleep, metroPort } from './android-ui.mjs';
import { readRuns } from './native-runs.mjs';

// Isolated fixture device only; requires the local R3 model configuration.
const target = 'work/r5-native-proposals.sqlite';
const execute = promisify(execFile);
const binary = path.join(
  process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT,
  'platform-tools',
  process.platform === 'win32' ? 'adb.exe' : 'adb',
);
async function pull() {
  for (const suffix of ['', '-wal'])
    try {
      const { stdout } = await execute(
        binary,
        [
          '-s',
          process.argv[2],
          'exec-out',
          'run-as',
          'com.agentmobile.app',
          'cat',
          'files/SQLite/agent-mobile.sqlite' + suffix,
        ],
        { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
      );
      await fs.writeFile(target + suffix, stdout);
    } catch (error) {
      if (suffix) await fs.rm(target + suffix, { force: true });
      else throw error;
    }
}
async function install() {
  await adb('push', target, '/data/local/tmp/r5-native-proposals.sqlite');
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
    '/data/local/tmp/r5-native-proposals.sqlite',
    'files/SQLite/agent-mobile.sqlite',
  );
}
const stop = () => adb('shell', 'am', 'force-stop', 'com.agentmobile.app');
async function open() {
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
  await waitFor('设置');
}
async function create(name) {
  if (!(await dump()).includes('新建项目')) await tap('项目与对话');
  await tap('新建项目');
  await tap('项目名称');
  await adb('shell', 'input', 'text', name);
  await tap('创建工作区');
  await waitFor('任务目标');
}
async function send(goal) {
  await tap('任务目标');
  await adb('shell', 'input', 'text', goal.replaceAll(' ', '%s'));
  await tap('发送任务');
}
async function held() {
  for (let index = 0; index < 40; index++) {
    if ((await (await fetch('http://127.0.0.1:4181/stats')).json()).waiting === 1) return;
    await sleep(500);
  }
  throw new Error('写作子任务未到达候选完成前等待');
}
await adb('reverse', 'tcp:4181', 'tcp:4181');
await open();
const stamp = Date.now();
const normalGoal = 'Native R5 normal ' + stamp;
const receiptGoal = 'Native R5 receipt ' + stamp;
if (!process.argv.includes('--fault')) {
  await create('Proposal-' + stamp);
  await send(normalGoal);
  await held();
  await tap('查看隔离提案 DraftWriter: ' + normalGoal);
  await waitFor('隔离写作提案 · 编辑中');
  await waitFor('Native isolated notes.');
  await tap('关闭');
  await tap('文件');
  if ((await dump()).includes('打开 documents/proposal.md'))
    throw new Error('未合入候选提前出现在真实工作区');
  await tap('打开 documents/notes.md');
  if ((await dump()).includes('Native isolated notes.')) throw new Error('子写作提前修改真实原文');
  await tap('关闭文件');
  await fetch('http://127.0.0.1:4181/release');
  await waitFor('打开 documents/proposal.md');
  await tap('对话');
  await waitFor('已完成');
  await stop();
  await pull();
  {
    const db = new DatabaseSync(target);
    try {
      const runs = readRuns(db);
      const root = runs.find(run => run.prompt === normalGoal);
      const child = runs.find(run => run.parentRunId === root?.id);
      const proposal = JSON.parse(
        db
          .prepare("SELECT payload FROM records WHERE bucket='change-proposals' AND id=?")
          .get(child.proposalId).payload,
      );
      const operation = readOperations(db).find(operation => operation.proposalId === proposal.id);
      if (
        root.state !== 'completed' ||
        child.state !== 'completed' ||
        proposal.state !== 'applied' ||
        operation.ownerRootRunId !== root.id ||
        operation.actorRunId !== child.id ||
        operation.mergedByRunId !== root.id ||
        root.finalCommit !== root.baseCommit ||
        operation.indexChanges?.length
      )
        throw new Error('原生提案终态、归属或真实 Git 分离不一致');
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally {
      db.close();
    }
  }
  await open();
  await tap('查看产物差异 documents/proposal.md');
  await tap('撤销修改');
  await tap('确认恢复');
  await tap('文件');
  if ((await dump()).includes('打开 documents/proposal.md'))
    throw new Error('根任务撤销没有撤回合入文稿');
}
await create('Proposal-fault-' + stamp);
await stop();
await pull();
{
  const db = new DatabaseSync(target);
  try {
    db.exec(
      "CREATE TRIGGER r5_merge_failure BEFORE UPDATE ON operation_headers WHEN NEW.namespace='projects' AND json_extract(NEW.payload,'$.id') LIKE 'merge-proposal-%' AND json_extract(NEW.payload,'$.phase')='recorded' BEGIN SELECT RAISE(ABORT,'fixture merge receipt failure'); END;",
    );
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
}
await install();
await open();
await send(receiptGoal);
await held();
await fetch('http://127.0.0.1:4181/release');
await waitFor('任务状态保存失败，请重新打开应用恢复。');
await stop();
await pull();
{
  const db = new DatabaseSync(target);
  try {
    db.exec('DROP TRIGGER r5_merge_failure');
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
}
await install();
await open();
await waitFor('已中断');
await tap('文件');
await waitFor('打开 documents/proposal.md');
await stop();
await pull();
{
  const db = new DatabaseSync(target, { readOnly: true });
  try {
    const runs = readRuns(db);
    const root = runs.find(run => run.prompt === receiptGoal);
    const child = runs.find(run => run.parentRunId === root?.id);
    const proposal = JSON.parse(
      db
        .prepare("SELECT payload FROM records WHERE bucket='change-proposals' AND id=?")
        .get(child.proposalId).payload,
    );
    if (
      root.state !== 'interrupted' ||
      child.state !== 'completed' ||
      proposal.state !== 'applied' ||
      root.changedPaths.length !== 2
    )
      throw new Error('合入回执恢复没有保留子结果或汇总根变化');
    if (
      readOperations(db).some(
        operation => operation.proposalId === proposal.id && operation.phase !== 'recorded',
      )
    )
      throw new Error('合入恢复日志未收束');
    process.stdout.write(
      'R5 native verified: independent writer Pi, private candidate preview, unchanged real index/HEAD, controlled merge/attribution, root undo, SQLite merge receipt interruption/recovery without replay.\n',
    );
  } finally {
    db.close();
  }
}
await open();
