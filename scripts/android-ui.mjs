import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execute = promisify(execFile);
const sdkDirectory = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
if (!sdkDirectory || !process.argv[2])
  throw new Error('请设置 ANDROID_HOME，并传入已启动的模拟器 serial。');
const binary = path.join(
  sdkDirectory,
  'platform-tools',
  process.platform === 'win32' ? 'adb.exe' : 'adb',
);
const serial = process.argv[2];
const metroPort = process.env.AGENT_MOBILE_METRO_PORT ?? '8081';
if (!/^\d{4,5}$/.test(metroPort)) throw new Error('无效的 Metro 端口。');
const adb = async (...args) =>
  (await execute(binary, ['-s', serial, ...args], { maxBuffer: 4 * 1024 * 1024 })).stdout;
const sleep = time => new Promise(resolve => setTimeout(resolve, time));
const dump = async () => {
  let failure;
  for (let attempt = 0; attempt < 5; attempt++) {
    const file = '/sdcard/agent-mobile-window-' + Date.now() + '.xml';
    try {
      await adb('shell', 'uiautomator', 'dump', file);
      const xml = await adb('shell', 'cat', file);
      if (!xml.includes('<hierarchy')) throw new Error('窗口尚未就绪。');
      return xml;
    } catch (error) {
      failure = error;
    } finally {
      await adb('shell', 'rm', '-f', file).catch(() => {});
    }
    await sleep(500);
  }
  throw failure;
};
const nodes = xml =>
  [...xml.matchAll(/<node\s+([^>]+)>/g)].map(match => {
    const attrs = {};
    for (const [, key, value] of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[key] = value;
    return attrs;
  });
async function waitFor(label, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    let xml;
    try {
      xml = await dump();
    } catch {
      await sleep(500);
      continue;
    }
    const list = nodes(xml);
    const node =
      list.find(
        item =>
          item['content-desc'] === label &&
          (item.clickable === 'true' || item.class === 'android.widget.EditText'),
      ) ??
      list.find(item => item['content-desc'] === label) ??
      list.find(item => item.text === label);
    if (node) return node;
    await sleep(500);
  }
  await fs.writeFile('work/native-ui.xml', await dump());
  throw new Error('未找到：' + label);
}
async function tap(label) {
  process.stdout.write('tap: ' + label + '\n');
  const node = await waitFor(label);
  const coordinates = [...node.bounds.matchAll(/\d+/g)].map(item => Number(item[0]));
  await adb(
    'shell',
    'input',
    'tap',
    String((coordinates[0] + coordinates[2]) / 2),
    String((coordinates[1] + coordinates[3]) / 2),
  );
  await sleep(400);
}
async function scrollTo(label, inputOnly = false) {
  for (let i = 0; i < 12; i++) {
    const list = nodes(await dump());
    const footer = list.find(node =>
      ['保存连接', '保存模型', '保存 Agent 设置', '保存 MCP 连接', '保存技能'].includes(
        node['content-desc'],
      ),
    );
    const maximumY = footer ? Number([...footer.bounds.matchAll(/\d+/g)][1][0]) - 20 : 2350;
    const interactive = list.filter(
      node =>
        node['content-desc'] === label &&
        (node.clickable === 'true' || node.class === 'android.widget.EditText'),
    );
    const candidates = !inputOnly && interactive.length ? interactive : list;
    if (
      candidates.some(node => {
        const bounds = [...node.bounds.matchAll(/\d+/g)].map(m => Number(m[0]));
        return inputOnly
          ? node.class === 'android.widget.EditText' &&
              node['content-desc'] === label &&
              bounds[3] - bounds[1] > 60 &&
              bounds[1] > 240 &&
              bounds[3] < maximumY
          : (node['content-desc'] === label || node.text === label) &&
              bounds[1] > 240 &&
              bounds[3] < maximumY &&
              bounds[3] - bounds[1] > 40;
      })
    )
      return;
    await adb('shell', 'input', 'swipe', '520', '1700', '520', '620', '350');
    await sleep(300);
  }
  throw new Error('滚动后未找到：' + label);
}
async function tapScrolled(label) {
  await scrollTo(label);
  await tap(label);
}
async function screenshot(name) {
  const file = '/sdcard/agent-mobile-smoke.png';
  try {
    await adb('shell', 'screencap', '-p', file);
    await adb('pull', file, 'work/' + name);
  } finally {
    await adb('shell', 'rm', '-f', file).catch(() => {});
  }
}
export { adb, sleep, dump, nodes, waitFor, tap, scrollTo, tapScrolled, screenshot, metroPort };
