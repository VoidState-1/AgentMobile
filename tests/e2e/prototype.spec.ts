import { test, expect } from '@playwright/test';

test('创建、编辑、Pi 任务、变化、撤销和刷新持久化', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '＋ 新建项目' }).click();
  await page.getByLabel('项目名称', { exact: true }).fill('旅行资料');
  await page.getByRole('button', { name: '创建工作区', exact: true }).click();
  await expect(page.getByRole('button', { name: '打开 documents/notes.md' })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: '打开 documents/notes.md' }).click();
  await page.getByLabel('正文', { exact: true }).fill('# 杭州旅行\n\n周末去西湖，带上相机。');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByText('文件已保存，历史版本已记录。')).toBeVisible();
  await page.getByRole('tab', { name: 'Agent', exact: true }).click();
  await page.getByRole('button', { name: '开始任务 ↗' }).click();
  await expect(page.getByText('已完成', { exact: true })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: '查看变化', exact: true }).click();
  await expect(page.getByText('新增 · documents/summary.md', { exact: true })).toBeVisible();
  await expect(page.getByText('# 图文资料整理', { exact: false }).last()).toContainText('杭州旅行');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '撤销修改', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByText('已恢复任务开始前的内容。')).toBeVisible();
  await page.getByRole('tab', { name: '资料', exact: true }).click();
  await expect(page.getByRole('button', { name: '打开 documents/summary.md' })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: /旅行资料/ }).click();
  await page.getByRole('button', { name: '打开 documents/notes.md' }).click();
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue('# 杭州旅行\n\n周末去西湖，带上相机。');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.screenshot({ path: 'work/prototype-desktop.png', fullPage: true });
  expect(failures).toEqual([]);
});

test('手机宽度可创建项目和执行任务', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '＋ 新建项目' }).click();
  await page.getByLabel('项目名称', { exact: true }).fill('随身笔记');
  await page.getByRole('button', { name: '创建工作区', exact: true }).click();
  await expect(page.getByRole('tab', { name: '资料', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Agent', exact: true }).click();
  await page.getByRole('button', { name: '开始任务 ↗' }).click();
  await expect(page.getByText('已完成', { exact: true })).toBeVisible({ timeout: 20000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: 'work/prototype-mobile.png', fullPage: true });
});

test('导入并预览图片，连接兼容服务完成真正的模型协议工具调用', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ 新建项目' }).click();
  await page.getByLabel('项目名称', { exact: true }).fill('模型协议验证');
  await page.getByRole('button', { name: '创建工作区', exact: true }).click();
  await expect(page.getByRole('button', { name: '导入', exact: true })).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入', exact: true }).click();
  await (await chooser).setFiles({
    name: 'sample.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nXcAAAAASUVORK5CYII=', 'base64'),
  });
  await page.getByRole('button', { name: '打开 assets/sample.png' }).click();
  await expect(page.getByText('assets/sample.png ·', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '模型设置' }).click();
  await page.getByRole('button', { name: '真实模型', exact: true }).click();
  await page.getByLabel('服务基础地址', { exact: true }).fill('https://example.test/v1');
  await page.getByLabel('模型名称', { exact: true }).fill('protocol-test');
  await page.getByLabel('API Key', { exact: true }).fill('test-only-no-real-secret');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  let rounds = 0;
  await page.route('https://example.test/v1/chat/completions', async (route) => {
    rounds++;
    const event = rounds === 1 ?
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'test-call', function: {
        name: 'write_text', arguments: JSON.stringify({ path: 'documents/remote.md', text: '兼容服务工具调用成功', expectedRevision: null }),
      } }] }, finish_reason: 'tool_calls' }] } :
      { choices: [{ delta: { content: '已通过工具创建 remote.md。' }, finish_reason: 'stop' }] };
    await route.fulfill({
      status: 200, contentType: 'text/event-stream',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: 'data: ' + JSON.stringify(event) + '\n\ndata: [DONE]\n\n',
    });
  });
  await page.getByRole('tab', { name: 'Agent', exact: true }).click();
  await page.getByRole('button', { name: '开始任务 ↗' }).click();
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
  expect(rounds).toBe(2);
  await page.getByRole('tab', { name: '资料', exact: true }).click();
  await page.getByRole('button', { name: '打开 documents/remote.md' }).click();
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue('兼容服务工具调用成功');
});
