import fs from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { zipSync } from 'fflate';
import { skillSource } from '../tests/skills-fixtures.ts';
import {
  adb,
  dump,
  tap,
  waitFor,
  screenshot,
  sleep,
  metroPort,
  scrollTo,
  tapScrolled,
} from './android-ui.mjs';
import { verifySkillsRecords } from './android-skills-records.mjs';

async function openApp() {
  await adb('shell', 'am', 'force-stop', 'com.agentmobile.app');
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
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const xml = await dump();
    if (xml.includes('Continue')) {
      await tap('Continue');
      continue;
    }
    if (xml.includes('Go home')) {
      await tap('Close');
      continue;
    }
    if (xml.includes('content-desc="设置"')) return;
    await sleep(500);
  }
  throw new Error('开发客户端未就绪。');
}
async function fill(label, value, keepKeyboard = false) {
  await scrollTo(label, true);
  await tap(label);
  await adb('shell', 'input', 'keyevent', '123');
  await adb('shell', 'input', 'keyevent', ...Array(300).fill('67'));
  await adb('shell', 'input', 'text', value);
  if (!keepKeyboard && (await adb('shell', 'dumpsys', 'input_method')).includes('mInputShown=true'))
    await adb('shell', 'input', 'keyevent', '4');
}
async function waitForPart(text) {
  for (let i = 0; i < 20; i++) {
    if ((await dump()).includes(text)) return;
    await sleep(500);
  }
  throw new Error('未找到文本：' + text);
}
await adb('reverse', 'tcp:4181', 'tcp:4181');
if (
  !process.argv.includes('--continue') &&
  !process.argv.includes('--edit') &&
  !process.argv.includes('--saved-resource')
) {
  await openApp();
  if (!(await dump()).includes('新建项目')) await tap('项目与对话');
  await tap('新建项目');
  await tap('项目名称');
  await adb('shell', 'input', 'text', 'Skills-' + Date.now());
  await tap('创建工作区');
  await tap('设置');
  await tap('模型与供应商');
  await tap('添加连接');
  await tap('自定义服务');
  await fill('连接名称', 'Skills-model');
  await fill('服务基础地址', 'http://127.0.0.1:4181');
  await fill('API Key', 'fixture-key');
  await tap('保存连接');
  await waitFor('凭证已保存 · 留空保留现有密钥');
  await tapScrolled('检测连接并发现模型');
  await tapScrolled('编辑模型 Skills Fixture');
  await tapScrolled('设为全局默认');
  await tap('返回');
  await tap('返回');
  await tap('返回');
  const bytes = zipSync({
    'note-workflow/SKILL.md': Buffer.from(skillSource()),
    'note-workflow/references/template.md': Buffer.from('RESOURCE_ONE: mobile reference.'),
  });
  await fs.writeFile('work/skills-native-fixture.zip', bytes);
  await adb('push', 'work/skills-native-fixture.zip', '/sdcard/Download/skills-native-fixture.zip');
  await tap('设置');
  await tap('Agent Skills');
  await tap('导入 SKILL.md / ZIP');
  await tap('Show roots');
  await tap('Downloads');
  await tap('skills-native-fixture.zip');
  await waitFor('导入技能预览');
  await tap('安装技能包');
  await waitFor('启用技能 note-workflow');
  await tapScrolled('启用技能 note-workflow');
  if ((await waitFor('启用技能 note-workflow')).checked !== 'true') throw new Error('技能未启用。');
  await screenshot('skills-android-library.png');
  await tap('返回');
  await fill('任务目标', 'Organize%smy%snotes.');
  await tap('发送任务');
  await waitFor('技能任务完成。');
}
if (!process.argv.includes('--edit') && !process.argv.includes('--saved-resource')) {
  await tapScrolled('查看工具详情 加载技能 note-workflow');
  await waitFor('结果');
  await screenshot('skills-android-trace.png');
  await tap('文件');
  await tap('打开 documents/skill-auto.md');
  await waitFor('Skill workflow: RESOURCE_ONE');
}
if (!process.argv.includes('--saved-resource')) {
  await openApp();
  await tap('设置');
  await tap('Agent Skills');
  await tap('管理技能 note-workflow');
  await waitFor('SKILL.md 内容');
  // Repeated R key events inside a native Modal trigger the dev client's reload shortcut.
  await tapScrolled('编辑技能资源 references/template.md');
  await fill('技能资源内容', 'mobile%sinfo%sv2', true);
  await tap('应用资源到草稿');
  await tap('保存技能');
}
await waitFor('技能已保存；内容变化后请重新启用。');
await tapScrolled('启用技能 note-workflow');
if ((await waitFor('启用技能 note-workflow')).checked !== 'true')
  throw new Error('更新后技能未重新启用。');
await tap('返回');
await tap('返回');
await fill('任务目标', 'Use%sthe%sskill%sagain.');
await tap('添加');
await tap('选择技能');
await tap('使用技能 note-workflow');
await tap('发送任务');
await tap('文件');
await waitFor('打开 documents/skill-explicit.md');
const stats = await (await fetch('http://127.0.0.1:4181/stats')).json();
if (!stats.seenInstructions || !stats.seenResource || !stats.seenUpdatedResource)
  throw new Error('技能正文或资源版本未送入实际模型请求。');
await openApp();
await tap('设置');
await tap('深色');
await tap('Agent Skills');
await tap('管理技能 note-workflow');
await waitFor('SKILL.md 内容');
await screenshot('skills-android-dark.png');
await tapScrolled('查看技能版本');
await waitForPart('当前版本');
await screenshot('skills-android-history.png');
await verifySkillsRecords(process.argv[2]);
process.stdout.write(
  'Android Skills passed: native ZIP picker/import, project enable, lazy and explicit Pi loading, resources/Git, SQLite restart, editing and history, dark theme.\n',
);
