import { expect, test, type Page } from '@playwright/test';
import { addConnection, openModels } from './model-helpers';

const iconImage = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAbklEQVR4nO3PwQkAUQhDQftv2q3hH9wQGHhnzczOnHZ7/YfyCwDKyy8AKC+/AKC8/AKA8vILAMrLLwAoL78AoLz8AoDy8gsAyssvACjv/sHxh905DQAAAAAAAAAAAAAAAAAAAAAAAAAAAABgXgEf+wXtHgs59/wAAAAASUVORK5CYII=',
  'base64',
);

const editorIcon = (page: Page, name: string) =>
  page
    .getByRole('button', { name: '上传供应商图标', exact: true })
    .getByRole('img', { name, exact: true });

async function uploadIcon(page: Page, name: string, buffer: Buffer) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '上传供应商图标', exact: true }).click();
  await (await chooser).setFiles({ name, mimeType: 'image/png', buffer });
}

test('模板可搜索并自动识别品牌，第三方显示默认图标，末尾添加入口仍可用', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await openModels(page);
  const openai = page.getByRole('button', { name: 'OpenAI · 未保存连接', exact: true });
  await expect(openai.getByLabel('供应商品牌图标', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'work/mobile-ui/providers-icons-light.png' });
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByRole('button', { name: '模型与供应商', exact: true }).click();
  await expect(openai.getByLabel('供应商品牌图标', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'work/mobile-ui/providers-icons-dark.png' });
  await page.getByLabel('搜索供应商', { exact: true }).fill('qwen');
  await page.getByRole('button', { name: '通义千问 Qwen · 未保存连接', exact: true }).click();
  await expect(page.getByLabel('服务地址', { exact: true })).toHaveValue(
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
  );
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByLabel('搜索供应商', { exact: true }).fill('not-a-provider');
  await expect(page.getByText('没有匹配的供应商', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '添加其他供应商', exact: true }).click();
  await expect(editorIcon(page, '默认供应商图标')).toBeVisible();
  await page.screenshot({ path: 'work/mobile-ui/provider-icon-default.png' });
  await page.getByLabel('服务地址', { exact: true }).fill('https://api.openai.com/v1');
  await expect(editorIcon(page, '供应商品牌图标')).toBeVisible();
  expect(errors).toEqual([]);
});

test('上传图标后保存和刷新保留，拒绝无效文件，恢复默认后可再次保存', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await openModels(page);
  await addConnection(page, '自定义图标');
  await uploadIcon(page, 'brand.png', iconImage);
  await expect(editorIcon(page, '自定义供应商图标')).toBeVisible();
  await page.screenshot({ path: 'work/mobile-ui/provider-icon-custom.png' });
  await page.getByRole('button', { name: '保存连接', exact: true }).click();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  const row = page.getByRole('button', { name: '打开连接 自定义图标', exact: true });
  await expect(row.getByLabel('自定义供应商图标', { exact: true })).toBeVisible();
  await page.reload();
  await expect(row.getByLabel('自定义供应商图标', { exact: true })).toBeVisible();
  await row.click();
  await uploadIcon(page, 'invalid.png', Buffer.from('invalid image'));
  await expect(page.getByRole('alert')).toContainText('图片不是有效的');
  await expect(editorIcon(page, '自定义供应商图标')).toBeVisible();
  await uploadIcon(page, 'large.png', Buffer.alloc(256 * 1024 + 1));
  await expect(page.getByRole('alert')).toContainText('256 KB');
  await expect(editorIcon(page, '自定义供应商图标')).toBeVisible();
  await page.screenshot({ path: 'work/mobile-ui/provider-icon-upload.png' });
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('button', { name: '恢复默认供应商图标', exact: true }).click();
  await expect(editorIcon(page, '默认供应商图标')).toBeVisible();
  await page.getByRole('button', { name: '保存连接', exact: true }).click();
  await page.reload();
  await expect(editorIcon(page, '默认供应商图标')).toBeVisible();
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await expect(page.getByRole('button', { name: '恢复默认供应商图标', exact: true })).toHaveCount(
    0,
  );
});
