import { adb, dump, tap, waitFor, screenshot, sleep, metroPort, scrollTo, tapScrolled } from './android-ui.mjs';

async function openApp() {
  await adb('shell', 'am', 'force-stop', 'com.agentmobile.app');
  await adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d',
    'exp+agent-mobile://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A' + metroPort, 'com.agentmobile.app');
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const xml = await dump(); if (xml.includes('Continue')) { await tap('Continue'); continue; }
    if (xml.includes('Go home')) { await tap('Close'); continue; }
    if (xml.includes('content-desc="设置"')) return; await sleep(500);
  }
  throw new Error('开发客户端未就绪。');
}
async function fill(label, value) {
  await scrollTo(label, true); await tap(label); await adb('shell', 'input', 'keyevent', '123'); await adb('shell', 'input', 'keyevent', ...Array(300).fill('67'));
  await adb('shell', 'input', 'text', value); if ((await adb('shell', 'dumpsys', 'input_method')).includes('mInputShown=true')) await adb('shell', 'input', 'keyevent', '4');
}
await adb('reverse', 'tcp:4181', 'tcp:4181');
if (!process.argv.includes('--resume')) {
await openApp();
if (!(await dump()).includes('新建项目')) await tap('切换项目'); await tap('新建项目');
await tap('项目名称'); await adb('shell', 'input', 'text', 'Live-' + Date.now()); await tap('创建工作区');
await tap('设置'); await tap('模型与供应商'); await tap('添加连接'); await tap('自定义服务');
await fill('连接名称', 'Live'); await fill('服务基础地址', 'http://127.0.0.1:4181'); await fill('API Key', 'fixture-key'); await tap('保存连接');
await waitFor('凭证已保存 · 留空保留现有密钥');
await tapScrolled('检测连接并发现模型'); await tapScrolled('编辑模型 Live'); await tapScrolled('设为全局默认');
await tap('返回'); await tap('返回'); await tap('返回');
await fill('任务目标', 'Make%slive%snotes.'); await tap('发送任务');
}
await tap('资料');
await waitFor('打开 documents/live.md'); await tap('打开 documents/live.md'); await waitFor('原生实时内容第一版。');
await waitFor('Agent 正在修改项目。你可以阅读，完成后再编辑。');
await fetch('http://127.0.0.1:4181/release/update'); await waitFor('原生实时内容第二版。');
if ((await dump()).includes('原生实时内容第一版。')) throw new Error('原生资料仍显示旧版本。');
await screenshot('workspace-live-android-reading.png'); await tap('关闭文件'); await tap('会话'); await waitFor('停止任务');
await fetch('http://127.0.0.1:4181/release/finish'); await waitFor('已完成');
await openApp(); await tap('资料'); await tap('打开 documents/live.md'); await waitFor('原生实时内容第二版。');
process.stdout.write('Android live workspace passed: new file visible before completion, open preview updates before final response, restart retains latest content.\n');
