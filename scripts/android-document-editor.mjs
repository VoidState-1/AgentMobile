import fs from 'node:fs/promises';
import { adb, dump, tap, waitFor, screenshot, metroPort, sleep } from './android-ui.mjs';
import { documentEvaluate, tapDocument, swipeDocumentBlock } from './android-document-ui.mjs';

const project = 'Editor-' + Date.now();
await fs.mkdir('work', { recursive: true });
let xml = await dump();
const resuming = process.argv.includes('--resume');
if (resuming && xml.includes('有尚未保存的修改')) await tap('继续编辑');
if (!resuming) {
  if (xml.includes('Continue')) await tap('Continue');
  xml = await dump();
  if (xml.includes('content-desc="Close"')) await tap('Close');
  xml = await dump();
  if (xml.includes('content-desc="关闭文件"')) await tap('关闭文件');
  xml = await dump();
  if (xml.includes('有尚未保存的修改'))
    throw new Error('已有未保存草稿，请先处理后再启动隔离测试。');
  for (let attempt = 0; !xml.includes('新建项目') && attempt < 3; attempt++) {
    await tap('项目与对话');
    xml = await dump();
    if (!xml.includes('新建项目')) await sleep(500);
  }
  await tap('新建项目');
  await tap('项目名称');
  await adb('shell', 'input', 'text', project);
  await tap('创建工作区');
  await waitFor('文件');
  xml = await dump();
  if (xml.includes('content-desc="收起侧栏"')) await tap('收起侧栏');
  await tap('文件');
  await tap('打开 documents/notes.md');
  await tapDocument('全文');
  await tapDocument('正文');
  await adb('shell', 'input', 'keycombination', '113', '29');
  await adb('shell', 'input', 'text', 'Native%sdraft%stext');
  await waitFor('未保存的修改');
  await screenshot('document-editor-native-keyboard.png');
  await tapDocument('分块');
  await waitFor('切换编辑方式前保存？');
  await tap('继续编辑');
  await adb('shell', 'input', 'keyevent', '4');
  if (!(await dump()).includes('有尚未保存的修改')) await tap('关闭文件');
  await waitFor('有尚未保存的修改');
  await tap('继续编辑');
}
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
await waitFor('文件', 90000);
await tap('文件');
await tap('打开 documents/notes.md');
await waitFor('Native draft text');
await screenshot('document-editor-native-recovered.png');
await tap('保存文件');
await waitFor('所有修改已保存');
await tap('关闭文件');
await tap('打开 documents/notes.md');
await waitFor('Native draft text');
await swipeDocumentBlock('left');
await waitFor('正文');
await adb('shell', 'input', 'keyevent', '19');
const caretAllowed = await documentEvaluate(
  `(() => {const selection=getSelection();const node=selection.anchorNode;return !!node && !!(node.nodeType===1?node:node.parentElement).closest('.cm-line');})()`,
);
if (!caretAllowed) throw new Error('上方向键离开编辑源码');
await screenshot('document-editor-native-swipe.png');
await fs.writeFile('work/document-editor-native.xml', await dump());
await tap('关闭文件');
await tap('新建文件');
await tap('文件名称');
await adb('shell', 'input', 'keycombination', '113', '29');
const emptyName = 'empty-' + Date.now() + '.md';
await adb('shell', 'input', 'text', emptyName);
await tapDocument('分块');
await tap('保存文件');
await waitFor('所有修改已保存');
await tap('关闭文件');
await waitFor('打开 documents/' + emptyName);
process.stdout.write(
  'Android document editor passed: WebView, native keyboard, mode/leave guards, force-stop draft recovery, file save/reopen, swipe, ArrowUp and empty-file creation.\n',
);
