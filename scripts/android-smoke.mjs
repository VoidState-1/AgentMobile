import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execute = promisify(execFile);
const sdkDirectory = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
if (!sdkDirectory || !process.argv[2]) throw new Error('请设置 ANDROID_HOME，并传入已启动的模拟器 serial。');
const binary = path.join(sdkDirectory, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const serial = process.argv[2];
const metroPort = process.env.AGENT_MOBILE_METRO_PORT ?? '8081';
if (!/^\d{4,5}$/.test(metroPort)) throw new Error('无效的 Metro 端口。');
const adb = async (...args) => (await execute(binary, ['-s', serial, ...args], { maxBuffer: 4 * 1024 * 1024 })).stdout;
const sleep = (time) => new Promise((resolve) => setTimeout(resolve, time));
const dump = async () => {
  let failure;
  for (let attempt = 0; attempt < 5; attempt++) {
    const file = '/sdcard/agent-mobile-window-' + Date.now() + '.xml';
    try {
      await adb('shell', 'uiautomator', 'dump', file);
      const xml = await adb('shell', 'cat', file);
      if (!xml.includes('<hierarchy')) throw new Error('窗口尚未就绪。');
      return xml;
    } catch (error) { failure = error; }
    finally { await adb('shell', 'rm', '-f', file).catch(() => {}); }
    await sleep(500);
  }
  throw failure;
};
const nodes = (xml) => [...xml.matchAll(/<node\s+([^>]+)>/g)].map((match) => {
  const attrs = {};
  for (const [, key, value] of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[key] = value;
  return attrs;
});
async function waitFor(label, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    let xml;
    try { xml = await dump(); } catch { await sleep(500); continue; }
    const list = nodes(xml);
    const node = list.find((item) => item['content-desc'] === label && (item.clickable === 'true' || item.class === 'android.widget.EditText')) ??
      list.find((item) => item['content-desc'] === label) ?? list.find((item) => item.text === label);
    if (node) return node;
    await sleep(500);
  }
  await fs.writeFile('work/native-ui.xml', await dump());
  throw new Error('未找到：' + label);
}
async function tap(label) {
  process.stdout.write('tap: ' + label + '\n');
  const node = await waitFor(label);
  const coordinates = [...node.bounds.matchAll(/\d+/g)].map((item) => Number(item[0]));
  await adb('shell', 'input', 'tap', String((coordinates[0] + coordinates[2]) / 2), String((coordinates[1] + coordinates[3]) / 2));
  await sleep(400);
}
async function screenshot(name) {
  const file = '/sdcard/agent-mobile-smoke.png';
  try {
    await adb('shell', 'screencap', '-p', file);
    await adb('pull', file, 'work/' + name);
  } finally { await adb('shell', 'rm', '-f', file).catch(() => {}); }
}
const projectName = 'NativeSmoke-' + Date.now();
await fs.mkdir('work', { recursive: true });
if ((await dump()).includes('Continue')) await tap('Continue');
if ((await dump()).includes('Go home')) await tap('Close');
await tap('设置');
await tap('浅色');
await tap('演示模式');
await tap('保存设置');
if ((await dump()).includes('切换项目') && !(await dump()).includes('新建项目')) await tap('切换项目');
await tap('新建项目');
await tap('项目名称');
await adb('shell', 'input', 'text', projectName);
await screenshot('workbench-android-keyboard.png');
await tap('创建工作区');
await tap('资料');
await tap('打开 documents/notes.md');
await tap('编辑');
await tap('正文');
await adb('shell', 'input', 'keyevent', '123');
await adb('shell', 'input', 'text', '%sNative%ssaved%sedit.');
await screenshot('workbench-android-editor.png');
await tap('关闭文件');
await waitFor('有尚未保存的修改');
await tap('继续编辑');
if (!(await dump()).includes('Native saved edit.')) throw new Error('继续编辑后草稿丢失。');
await tap('关闭文件');
await tap('保存后离开');
await tap('会话');
await waitFor('任务目标');
await tap('任务目标');
await adb('shell', 'input', 'text', 'Organize%sthe%sproject%snotes.');
await tap('发送任务');
await waitFor('已完成');
await screenshot('workbench-android-light.png');
await tap('资料');
await waitFor('打开 documents/summary.md');
await adb('shell', 'am', 'force-stop', 'com.agentmobile.app');
await adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d',
  'exp+agent-mobile://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A' + metroPort, 'com.agentmobile.app');
await tap('资料');
await waitFor('打开 documents/summary.md');
await tap('打开 documents/notes.md');
if (!(await dump()).includes('Native saved edit.')) throw new Error('重启后编辑内容丢失。');
await tap('关闭文件');
await tap('设置');
await tap('深色');
await tap('关闭');
await tap('会话');
await sleep(1000);
await screenshot('workbench-android-dark.png');
await screenshot('workbench-android.png');
await adb('shell', 'am', 'force-stop', 'com.agentmobile.app');
await adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d',
  'exp+agent-mobile://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A' + metroPort, 'com.agentmobile.app');
await waitFor('会话');
if (!(await dump()).includes('workbench-dark')) throw new Error('重启后深色偏好丢失。');
await screenshot('workbench-android-reopened-dark.png');
await fs.writeFile('work/native-ui.xml', await dump());
process.stdout.write('Android smoke passed: editing, unsaved protection, themes, Pi tools, Git write, force-stop persistence.\n');
