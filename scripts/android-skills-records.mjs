import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Inspect only the isolated fixture emulator after execution has settled.
export async function verifySkillsRecords(serial) {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT; if (!sdk) throw new Error('需要 ANDROID_HOME');
  const execute = promisify(execFile); const binary = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
  const target = 'work/skills-native-records.sqlite';
  for (const suffix of ['', '-wal']) {
    const { stdout } = await execute(binary, ['-s', serial, 'exec-out', 'run-as', 'com.agentmobile.app', 'cat', 'files/SQLite/agent-mobile.sqlite' + suffix], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
    await fs.writeFile(target + suffix, stdout);
  }
  const db = new DatabaseSync(target, { readOnly: true });
  try {
    const tasks = db.prepare("SELECT payload FROM records WHERE bucket='tasks'").all().map((row) => JSON.parse(row.payload));
    const automatic = tasks.find((task) => task.skillActivations?.some((activation) => activation.name === 'note-workflow' && activation.source === 'agent'));
    const explicit = tasks.find((task) => task.skillActivations?.some((activation) => activation.name === 'note-workflow' && activation.source === 'explicit'));
    for (const task of [automatic, explicit]) if (!task || task.state !== 'completed' || task.baseCommit === task.finalCommit || !task.trace.some((item) => item.tool === 'read_skill_resource' && item.state === 'completed')) throw new Error('缺少已完成技能调用、资源轨迹或 Git 修改。');
    if (automatic.skillsSnapshot[0].revision === explicit.skillsSnapshot[0].revision) throw new Error('更新资源后任务仍采用旧技能版本。');
    const configuration = JSON.parse(db.prepare("SELECT payload FROM records WHERE bucket='skills' AND id='configuration'").get().payload);
    if (!Object.values(configuration.grants).some((grants) => grants['note-workflow'] === configuration.skills[0].revision)) throw new Error('技能重新启用未持久化。');
    const projects = db.prepare("SELECT payload FROM records WHERE bucket='projects'").all().map((row) => JSON.parse(row.payload));
    if (projects.some((project) => project.id === 'agent-skills-library')) throw new Error('内部技能库泄漏到用户项目列表。');
    const operations = db.prepare("SELECT payload FROM records WHERE bucket='skill-library:operations'").all().map((row) => JSON.parse(row.payload));
    if (operations.filter((operation) => operation.phase === 'recorded' && operation.commit).length < 2) throw new Error('技能导入/资源更新缺少 Git 操作回执。');
    process.stdout.write('Native SQLite Skills verified: automatic/explicit activations, resource version change, Git commits, project grants and hidden library.\n');
  } finally { db.close(); }
}
if (process.argv[1]?.endsWith('android-skills-records.mjs')) await verifySkillsRecords(process.argv[2]);
