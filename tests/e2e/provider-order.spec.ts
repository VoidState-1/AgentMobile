import { expect, test, type Locator, type Page } from '@playwright/test';
import { addConnection, addModel, openModels } from './model-helpers';

const preset = (page: Page, name: string) =>
  page.getByRole('button', { name: name + ' · 未保存连接', exact: true });

async function dragRow(page: Page, source: Locator, target: Locator) {
  const a = await source.boundingBox();
  await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  const b = await target.boundingBox();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height * 0.8, { steps: 20 });
  await page.mouse.up();
}

async function order(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('agent-mobile-prototype');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const config = await new Promise<any>((resolve, reject) => {
        const request = db
          .transaction('records')
          .objectStore('records')
          .get('model-config/configuration');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return config.providerOrder;
    } finally {
      db.close();
    }
  });
}

test('手机长按拖拽供应商后仍在列表，顺序持久化，筛选排序保留隐藏节点的位置', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await openModels(page);
  const original = await order(page);
  await preset(page, 'OpenAI').click({ delay: 650 });
  await expect(page.getByLabel('搜索供应商', { exact: true })).toBeVisible();
  await dragRow(page, preset(page, 'OpenAI'), preset(page, 'DeepSeek'));
  await expect.poll(() => order(page)).toEqual([original[1], original[0], ...original.slice(2)]);
  await expect(page.getByLabel('搜索供应商', { exact: true })).toBeVisible();
  await page.reload();
  expect((await preset(page, 'DeepSeek').boundingBox())!.y).toBeLessThan(
    (await preset(page, 'OpenAI').boundingBox())!.y,
  );
  await page.getByLabel('搜索供应商', { exact: true }).fill('ai');
  await dragRow(page, preset(page, 'OpenAI'), preset(page, 'xAI'));
  const filtered = [original[1], 'preset:xai', ...original.slice(2, -1), 'preset:openai'];
  await expect.poll(() => order(page)).toEqual(filtered);
  await expect(page.getByRole('button', { name: '添加其他供应商', exact: true })).toBeVisible();
  await page.getByLabel('搜索供应商', { exact: true }).fill('');
  await page.reload();
  expect(await order(page)).toEqual(filtered);
  await expect(preset(page, 'OpenAI')).toBeVisible();
  await page.screenshot({ path: 'work/mobile-ui/providers-reordered.png' });
  expect(errors).toEqual([]);
});

test('已保存连接只显示右侧模型数，刷新丢失凭证后显示为未保存并可补填', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await openModels(page);
  await addConnection(page, '状态验证');
  await addModel(page, '一个模型');
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByLabel('搜索供应商', { exact: true }).fill('状态验证');
  const row = page.getByRole('button', { name: '打开连接 状态验证', exact: true });
  await expect(row).toHaveText('状态验证1 个模型');
  const count = await row.getByText('1 个模型', { exact: true }).boundingBox();
  const dot = await row.getByTestId('connection-status').boundingBox();
  expect(count!.x + count!.width).toBeLessThan(dot!.x);
  expect(dot!.x).toBeGreaterThan(300);
  await page.screenshot({ path: 'work/mobile-ui/provider-model-count.png' });
  await page.reload();
  await page.getByLabel('搜索供应商', { exact: true }).fill('状态验证');
  await expect(row).toHaveText('状态验证');
  await row.click();
  await expect(page.getByRole('heading', { name: '状态验证', exact: true })).toBeVisible();
  await page.getByLabel('API Key', { exact: true }).fill('replacement-test-key');
  await page.getByRole('button', { name: '保存连接', exact: true }).click();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(row).toContainText('1 个模型');
});

test('多连接供应商汇总模型数量，展开后长按排序会收起子项，无需认证的连接刷新仍为已保存', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await openModels(page);
  await preset(page, 'OpenAI').click();
  await page.getByRole('button', { name: '高级设置', exact: true }).click();
  await page.getByRole('button', { name: '认证方式：无需认证', exact: true }).click();
  await page.getByRole('button', { name: '保存连接', exact: true }).click();
  await addModel(page, '模板模型');
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('button', { name: '复制连接', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'OpenAI 副本', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  const group = page.getByRole('button', { name: 'OpenAI · 2 个连接', exact: true });
  await expect(group).toHaveText('OpenAI2 个模型');
  await group.click();
  await expect(
    page.getByRole('button', { name: '打开连接 OpenAI 副本', exact: true }),
  ).toContainText('1 个模型');
  await dragRow(page, group, preset(page, 'DeepSeek'));
  await expect
    .poll(async () => (await order(page)).slice(0, 2))
    .toEqual(['preset:deepseek', 'preset:openai']);
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(group).toHaveText('OpenAI2 个模型');
});
