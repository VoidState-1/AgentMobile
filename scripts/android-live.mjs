import {
  adb,
  dump,
  waitFor,
  tap,
  scrollTo,
  tapScrolled,
  screenshot,
  metroPort,
} from './android-ui.mjs';

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey || !/^[a-zA-Z0-9._-]+$/.test(apiKey))
  throw new Error('请通过 DEEPSEEK_API_KEY 提供测试密钥。此脚本会调用付费模型。');
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
}
try {
  await openApp();
  if ((await dump()).includes('Continue')) await tap('Continue');
  if ((await dump()).includes('Go home')) await tap('Close');
  await tap('设置');
  await tap('模型与供应商');
  await tap('DeepSeek · 未保存连接');
  await scrollTo('API Key', true);
  await tap('API Key');
  // Clear an existing saved key without printing it or placing it in a log.
  await adb('shell', 'input', 'keycombination', '113', '29');
  await adb('shell', 'input', 'text', apiKey);
  if ((await adb('shell', 'dumpsys', 'input_method')).includes('mInputShown=true'))
    await adb('shell', 'input', 'keyevent', '4');
  await tap('保存连接');
  await tapScrolled('检测连接并发现模型');
  await tapScrolled('编辑模型 deepseek-flash');
  await tapScrolled('允许图片输入');
  await tap('保存模型');
  await tapScrolled('设为全局默认');
  await tap('返回');
  await tap('返回');
  await tap('返回');
  if ((await dump()).includes('项目与对话') && !(await dump()).includes('新建项目'))
    await tap('项目与对话');
  await tap('新建项目');
  await tap('项目名称');
  await adb('shell', 'input', 'text', 'DeepSeekAndroid-' + Date.now());
  await tap('创建工作区');
  await tap('文件');
  await tap('打开 documents/notes.md');
  await tap('编辑');
  await tap('正文');
  await adb('shell', 'input', 'keyevent', '123');
  // Repeated R hardware events in a native Modal can trigger React Native's
  // debug "RR" reload shortcut; use a fixture without that shortcut sequence.
  await adb('shell', 'input', 'text', '%sItem%sid%sZK-742.');
  await tap('保存');
  await waitFor('所有修改已保存');
  await tap('关闭文件');
  await tap('对话');
  await tap('任务目标');
  await adb(
    'shell',
    'input',
    'text',
    'Read%sdocuments/notes.md%sand%screate%sdocuments/native-result.md.%sWrite%sa%sshort%sChinese%ssummary,%spreserve%sthe%sreference%sidentifier%sexactly,%sand%ssave.',
  );
  await tap('发送任务');
  await tap('文件');
  // Native accessibility trees only include visible rows. Verify the new file,
  // rather than counting completed messages that may be outside the viewport.
  await waitFor('打开 documents/native-result.md', 145000);
  await tap('打开 documents/native-result.md');
  if (!(await dump()).includes('ZK-742')) throw new Error('模型未保存源资料中的识别码。');
  await screenshot('deepseek-android-result.png');
  await tap('关闭文件');
  await openApp();
  await tap('任务目标');
  await adb(
    'shell',
    'input',
    'text',
    'Read%syour%slast%ssaved%sdocument%sand%sput%sthe%ssame%sreference%sidentifier%sinto%sdocuments/native-followup.md.%sSave%sthe%sfile.',
  );
  await tap('发送任务');
  await tap('文件');
  await waitFor('打开 documents/native-followup.md', 145000);
  await tap('打开 documents/native-followup.md');
  if (!(await dump()).includes('ZK-742')) throw new Error('重启后模型未正确读取资料。');
  await screenshot('deepseek-android-followup.png');
  await tap('关闭文件');
  await tap('对话');
  await screenshot('deepseek-android-conversation.png');
  process.stdout.write(
    'Android DeepSeek passed: real SSE, files, Git, SecureStore, restart, follow-up.\n',
  );
} catch (error) {
  await screenshot('deepseek-android-failure.png').catch(() => {});
  process.stdout.write(String(error.message).replaceAll(apiKey, '[redacted]') + '\n');
  process.exitCode = 1;
}
