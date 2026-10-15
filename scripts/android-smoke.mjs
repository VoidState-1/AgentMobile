import fs from 'node:fs/promises';
import { adb, sleep, dump, waitFor, tap, screenshot, metroPort } from './android-ui.mjs';

const projectName = 'NativeSmoke-' + Date.now();
await fs.mkdir('work', { recursive: true });
if ((await dump()).includes('Continue')) await tap('Continue');
if ((await dump()).includes('Go home')) await tap('Close');
await tap('设置');
await tap('浅色');
await tap('模型与供应商');
await tap('运行模式：演示模式');
await tap('返回');
if ((await dump()).includes('切换项目') && !(await dump()).includes('新建项目'))
  await tap('切换项目');
await tap('新建项目');
await tap('项目名称');
await adb('shell', 'input', 'text', projectName);
await screenshot('workbench-android-keyboard.png');
await tap('创建工作区');
await tap('资料');
await tap('打开 documents/notes.md');
await tap('编辑');
await tap('正文');
await adb('shell', 'input', 'keyevent', '123');
await adb('shell', 'input', 'text', '%sNative%ssaved%sedit.');
await screenshot('workbench-android-editor.png');
await tap('关闭文件');
await waitFor('有尚未保存的修改');
await tap('继续编辑');
if (!(await dump()).includes('Native saved edit.')) throw new Error('继续编辑后草稿丢失。');
await tap('关闭文件');
await tap('保存后离开');
await tap('会话');
await waitFor('任务目标');
await tap('任务目标');
await adb('shell', 'input', 'text', 'Organize%sthe%sproject%snotes.');
await tap('发送任务');
await waitFor('发送任务');
await screenshot('workbench-android-light.png');
await tap('资料');
await waitFor('打开 documents/summary.md');
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
await tap('资料');
await waitFor('打开 documents/summary.md');
await tap('打开 documents/notes.md');
if (!(await dump()).includes('Native saved edit.')) throw new Error('重启后编辑内容丢失。');
await tap('关闭文件');
await tap('设置');
await tap('深色');
await tap('关闭');
await tap('会话');
await sleep(1000);
await screenshot('workbench-android-dark.png');
await screenshot('workbench-android.png');
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
await waitFor('会话');
if (!(await dump()).includes('workbench-dark')) throw new Error('重启后深色偏好丢失。');
await screenshot('workbench-android-reopened-dark.png');
await fs.writeFile('work/native-ui.xml', await dump());
process.stdout.write(
  'Android smoke passed: editing, unsaved protection, themes, Pi tools, Git write, force-stop persistence.\n',
);
