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
import { verifyMcpRecords } from './android-mcp-records.mjs';

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
  const end = Date.now() + 60000;
  while (Date.now() < end) {
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
  throw new Error('开发客户端未就绪');
}
async function fill(label, value) {
  await scrollTo(label, true);
  await tap(label);
  await adb('shell', 'input', 'keyevent', '123');
  await adb('shell', 'input', 'keyevent', ...Array(300).fill('67'));
  await adb('shell', 'input', 'text', value);
  if ((await adb('shell', 'dumpsys', 'input_method')).includes('mInputShown=true'))
    await adb('shell', 'input', 'keyevent', '4');
}
async function allowTool() {
  await tapScrolled('允许自动调用 lookup');
  const node = await waitFor('允许自动调用 lookup');
  if (node.checked !== 'true') throw new Error('工具授权开关未启用。');
}
await adb('reverse', 'tcp:4181', 'tcp:4181');
if (!process.argv.includes('--continue')) {
  await openApp();
  if (!(await dump()).includes('新建项目')) await tap('切换项目');
  await tap('新建项目');
  await tap('项目名称');
  await adb('shell', 'input', 'text', 'MCP-' + Date.now());
  await tap('创建工作区');
  await tap('设置');
  await tap('模型与供应商');
  await tap('添加连接');
  await tap('自定义服务');
  await fill('连接名称', 'MCP-model');
  await fill('服务基础地址', 'http://127.0.0.1:4181');
  await fill('API Key', 'fixture-model-key');
  await tap('保存连接');
  await waitFor('凭证已保存 · 留空保留现有密钥');
  await tapScrolled('检测连接并发现模型');
  await tapScrolled('编辑模型 MCP Fixture');
  await tapScrolled('设为全局默认');
  await tap('返回');
  await tap('返回');
  await tap('返回');
  await tap('设置');
  await tap('远程 MCP');
  await tap('添加连接');
  await fill('MCP 连接名称', 'MCP-native');
  await fill('MCP 端点', 'http://127.0.0.1:4181/mcp-modern');
  await fill('MCP Token', 'fixture-mcp-token');
  await tap('保存 MCP 连接');
  await waitFor('Token 已保存 · 留空保留现有凭证');
  await tapScrolled('检测并发现工具');
  await waitFor('发现 2 个工具；尚未调用。');
  await allowTool();
  await screenshot('mcp-android-authorized.png');
  await tap('返回');
  await tap('返回');
  await fill('任务目标', 'MCP%stask');
  await tap('发送任务');
  await waitFor('已保存远程资料。');
} else await openApp();
if (process.argv.includes('--retry')) {
  await fill('任务目标', 'MCP%stask%sretry');
  await tap('发送任务');
  await waitFor('已保存远程资料。');
}
await tapScrolled('查看工具详情 MCP · MCP-native · 资料查询 notes');
await waitFor('结果');
await screenshot('mcp-android-tool.png');
await tap('资料');
await tap('打开 documents/mcp.md');
await waitFor('远程资料：MCP 查询成功。');
await openApp();
await tap('设置');
await tap('远程 MCP');
await tap('配置 MCP MCP-native');
await waitFor('Token 已保存 · 留空保留现有凭证');
await screenshot('mcp-android-restored.png');
await fill('MCP 端点', 'http://127.0.0.1:4181/mcp-legacy');
await tap('保存 MCP 连接');
await waitFor('MCP 连接已保存。');
await tapScrolled('检测并发现工具');
await waitFor('发现 2 个工具；尚未调用。');
await allowTool();
await tap('返回');
await tap('返回');
await fill('任务目标', 'Legacy%stask');
await tap('发送任务');
await tap('资料');
await waitFor('打开 documents/mcp-legacy.md');
await tap('会话');
const stats = await (await fetch('http://127.0.0.1:4181/stats')).json();
if (!stats.modernCalls || !stats.legacyCalls) throw new Error('两代原生 MCP 调用未完成。');
await tap('设置');
await tap('远程 MCP');
await tap('配置 MCP MCP-native');
await fill('MCP 端点', 'http://127.0.0.1:4181/mcp-hold');
await tap('保存 MCP 连接');
await waitFor('MCP 连接已保存。');
await tapScrolled('检测并发现工具');
await waitFor('发现 2 个工具；尚未调用。');
await allowTool();
await tap('返回');
await tap('返回');
await fill('任务目标', 'HOLD%stask');
await tap('发送任务');
for (let i = 0; i < 30; i++) {
  if ((await (await fetch('http://127.0.0.1:4181/stats')).json()).heldCalls) break;
  await sleep(500);
}
await tapScrolled('查看工具详情 MCP · MCP-native · 资料查询 wait');
await waitFor('远端正在执行，等待核对');
await openApp();
await waitFor('任务已中断，部分 MCP 调用的远端结果未知，请先核对服务状态。');
await tap('设置');
await tap('远程 MCP');
await tap('配置 MCP MCP-native');
await tapScrolled('核对后解除重试限制 lookup');
await waitFor('解除重试限制');
await screenshot('mcp-android-unknown.png');
await tap('已核对，允许再次调用');
await verifyMcpRecords(process.argv[2]);
process.stdout.write(
  'Android MCP passed: 2026/2025 SSE, SecureStore/SQLite restart, Pi tools/local Git, progress, forced interruption and unknown recovery.\n',
);
