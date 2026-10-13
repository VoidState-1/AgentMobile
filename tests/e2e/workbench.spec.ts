import { test, expect, type Page } from '@playwright/test';

async function createProject(page: Page, name: string) {
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByLabel('项目名称', { exact: true }).fill(name);
  await page.getByRole('button', { name: '创建工作区', exact: true }).click();
  await expect(page.getByLabel('任务目标', { exact: true })).toBeVisible();
}

async function openNote(page: Page) {
  await page.getByRole('tab', { name: '资料', exact: true }).click();
  await page.getByRole('button', { name: '打开 documents/notes.md', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
}

test('编辑、会话、逐行变化、恢复和刷新持久化', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await createProject(page, '旅行资料');
  await openNote(page);
  await page.getByLabel('正文', { exact: true }).fill('# 杭州旅行\n\n周末去西湖，带上相机。');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('所有修改已保存', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭文件', exact: true }).click();
  await page.getByRole('tab', { name: '会话', exact: true }).click();
  await page.getByRole('button', { name: '整理资料', exact: true }).click();
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查看变化', exact: true }).click();
  await expect(page.getByText('新增 · documents/summary.md', { exact: true })).toBeVisible();
  await expect(page.getByText('## 原始资料摘录', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销修改', exact: true }).click();
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  await expect(page.getByText('内容已恢复，历史记录已保留。')).toBeVisible();
  await page.getByRole('tab', { name: '资料', exact: true }).click();
  await expect(page.getByRole('button', { name: '打开 documents/summary.md' })).toHaveCount(0);
  await page.reload();
  await openNote(page);
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue('# 杭州旅行\n\n周末去西湖，带上相机。');
  await page.getByRole('button', { name: '关闭文件', exact: true }).click();
  expect(errors).toEqual([]);
});

test('未保存保护、独立编辑器和文件搜索', async ({ page }) => {
  await page.goto('/');
  await createProject(page, '工作笔记');
  await openNote(page);
  await page.getByLabel('正文', { exact: true }).fill('这份草稿需要保留。');
  await page.getByRole('button', { name: '关闭文件', exact: true }).click();
  await expect(page.getByText('有尚未保存的修改', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue('这份草稿需要保留。');
  await page.getByRole('button', { name: '关闭文件', exact: true }).click();
  await page.getByRole('button', { name: '保存后离开', exact: true }).click();
  await expect(page.getByRole('button', { name: '关闭文件', exact: true })).toHaveCount(0);
  await page.getByLabel('搜索文件', { exact: true }).fill('does-not-exist');
  await expect(page.getByText('没有找到匹配的文件', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除文件搜索' }).click();
  await page.getByRole('button', { name: '打开 documents/notes.md' }).click();
  await expect(page.getByText('这份草稿需要保留。', { exact: true })).toBeVisible();
});

test('深浅外观、项目切换和草稿保留', async ({ page }) => {
  await page.goto('/');
  await createProject(page, '项目一');
  await page.getByLabel('任务目标').fill('第一份未发送的任务');
  await createProject(page, '项目二');
  await page.getByRole('button', { name: '切换到 项目一', exact: true }).click();
  await expect(page.getByLabel('任务目标', { exact: true })).toHaveValue('第一份未发送的任务');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await expect(page.getByTestId('workbench-dark')).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload();
  await expect(page.getByTestId('workbench-dark')).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '浅色', exact: true }).click();
  await expect(page.getByTestId('workbench-light')).toBeVisible();
  await page.getByRole('button', { name: '跟随系统', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.getByTestId('workbench-dark')).toBeVisible();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.getByTestId('workbench-light')).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
});

test('360px 手机：输入区固定、全屏编辑、短视口无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await createProject(page, '随身笔记');
  await page.getByRole('button', { name: '整理资料', exact: true }).click();
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
  const composer = await page.getByTestId('composer').boundingBox();
  expect(composer!.y + composer!.height).toBeLessThanOrEqual(740);
  await page.setViewportSize({ width: 360, height: 500 });
  await expect(page.getByRole('button', { name: '发送任务', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'work/workbench-mobile-light.png' });
  await openNote(page);
  await page.getByLabel('正文', { exact: true }).fill('手机上的新内容');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('所有修改已保存')).toBeVisible();
  await page.getByRole('button', { name: '关闭文件', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('tab', { name: '会话', exact: true }).click();
  await page.screenshot({ path: 'work/workbench-mobile-dark.png' });
});

test('图片导入与真实模型协议、文件结果直达', async ({ page }) => {
  await page.goto('/');
  await createProject(page, '模型协议验证');
  await page.getByRole('tab', { name: '资料', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入', exact: true }).click();
  await (await chooser).setFiles({
    name: 'sample.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nXcAAAAASUVORK5CYII=', 'base64'),
  });
  await page.getByRole('button', { name: '打开 assets/sample.png' }).click();
  await expect(page.getByText('图片预览', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭文件', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '真实模型', exact: true }).click();
  await page.getByLabel('服务基础地址', { exact: true }).fill('https://example.test/v1');
  await page.getByLabel('模型名称', { exact: true }).fill('protocol-test');
  await page.getByLabel('API Key', { exact: true }).fill('test-only-no-real-secret');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  let rounds = 0;
  await page.route('https://example.test/v1/chat/completions', async (route) => {
    rounds++;
    const event = rounds === 1 ? { choices: [{ delta: { tool_calls: [{ index: 0, id: 'test-call', function: {
      name: 'write_text', arguments: JSON.stringify({ path: 'documents/remote.md', text: '兼容服务工具调用成功', expectedRevision: null }),
    } }] }, finish_reason: 'tool_calls' }] } :
      { choices: [{ delta: { content: '已创建 remote.md。' }, finish_reason: 'stop' }] };
    await route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'Access-Control-Allow-Origin': '*' },
      body: 'data: ' + JSON.stringify(event) + '\n\ndata: [DONE]\n\n' });
  });
  await page.getByRole('tab', { name: '会话', exact: true }).click();
  await page.getByLabel('任务目标', { exact: true }).fill('创建一份新文档');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
  expect(rounds).toBe(2);
  await page.getByRole('tab', { name: '资料', exact: true }).click();
  await page.getByRole('button', { name: '打开 documents/remote.md' }).click();
  await expect(page.getByText('兼容服务工具调用成功', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.screenshot({ path: 'work/workbench-desktop-editor-light.png' });
});

test('键盘输入、快捷保存、新建重命名与删除', async ({ page }) => {
  await page.goto('/');
  await createProject(page, '日常资料');
  const input = page.getByLabel('任务目标', { exact: true });
  await input.fill('第一行');
  await input.press('Shift+Enter');
  await input.pressSequentially('第二行');
  await expect(input).toHaveValue('第一行\n第二行');
  await input.press('Enter');
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '资料', exact: true }).click();
  await page.getByRole('button', { name: '新建文件', exact: true }).click();
  await page.getByLabel('文件名称', { exact: true }).fill('ideas.md');
  await page.getByLabel('正文', { exact: true }).fill('# 新想法\n\n需要保存的内容。');
  await page.keyboard.press('Control+s');
  await expect(page.getByText('所有修改已保存', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重命名文件', exact: true }).click();
  await page.getByLabel('文件名称', { exact: true }).fill('notes-v2.md');
  await page.getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(page.getByRole('button', { name: '打开 documents/notes-v2.md', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除文件', exact: true }).click();
  await page.getByRole('button', { name: '删除文件', exact: true }).last().click();
  await expect(page.getByRole('button', { name: '打开 documents/notes-v2.md', exact: true })).toHaveCount(0);
});
