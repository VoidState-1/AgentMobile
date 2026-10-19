import {
  adb,
  dump,
  tapReady as tap,
  scrollTo,
  waitFor,
  sleep,
  screenshot,
  metroPort,
} from './android-ui.mjs';

async function tapScrolled(label) {
  await scrollTo(label);
  await tap(label);
}

async function fill(label, value) {
  await scrollTo(label, true);
  await tap(label);
  await adb('shell', 'input', 'keyevent', '123');
  await adb('shell', 'input', 'keyevent', ...Array(100).fill('67'));
  await adb('shell', 'input', 'text', value);
  await adb('shell', 'input', 'keyevent', '4');
}
async function absent(label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (!(await dump()).includes(label)) return;
    await sleep(250);
  }
  throw new Error('Git UI did not remove ' + label);
}
await adb('reverse', `tcp:${metroPort}`, `tcp:${metroPort}`);
await adb('shell', 'am', 'force-stop', 'com.agentmobile.app');
await adb(
  'shell',
  'am',
  'start',
  '-a',
  'android.intent.action.VIEW',
  '-d',
  `exp+agent-mobile://expo-development-client/?url=${encodeURIComponent('http://127.0.0.1:' + metroPort)}`,
  'com.agentmobile.app',
);
await waitFor('设置', 60000);
if (!(await dump()).includes('content-desc="新建项目"')) await tap('项目与对话');
await tap('新建项目');
await tap('项目名称');
await adb('shell', 'input', 'text', 'GitUI-' + Date.now());
await tap('创建工作区');
await tap('Git');
await tap('仓库');
await fill('新分支名称', 'ui-feature');
await tapScrolled('创建分支');
await tap('切换到 ui-feature');
await waitFor('ui-feature · 当前');
await tap('切换到 main');
await waitFor('main · 当前');
await tap('删除分支 ui-feature');
await tap('确认删除');
await absent('切换到 ui-feature');
await fill('Git 姓名', 'MobileUI');
await fill('Git 邮箱', 'ui@example.invalid');
await tapScrolled('保存提交身份');
await fill('标签名称', 'ui-v1');
await tapScrolled('创建标签');
await tapScrolled('删除标签 ui-v1');
await tap('确认删除');
await absent('删除标签 ui-v1');
await screenshot('native-git-repository-ui.png');
process.stdout.write(
  'Native Git repository UI passed: branch create/switch/delete, identity and tag create/delete.\n',
);
