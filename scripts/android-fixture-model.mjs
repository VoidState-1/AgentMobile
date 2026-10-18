import { adb, tap, tapScrolled, scrollTo, dump } from './android-ui.mjs';

// Requires scripts/mock-model-server.mjs; the app has no built-in test model.
export async function configureWorkspaceFixture() {
  const fill = async (label, value) => {
    await scrollTo(label, true);
    await tap(label);
    await adb('shell', 'input', 'keyevent', '123');
    await adb('shell', 'input', 'keyevent', ...Array(160).fill('67'));
    await adb('shell', 'input', 'text', value);
    if ((await adb('shell', 'dumpsys', 'input_method')).includes('mInputShown=true'))
      await adb('shell', 'input', 'keyevent', '4');
  };
  await adb('reverse', 'tcp:4181', 'tcp:4181');
  await tap('设置');
  await tap('模型与供应商');
  await tapScrolled('添加其他供应商');
  await tap('编辑连接名称');
  await fill('连接名称', 'WorkspaceFixture-' + Date.now());
  await tap('完成编辑名称');
  await fill('服务地址', 'http://127.0.0.1:4181');
  await tapScrolled('高级设置');
  await tapScrolled('认证方式：无需认证');
  await tap('保存连接');
  await tapScrolled('添加模型');
  await fill('请求 ID', 'workspace-fixture');
  await tap('编辑模型名称');
  await fill('模型显示名', 'WorkspaceFixture');
  await tap('完成编辑模型名称');
  await tap('保存模型');
  await tapScrolled('设为全局默认');
  for (let i = 0; i < 4 && (await dump()).includes('content-desc="返回"'); i++) await tap('返回');
  await tap('对话');
}
