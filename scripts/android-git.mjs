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
import { verifyGitRecords } from './android-git-records.mjs';

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
      await tap(xml.includes('content-desc="Close"') ? 'Close' : 'Reload');
      continue;
    }
    if (xml.includes('content-desc="设置"')) return;
    await sleep(500);
  }
  throw new Error('开发客户端未就绪');
}
async function fill(label, text) {
  await scrollTo(label, true);
  await tap(label);
  await adb('shell', 'input', 'keyevent', '123');
  await adb('shell', 'input', 'keyevent', ...Array(200).fill('67'));
  await adb('shell', 'input', 'text', text);
}
async function edit(text) {
  await tap('文件');
  await tap('打开 documents/notes.md');
  await tap('编辑');
  await fill('正文', text);
  await tap('保存');
  await waitFor('所有修改已保存');
  await tap('关闭文件');
  await tap('Git');
}

if (process.argv.includes('--recover')) {
  await openApp();
  await tap('Git');
  await waitFor('提交历史 · 2');
  await waitFor('查看未暂存差异 documents/notes.md');
  await adb('shell', 'am', 'force-stop', 'com.agentmobile.app');
  await verifyGitRecords(process.argv[2]);
  process.stdout.write('Android Git receipt recovery passed without duplication.\n');
} else {
  await openApp();
  if (!(await dump()).includes('新建项目')) await tap('项目与对话');
  await tap('新建项目');
  await tap('项目名称');
  await adb('shell', 'input', 'text', 'GitNative-' + Date.now());
  await tap('创建工作区');
  await edit('Git_v1');
  await tap('暂存 documents/notes.md');
  await waitFor('取消暂存 documents/notes.md');
  await screenshot('git-android-staged.png');
  await openApp();
  await tap('Git');
  await waitFor('取消暂存 documents/notes.md');
  await edit('Git_v2');
  await tap('查看未暂存差异 documents/notes.md');
  if (!(await dump()).includes('Git_v1') || !(await dump()).includes('Git_v2'))
    throw new Error('原生工作区/暂存差异不正确');
  await screenshot('git-android-diff.png');
  await tap('关闭');
  await fill('提交说明', 'Save%sv1');
  await tapScrolled('提交已暂存');
  await waitFor('提交历史 · 2');
  await waitFor('查看未暂存差异 documents/notes.md');
  await screenshot('git-android-light.png');
  await tap('对话');
  await fill('任务目标', 'Make%sa%snote.');
  await tap('发送任务');
  await waitFor('已完成');
  await openApp();
  await tap('设置');
  await tap('深色');
  await tap('对话');
  await tap('Git');
  await waitFor('查看未暂存差异 documents/summary.md');
  await screenshot('git-android-dark.png');
  await adb('shell', 'am', 'force-stop', 'com.agentmobile.app');
  await verifyGitRecords(process.argv[2], true);
  await openApp();
  await tap('Git');
  await waitFor('提交历史 · 2');
  await waitFor('查看未暂存差异 documents/notes.md');
  await adb('shell', 'am', 'force-stop', 'com.agentmobile.app');
  await verifyGitRecords(process.argv[2]);
  process.stdout.write(
    'Android Git passed: stage/restart, frozen index diff/commit, uncommitted Pi task, themes, standard repository, commit receipt recovery without duplication.\n',
  );
}
