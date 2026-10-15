import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { readOperations } from './native-journal.mjs';
import { adb, tap, tapScrolled, scrollTo, waitFor, metroPort } from './android-ui.mjs';

if (process.argv[2] !== 'emulator-5572') throw new Error('仅允许当前隔离模拟器。');
const execute = promisify(execFile); const binary = path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb.exe');
const target = 'work/skills-native-fault.sqlite';
const stop = () => adb('shell', 'am', 'force-stop', 'com.agentmobile.app');
const open = async () => {
  await adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'exp+agent-mobile://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A' + metroPort, 'com.agentmobile.app');
  await waitFor('设置');
};
const head = async () => (await adb('shell', 'run-as', 'com.agentmobile.app', 'cat', 'files/agent-mobile/workspaces/agent-skills-library/repository/.git/refs/heads/main')).trim();
async function pull() {
  for (const suffix of ['', '-wal']) {
    const { stdout } = await execute(binary, ['-s', process.argv[2], 'exec-out', 'run-as', 'com.agentmobile.app', 'cat', 'files/SQLite/agent-mobile.sqlite' + suffix], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
    await fs.writeFile(target + suffix, stdout);
  }
}
async function install() {
  await adb('push', target, '/data/local/tmp/skills-native-fault.sqlite');
  await adb('shell', 'run-as', 'com.agentmobile.app', 'rm', '-f', 'files/SQLite/agent-mobile.sqlite-wal', 'files/SQLite/agent-mobile.sqlite-shm');
  await adb('shell', 'run-as', 'com.agentmobile.app', 'cp', '/data/local/tmp/skills-native-fault.sqlite', 'files/SQLite/agent-mobile.sqlite');
}
await stop(); await pull(); const beforeHead = await head();
let beforeCount; let beforeProject;
{
  const db = new DatabaseSync(target);
  try {
    beforeCount = readOperations(db, 'skills').length;
    beforeProject = db.prepare("SELECT payload FROM records WHERE bucket='skill-projects' AND id='agent-skills-library'").get().payload;
    db.exec("CREATE TRIGGER skill_receipt_failure BEFORE UPDATE ON operation_headers WHEN NEW.namespace='skills' AND json_extract(NEW.payload,'$.phase')='recorded' BEGIN SELECT RAISE(ABORT,'fixture skill receipt failure'); END;");
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally { db.close(); }
}
await install(); await open(); await tap('设置'); await tap('Agent Skills'); await tap('管理技能 note-workflow');
await tapScrolled('编辑技能资源 references/template.md'); await scrollTo('技能资源内容', true); await tap('技能资源内容');
await adb('shell', 'input', 'keyevent', '123'); await adb('shell', 'input', 'keyevent', ...Array(300).fill('67'));
await adb('shell', 'input', 'text', 'fault%sv3'); await tap('应用资源到草稿'); await tap('保存技能');
await waitFor('技能保存未完成，请保留数据并重新打开应用恢复。');
const committedHead = await head(); if (committedHead === beforeHead) throw new Error('故障未发生在 Git 成功之后');
await stop(); await pull();
let operationId;
{
  const db = new DatabaseSync(target);
  try {
    const operations = readOperations(db, 'skills'); const pending = operations.filter(operation => operation.phase !== 'recorded');
    if (operations.length !== beforeCount + 1 || pending.length !== 1 || pending[0].kind !== 'files_commit' || pending[0].phase !== 'committed' || pending[0].commit !== committedHead) throw new Error('Git 成功/SQLite 回执失败窗口不准确');
    if (db.prepare("SELECT payload FROM records WHERE bucket='skill-projects' AND id='agent-skills-library'").get().payload !== beforeProject) throw new Error('失败事务没有回滚项目元数据');
    operationId = pending[0].id; db.exec('DROP TRIGGER skill_receipt_failure'); db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally { db.close(); }
}
await install(); await open(); await tap('设置'); await tap('Agent Skills'); await tap('管理技能 note-workflow');
await waitFor('编辑技能资源 references/template.md'); await stop(); await pull();
if (await head() !== committedHead) throw new Error('恢复增加了第二个技能提交');
{
  const db = new DatabaseSync(target, { readOnly: true });
  try {
    const operations = readOperations(db, 'skills'); const recovered = operations.find(operation => operation.id === operationId);
    const configuration = JSON.parse(db.prepare("SELECT payload FROM records WHERE bucket='skills' AND id='configuration'").get().payload);
    if (operations.length !== beforeCount + 1 || recovered?.phase !== 'recorded' || configuration.commit !== committedHead) throw new Error('技能恢复回执/目录未收束');
  } finally { db.close(); }
}
console.log('Native Skills fault passed: Git success, SQL receipt+project rollback, exact operation recovery, no duplicate version.');
await open();
