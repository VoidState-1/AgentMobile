import { test, expect, type Page } from '@playwright/test';
import { configureModel } from './model-helpers';
import { sse, toolEvents, answerEvents } from '../protocol-fixtures';

async function openSettings(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('button', { name: 'Agent 设置', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存 Agent 设置', exact: true })).toBeVisible();
}
async function createProject(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByLabel('项目名称', { exact: true }).fill('长任务工作区'); await page.getByRole('button', { name: '创建工作区', exact: true }).click();
  await expect(page.getByLabel('任务目标', { exact: true })).toBeVisible();
}
test('手机：设置保存与刷新、错误校验、未保存保护和深浅主题', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await createProject(page); await openSettings(page);
  await expect(page.getByLabel('模型请求轮数', { exact: true })).toHaveValue('50');
  await expect(page.getByLabel('工具调用次数', { exact: true })).toHaveValue('200');
  await page.getByLabel('系统提示词', { exact: true }).fill('按照结论、依据、文件变化的顺序回答。');
  await page.getByLabel('模型请求轮数', { exact: true }).fill('80'); await page.getByLabel('任务总时长（分钟）', { exact: true }).fill('1');
  await page.getByRole('button', { name: '保存 Agent 设置', exact: true }).click(); await expect(page.getByText('单次请求超时不能超过任务总时长。', { exact: true })).toBeVisible();
  await page.getByLabel('任务总时长（分钟）', { exact: true }).fill('30');
  await page.getByRole('button', { name: '保存 Agent 设置', exact: true }).click(); await expect(page.getByText('Agent 设置已保存，下次任务生效。', { exact: true })).toBeVisible();
  await page.getByLabel('系统提示词', { exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: 'work/agent-settings-mobile-light.png' });
  await page.reload(); await expect(page.getByLabel('系统提示词', { exact: true })).toHaveValue('按照结论、依据、文件变化的顺序回答。');
  await expect(page.getByLabel('模型请求轮数', { exact: true })).toHaveValue('80');
  await page.getByLabel('系统提示词', { exact: true }).fill('尚未保存的系统提示词'); await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page.getByText('有尚未保存的配置', { exact: true })).toBeVisible(); await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page.getByLabel('系统提示词', { exact: true })).toHaveValue('尚未保存的系统提示词');
  await page.getByRole('button', { name: '返回', exact: true }).click(); await page.getByRole('button', { name: '放弃修改并离开', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByRole('button', { name: 'Agent 设置', exact: true }).click(); await expect(page.getByTestId('config-dark')).toBeVisible();
  await page.screenshot({ path: 'work/agent-settings-mobile-dark.png' });
  await page.setViewportSize({ width: 360, height: 500 }); expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await expect(page.getByRole('button', { name: '保存 Agent 设置', exact: true })).toBeVisible();
});

test('运行中修改 Agent 设置，旧任务跨轮保持原提示词和预算，后续任务采用新设置', async ({ page }) => {
  await createProject(page); await configureModel(page); await openSettings(page);
  await page.getByLabel('系统提示词', { exact: true }).fill('INITIAL_SYSTEM_STYLE');
  await page.getByRole('button', { name: '保存 Agent 设置', exact: true }).click();
  await expect(page.getByText('Agent 设置已保存，下次任务生效。', { exact: true })).toBeVisible(); await page.getByRole('button', { name: '返回', exact: true }).click();
  let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; }); const bodies: any[] = [];
  await page.route('https://example.test/v1/chat/completions', async (route) => {
    bodies.push(route.request().postDataJSON()); if (bodies.length === 1) await held;
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(bodies.length === 1 ? toolEvents('chat-completions', 'list_files') : answerEvents('chat-completions', '本次处理完成。')) });
  });
  await page.getByLabel('任务目标', { exact: true }).fill('长'.repeat(5000)); await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect.poll(() => bodies.length).toBe(1); await openSettings(page);
  await page.getByLabel('系统提示词', { exact: true }).fill('UPDATED_SYSTEM_STYLE'); await page.getByLabel('模型请求轮数', { exact: true }).fill('80');
  await page.getByRole('button', { name: '保存 Agent 设置', exact: true }).click();
  await expect(page.getByText('Agent 设置已保存，下次任务生效。', { exact: true })).toBeVisible(); await page.getByRole('button', { name: '返回', exact: true }).click();
  release(); await expect(page.getByText('已完成', { exact: true })).toHaveCount(1);
  expect(bodies).toHaveLength(2); for (const body of bodies) { expect(body.messages[0].content).toContain('INITIAL_SYSTEM_STYLE'); expect(body.messages[0].content).not.toContain('UPDATED_SYSTEM_STYLE'); }
  expect(bodies[0].max_tokens).toBe(8192);
  await page.getByLabel('任务目标', { exact: true }).fill('下一项任务'); await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect(page.getByText('已完成', { exact: true })).toHaveCount(2); expect(bodies[2].messages[0].content).toContain('UPDATED_SYSTEM_STYLE');
  const tasks = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open('agent-mobile-prototype', 1); request.onsuccess = () => resolve(request.result); });
    const value = await new Promise<any[]>((resolve) => { const tx = db.transaction('records', 'readonly'); const keys = tx.objectStore('records').getAllKeys(); const values = tx.objectStore('records').getAll(); tx.oncomplete = () => resolve(values.result.filter((_, index) => String(keys.result[index]).startsWith('tasks/'))); });
    db.close(); return value;
  });
  expect(tasks.find((task) => task.prompt.length === 5000).agentSettingsSnapshot).toMatchObject({ systemPrompt: 'INITIAL_SYSTEM_STYLE', limits: { maxModelRounds: 50 } });
  expect(tasks.find((task) => task.prompt === '下一项任务').agentSettingsSnapshot).toMatchObject({ systemPrompt: 'UPDATED_SYSTEM_STYLE', limits: { maxModelRounds: 80 } });
});

test('超过旧 5 MB 上限的图片可以导入，并在刷新后保留', async ({ page }) => {
  await createProject(page); await page.getByRole('tab', { name: '资料', exact: true }).click();
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '导入', exact: true }).click();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nXcAAAAASUVORK5CYII=', 'base64');
  await (await chooser).setFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.concat([png, Buffer.alloc(6 * 1024 * 1024 - png.length)]) });
  await expect(page.getByRole('button', { name: '打开 assets/large.png', exact: true })).toBeVisible();
  await page.reload(); await page.getByRole('tab', { name: '资料', exact: true }).click();
  await expect(page.getByRole('button', { name: '打开 assets/large.png', exact: true })).toBeVisible();
});
