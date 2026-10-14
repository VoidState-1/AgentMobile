import { test, expect, type Page } from '@playwright/test';

async function create(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByLabel('项目名称', { exact: true }).fill('Git 工作流'); await page.getByRole('button', { name: '创建工作区', exact: true }).click();
  await expect(page.getByLabel('任务目标', { exact: true })).toBeVisible();
}
async function edit(page: Page, text: string) {
  await page.getByRole('tab', { name: '资料', exact: true }).click(); await page.getByRole('button', { name: '打开 documents/notes.md', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click(); await page.getByLabel('正文', { exact: true }).fill(text);
  await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.getByText('所有修改已保存', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭文件', exact: true }).click(); await page.getByRole('tab', { name: '版本', exact: true }).click();
}

test('保存、暂存后再编辑、刷新、提交与逐行差异遵循真实 Git 行为', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await create(page); await edit(page, '# 第一版\n\n已暂存的内容。');
  await expect(page.getByRole('button', { name: '提交历史 · 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '暂存 documents/notes.md', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消暂存 documents/notes.md', exact: true })).toBeVisible();
  await edit(page, '# 第二版\n\n暂存之后继续编辑。');
  await expect(page.getByRole('button', { name: '暂存 documents/notes.md', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '取消暂存 documents/notes.md', exact: true })).toBeVisible();
  await page.reload(); await page.getByRole('tab', { name: '版本', exact: true }).click();
  await page.getByRole('button', { name: '查看未暂存差异 documents/notes.md', exact: true }).click();
  await expect(page.getByText('# 第一版', { exact: true })).toBeVisible(); await expect(page.getByText('# 第二版', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByLabel('提交说明', { exact: true }).fill('整理第一版笔记'); await page.getByRole('button', { name: '提交已暂存', exact: true }).click();
  await expect(page.getByRole('button', { name: '提交历史 · 2', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '取消暂存 documents/notes.md', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '查看未暂存差异 documents/notes.md', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '提交历史 · 2', exact: true }).click(); await page.getByRole('button', { name: /^查看版本 / }).first().click();
  await expect(page.getByText('# 第一版', { exact: true })).toBeVisible(); await expect(page.getByText('# 第二版', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '关闭', exact: true }).click(); await page.getByRole('button', { name: '更改 · 1', exact: true }).click();
  await page.getByRole('button', { name: '丢弃更改 documents/notes.md', exact: true }).click(); await page.getByRole('button', { name: '丢弃更改', exact: true }).click();
  await expect(page.getByRole('button', { name: '更改', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '资料', exact: true }).click(); await page.getByRole('button', { name: '打开 documents/notes.md', exact: true }).click();
  await expect(page.getByText('已暂存的内容。', { exact: true })).toBeVisible(); expect(errors).toEqual([]);
});

test('取消暂存不丢文件，历史恢复只改变工作区且阻止覆盖脏文件', async ({ page }) => {
  await create(page); await edit(page, '明确提交的笔记。');
  await page.getByRole('button', { name: '全部暂存', exact: true }).click(); await page.getByRole('button', { name: '全部取消暂存', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看未暂存差异 documents/notes.md', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '全部暂存', exact: true }).click(); await page.getByLabel('提交说明', { exact: true }).fill('明确提交');
  await page.getByRole('button', { name: '提交已暂存', exact: true }).click(); await expect(page.getByRole('button', { name: '提交历史 · 2', exact: true })).toBeVisible();
  await edit(page, '尚未提交的个人编辑。'); await page.getByRole('button', { name: '提交历史 · 2', exact: true }).click();
  await page.getByRole('button', { name: /^查看版本 / }).last().click(); await page.getByRole('button', { name: '恢复此版本', exact: true }).click();
  await page.getByRole('button', { name: '确认恢复', exact: true }).click(); await expect(page.getByText('工作区有未提交更改，请先提交或丢弃后再恢复版本').first()).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click(); await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '更改 · 1', exact: true }).click(); await page.getByRole('button', { name: '丢弃更改 documents/notes.md', exact: true }).click();
  await page.getByRole('button', { name: '丢弃更改', exact: true }).click(); await page.getByRole('button', { name: '提交历史 · 2', exact: true }).click();
  await page.getByRole('button', { name: /^查看版本 / }).last().click(); await page.getByRole('button', { name: '恢复此版本', exact: true }).click();
  await page.getByRole('button', { name: '确认恢复', exact: true }).click(); await expect(page.getByText('内容已恢复，历史记录已保留。')).toBeVisible();
  await expect(page.getByRole('button', { name: '提交历史 · 2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '更改 · 1', exact: true }).click(); await expect(page.getByRole('button', { name: '查看未暂存差异 documents/notes.md', exact: true })).toBeVisible();
});

test('手机 Git 面板支持深浅主题、短视口、提交输入与未跟踪文件丢弃', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await create(page);
  await page.getByRole('tab', { name: '资料', exact: true }).click(); await page.getByRole('button', { name: '新建文件', exact: true }).click();
  await page.getByLabel('文件名称', { exact: true }).fill('draft.md'); await page.getByLabel('正文', { exact: true }).fill('手机资料。');
  await page.getByRole('button', { name: '保存', exact: true }).click(); await page.getByRole('button', { name: '关闭文件', exact: true }).click();
  await page.getByRole('tab', { name: '版本', exact: true }).click(); await page.getByRole('button', { name: '暂存 documents/draft.md', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消暂存 documents/draft.md', exact: true })).toBeVisible();
  await page.getByLabel('提交说明', { exact: true }).fill('手机新增资料'); await page.screenshot({ path: 'work/git-mobile-light.png' });
  await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('button', { name: '深色', exact: true }).click(); await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.screenshot({ path: 'work/git-mobile-dark.png' }); await page.setViewportSize({ width: 360, height: 500 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.getByRole('button', { name: '取消暂存 documents/draft.md', exact: true }).click();
  await page.getByRole('button', { name: '丢弃更改 documents/draft.md', exact: true }).click(); await page.getByRole('button', { name: '丢弃更改', exact: true }).click();
  await expect(page.getByRole('button', { name: '更改', exact: true })).toBeVisible(); await page.reload();
  await page.getByRole('tab', { name: '资料', exact: true }).click(); await expect(page.getByRole('button', { name: '打开 documents/draft.md', exact: true })).toHaveCount(0);
});
