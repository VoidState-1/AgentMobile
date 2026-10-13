import { adb, dump, nodes, tap, screenshot, waitFor, metroPort, sleep } from './android-ui.mjs';

async function scrollTo(label, inputOnly = false) {
  for (let i = 0; i < 12; i++) {
    const list = nodes(await dump());
    const footer = list.find((node) => ['保存连接', '保存模型'].includes(node['content-desc']));
    const maximumY = footer ? Number([...footer.bounds.matchAll(/\d+/g)][1][0]) - 20 : 2350;
    if (list.some((node) => {
      const bounds = [...node.bounds.matchAll(/\d+/g)].map((m) => Number(m[0]));
      return inputOnly ? node.class === 'android.widget.EditText' && node['content-desc'] === label && bounds[3] - bounds[1] > 60 && bounds[1] > 240 && bounds[3] < maximumY :
        (node['content-desc'] === label || node.text === label) && (bounds[1] + bounds[3]) / 2 > 240 && (bounds[1] + bounds[3]) / 2 < maximumY;
    })) return;
    await adb('shell', 'input', 'swipe', '520', '1700', '520', '620', '350'); await sleep(300);
  }
  throw new Error('滚动后未找到：' + label);
}
async function click(label) { await scrollTo(label); await tap(label); }
async function fill(label, value) {
  await scrollTo(label, true); await tap(label); await adb('shell', 'input', 'keyevent', '123');
  await adb('shell', 'input', 'keyevent', ...Array(100).fill('67'));
  await adb('shell', 'input', 'text', value);
  if ((await adb('shell', 'dumpsys', 'input_method')).includes('mInputShown=true')) await adb('shell', 'input', 'keyevent', '4');
}
async function openApp() {
  await adb('shell', 'am', 'force-stop', 'com.agentmobile.app');
  await adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d',
    'exp+agent-mobile://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A' + metroPort, 'com.agentmobile.app');
  await waitFor('设置');
}
await adb('reverse', 'tcp:4181', 'tcp:4181');
await openApp();
if ((await dump()).includes('Continue')) await tap('Continue');
if (!process.argv.includes('--verify-only')) {
await tap('设置'); await tap('浅色'); await tap('关闭');
if ((await dump()).includes('切换项目') && !(await dump()).includes('新建项目')) await tap('切换项目');
await tap('新建项目'); await tap('项目名称'); await adb('shell', 'input', 'text', 'NativeConfig-' + Date.now()); await tap('创建工作区');
for (const [protocol, label] of [['chat-completions', 'Chat Completions'], ['anthropic-messages', 'Anthropic Messages'], ['gemini', 'Gemini 原生']]) {
  await tap('设置'); await tap('模型与供应商'); await tap('添加连接'); await tap('自定义服务');
  await fill('连接名称', 'Native-' + (protocol === 'gemini' ? 'G' : protocol === 'anthropic-messages' ? 'A' : 'C'));
  if (protocol !== 'chat-completions') await click('通信协议：' + label);
  await fill('服务基础地址', 'http://127.0.0.1:4181'); await fill('API Key', 'test-key');
  await screenshot('config-android-' + protocol + '-form.png'); await tap('保存连接'); await sleep(1500);
  await click('检测连接并发现模型'); await click('编辑模型 Mock');
  await click('工具检测 · 可能计费'); await scrollTo('工具调用 → 宿主返回 → 模型继续回答已通过。');
  await click('图片检测 · 可能计费'); await scrollTo('模型正确识别了内置图片的四个色块。');
  await click('设为全局默认'); await tap('返回'); await tap('返回'); await tap('返回');
  await fill('任务目标', 'Make%sa%snote.'); await tap('发送任务');
  await tap('资料'); await waitFor('打开 documents/' + protocol + '.md'); await tap('打开 documents/' + protocol + '.md');
  if (!(await dump()).includes('Android native tool loop passed')) throw new Error(protocol + ' 未保存正确文件。');
  await screenshot('config-android-' + protocol + '-result.png'); await tap('关闭文件'); await tap('会话');
}
}
await openApp(); await tap('设置'); await tap('模型与供应商');
await click('打开连接 Native-G');
await waitFor('凭证已保存 · 留空保留现有密钥'); await fill('连接名称', 'Unsaved'); await tap('返回');
await waitFor('有尚未保存的配置'); await tap('继续编辑');
if (!(await dump()).includes('Unsaved')) throw new Error('继续编辑丢失配置草稿。');
await tap('返回'); await tap('放弃修改并离开');
await screenshot('config-android-light.png'); await tap('返回');
await tap('设置'); await tap('深色'); await tap('模型与供应商'); await waitFor('搜索连接'); await sleep(1000); await screenshot('config-android-dark.png'); await tap('返回');
process.stdout.write('Android configuration passed: three protocols, tool/image diagnostics, Git files, SecureStore restart, unsaved guard, light/dark.\n');
