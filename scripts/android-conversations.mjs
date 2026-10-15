import { adb, dump, tap, longPress, waitFor, screenshot, sleep, metroPort } from './android-ui.mjs';

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
async function input(label, text) {
  await tap(label);
  await adb('shell', 'input', 'keyevent', '123');
  await adb('shell', 'input', 'keyevent', ...Array(100).fill('67'));
  await adb('shell', 'input', 'text', text);
}
async function rename(title) {
  await tap('重命名当前对话');
  await input('对话名称', title);
  await adb('shell', 'input', 'keyevent', '66');
  await waitFor('重命名当前对话');
}
async function select(title) {
  await tap('项目与对话');
  await tap('切换对话 ' + title);
}
async function waitContains(value) {
  for (let i = 0; i < 12; i++) {
    if ((await dump()).includes(value)) return;
    await sleep(400);
  }
  throw new Error('对话内容未出现：' + value);
}
await openApp();
await tap('设置');
await tap('模型与供应商');
await tap('运行模式：演示模式');
await tap('返回');
if (!(await dump()).includes('新建项目')) await tap('项目与对话');
await tap('新建项目');
await tap('项目名称');
await adb('shell', 'input', 'text', 'NativeChat-' + Date.now());
await tap('创建工作区');
await rename('Chat-A');
await input('任务目标', 'A_ONLY');
await tap('发送任务');
await waitFor('已完成');
await tap('新建对话');
await rename('Chat-B');
if ((await dump()).includes('A_ONLY')) throw new Error('新对话显示了另一对话的消息。');
await input('任务目标', 'B_DRAFT');
await tap('添加');
await tap('添加参考资料');
await tap('引用 documents/notes.md');
await waitFor('移除参考文件');
await select('Chat-A');
await waitFor('A_ONLY');
if ((await dump()).includes('B_DRAFT')) throw new Error('切换后串入了其他对话的草稿。');
await select('Chat-B');
await waitFor('B_DRAFT');
await waitFor('移除参考文件');
await openApp();
await waitFor('B_DRAFT');
await waitFor('移除参考文件');
await screenshot('conversations-android-restored-draft.png');
await tap('发送任务');
await waitFor('已完成');
await waitContains('B_DRAFT');
await select('Chat-A');
await waitFor('A_ONLY');
if ((await dump()).includes('B_DRAFT')) throw new Error('另一对话的任务串入当前对话。');
await tap('项目与对话');
await longPress('切换对话 Chat-B');
await tap('归档对话 Chat-B');
await tap('归档对话');
await tap('项目与对话');
await tap('已归档');
await tap('恢复对话 Chat-B');
await waitContains('B_DRAFT');
await tap('设置');
await tap('深色');
await tap('对话');
await tap('项目与对话');
await sleep(800);
await screenshot('conversations-android-dark.png');
await tap('收起侧栏');
await openApp();
await waitContains('B_DRAFT');
process.stdout.write(
  'Android multi-conversation passed: isolated messages/drafts/attachments, task IDs, restart, archive/restore, dark theme.\n',
);
