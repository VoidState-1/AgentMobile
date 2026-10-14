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
  await scrollTo(label, true); await tap(label); await adb('shell', 'input', 'keyevent', '123');
  await adb('shell', 'input', 'keyevent', ...Array(400).fill('67')); await adb('shell', 'input', 'text', value);
  if ((await adb('shell', 'dumpsys', 'input_method')).includes('mInputShown=true')) await adb('shell', 'input', 'keyevent', '4');
}
async function settings() { await tap('设置'); await tap('Agent 设置'); await waitFor('保存 Agent 设置'); }
await openApp(); await tap('设置'); await tap('浅色'); await tap('关闭');
if (!(await dump()).includes('新建项目')) await tap('切换项目');
await tap('新建项目'); await tap('项目名称'); await adb('shell', 'input', 'text', 'AgentSettings-' + Date.now()); await tap('创建工作区');
await settings(); await fill('系统提示词', 'native_style'); await fill('模型请求轮数', '80'); await fill('工具调用次数', '300');
await fill('任务总时长（分钟）', '30'); await fill('单次请求超时（秒）', '600'); await tap('保存 Agent 设置');
await waitFor('Agent 设置已保存，下次任务生效。'); await tap('返回');
await openApp(); await settings();
if ((await waitFor('系统提示词')).text !== 'native_style') throw new Error('系统提示词未从 SQLite 恢复。');
if ((await waitFor('模型请求轮数')).text !== '80') throw new Error('执行预算未从 SQLite 恢复。');
await screenshot('agent-settings-android-light.png'); await fill('系统提示词', 'unsaved_style'); await tap('返回');
await waitFor('有尚未保存的配置'); await tap('继续编辑');
if ((await waitFor('系统提示词')).text !== 'unsaved_style') throw new Error('未保存保护丢失提示词。');
await tap('返回'); await tap('放弃修改并离开');
await fill('任务目标', 'Make%snotes.'); await tap('发送任务'); await waitFor('已完成');
await tap('设置'); await tap('深色'); await tap('Agent 设置'); await waitFor('系统提示词'); await screenshot('agent-settings-android-dark.png');
await tapScrolled('恢复默认预算'); await tap('保存 Agent 设置'); await waitFor('Agent 设置已保存，下次任务生效。');
await tap('返回'); await openApp(); await settings();
if ((await waitFor('模型请求轮数')).text !== '50') throw new Error('恢复默认预算未保存。');
if ((await waitFor('系统提示词')).text !== 'native_style') throw new Error('恢复预算改变了系统提示词。');
process.stdout.write('Android Agent settings passed: prompt and budget persistence, restart, unsaved guard, demo run, light/dark, independent budget reset.\n');
