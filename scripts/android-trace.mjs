import { adb, dump, tap, waitFor, screenshot, sleep, metroPort, scrollTo, tapScrolled } from './android-ui.mjs';

async function openApp() {
  await adb('shell', 'am', 'force-stop', 'com.agentmobile.app');
  await adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d',
    'exp+agent-mobile://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A' + metroPort, 'com.agentmobile.app');
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const xml = await dump();
    if (xml.includes('Continue')) { await tap('Continue'); continue; }
    if (xml.includes('Go home')) { await tap('Close'); continue; }
    if (xml.includes('content-desc="设置"')) return;
    await sleep(500);
  }
  throw new Error('开发客户端未就绪。');
}
async function fill(label, value) {
  await scrollTo(label, true); await tap(label); await adb('shell', 'input', 'keyevent', '123'); await adb('shell', 'input', 'keyevent', ...Array(100).fill('67'));
  await adb('shell', 'input', 'text', value);
  if ((await adb('shell', 'dumpsys', 'input_method')).includes('mInputShown=true')) await adb('shell', 'input', 'keyevent', '4');
}
async function reveal(label) {
  for (let i = 0; i < 8; i++) {
    if ((await dump()).includes(label)) return;
    await adb('shell', 'input', 'swipe', '500', '650', '500', '1550', '300'); await sleep(350);
  }
  throw new Error('轨迹中未找到：' + label);
}
await adb('reverse', 'tcp:4181', 'tcp:4181'); await openApp();
await tap('设置'); await tap('浅色'); await tap('关闭');
if (!(await dump()).includes('新建项目')) await tap('切换项目');
await tap('新建项目'); await tap('项目名称'); await adb('shell', 'input', 'text', 'Trace-' + Date.now()); await tap('创建工作区');
await tap('设置'); await tap('模型与供应商'); await tap('添加连接'); await tap('自定义服务');
await fill('连接名称', 'Native-Gemini'); await tapScrolled('通信协议：Gemini 原生');
await fill('服务基础地址', 'http://127.0.0.1:4181'); await fill('API Key', 'fixture-key'); await tap('保存连接');
await tapScrolled('检测连接并发现模型'); await tapScrolled('编辑模型 Mock');
await tapScrolled('推理模式：开启'); await fill('推理预算 tokens', '2048'); await tap('保存模型'); await sleep(500);
await tapScrolled('设为全局默认'); await tap('返回'); await tap('返回'); await tap('返回');
await fill('任务目标', 'Make%sa%snote.'); await tap('发送任务'); await waitFor('已完成');
await reveal('展开推理摘要'); await tap('展开推理摘要'); await waitFor('服务返回的摘要');
if ((await dump()).includes('private-mock-signature')) throw new Error('签名泄漏到轨迹界面。');
await screenshot('trace-android-light.png'); await tap('展开推理摘要');
await reveal('查看工具详情 保存文字内容 documents/gemini.md'); await tap('查看工具详情 保存文字内容 documents/gemini.md');
await waitFor('输入'); await reveal('结果'); await screenshot('trace-android-tool-details.png');
await reveal('查看工具详情 保存文字内容 documents/gemini.md'); await tap('查看工具详情 保存文字内容 documents/gemini.md');
await openApp(); await reveal('展开推理摘要'); await tap('展开推理摘要'); await waitFor('服务返回的摘要');
await tap('设置'); await tap('深色'); await tap('关闭'); await screenshot('trace-android-dark.png');
await tap('新建对话'); await fill('任务目标', 'PAUSE'); await tap('发送任务'); await waitFor('展开推理摘要'); await sleep(600);
await openApp(); await waitFor('已中断'); await tap('展开推理摘要'); await waitFor('服务返回的摘要 · 未完整结束');
await waitFor('进程中断前的公开摘要。'); await screenshot('trace-android-interrupted.png');
process.stdout.write('Android trace passed: native reasoning stream, ordered steps, tool details, SQLite restart, light/dark, interrupted reasoning.\n');
