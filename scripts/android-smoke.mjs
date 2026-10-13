import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execute = promisify(execFile);
const sdkDirectory = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
if (!sdkDirectory || !process.argv[2]) throw new Error('请设置 ANDROID_HOME，并传入已启动的模拟器 serial。');
const binary = path.join(sdkDirectory, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const serial = process.argv[2];
const adb = async (...args) => (await execute(binary, ['-s', serial, ...args], { maxBuffer: 4 * 1024 * 1024 })).stdout;
const sleep = (time) => new Promise((resolve) => setTimeout(resolve, time));
const dump = async () => {
  const file = '/sdcard/agent-mobile-window-' + Date.now() + '.xml';
  try {
    await adb('shell', 'uiautomator', 'dump', file);
    return await adb('shell', 'cat', file);
  } finally { await adb('shell', 'rm', '-f', file).catch(() => {}); }
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
const projectName = 'NativeSmoke-' + Date.now();
if ((await dump()).includes('Continue')) await tap('Continue');
if ((await dump()).includes('← 工作区')) await tap('← 工作区');
await tap('＋ 新建项目');
await tap('项目名称');
await adb('shell', 'input', 'text', projectName);
await tap('创建工作区');
await waitFor('打开 documents/notes.md');
await tap('Agent');
await tap('开始任务 ↗');
await waitFor('已完成');
await tap('资料');
await waitFor('打开 documents/summary.md');
await adb('shell', 'am', 'force-stop', 'com.agentmobile.app');
await adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d',
  'exp+agent-mobile://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081', 'com.agentmobile.app');
await tap(projectName);
await waitFor('打开 documents/summary.md');
await sleep(1000);
await adb('shell', 'screencap', '-p', '/sdcard/agent-mobile-smoke.png');
await adb('pull', '/sdcard/agent-mobile-smoke.png', 'work/prototype-android.png');
await fs.writeFile('work/native-ui.xml', await dump());
process.stdout.write('Android smoke passed: project, Pi tools, Git write, force-stop persistence.\n');
