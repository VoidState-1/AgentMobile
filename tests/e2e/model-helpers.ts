import { expect, type Page } from '@playwright/test';
import type { ModelProtocol } from '../../src/core/models/types';

export async function openModels(page: Page) {
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '模型与供应商', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加连接', exact: true })).toBeVisible();
}
export async function addConnection(
  page: Page,
  name: string,
  protocol: ModelProtocol = 'chat-completions',
  key = 'fixture-key',
) {
  const add = page.getByRole('button', { name: '添加连接', exact: true });
  if (await add.count()) await add.click();
  await page.getByRole('button', { name: '自定义服务', exact: true }).click();
  await page.getByLabel('连接名称', { exact: true }).fill(name);
  if (protocol !== 'chat-completions')
    await page
      .getByRole('button', {
        name: '通信协议：' + (protocol === 'gemini' ? 'Gemini 原生' : 'Anthropic Messages'),
        exact: true,
      })
      .click();
  await page.getByLabel('服务基础地址', { exact: true }).fill('https://example.test/v1');
  await page.getByLabel('API Key', { exact: true }).fill(key);
  await page.getByRole('button', { name: '保存连接', exact: true }).click();
  await expect(page.getByText('凭证已保存 · 留空保留现有密钥', { exact: true })).toBeVisible();
}
export async function addModel(page: Page, name: string, apiId = 'protocol-test', images = false) {
  await page.getByRole('button', { name: '手工添加', exact: true }).click();
  await page.getByLabel('请求模型 ID', { exact: true }).fill(apiId);
  await page.getByLabel('模型显示名', { exact: true }).fill(name);
  if (images) await page.getByRole('switch', { name: '允许图片输入', exact: true }).click();
  await page.getByRole('button', { name: '保存模型', exact: true }).click();
  await expect(page.getByRole('button', { name: '设为全局默认', exact: true })).toBeVisible();
}
export async function returnToWorkbench(page: Page) {
  for (
    let i = 0;
    i < 4 && (await page.getByRole('button', { name: '返回', exact: true }).count());
    i++
  ) {
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.waitForTimeout(160);
  }
  await expect(page.getByRole('tab', { name: '对话', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '对话', exact: true }).click();
}
export async function configureModel(
  page: Page,
  options: { protocol?: ModelProtocol; name?: string; key?: string; images?: boolean } = {},
) {
  await openModels(page);
  await addConnection(page, options.name ?? '模拟服务', options.protocol, options.key);
  await addModel(
    page,
    '模拟模型',
    options.protocol === 'gemini' ? 'models/protocol-test' : 'protocol-test',
    options.images,
  );
  await page.getByRole('button', { name: '设为全局默认', exact: true }).click();
  await expect(page.getByRole('button', { name: '已为全局默认', exact: true })).toBeVisible();
  await returnToWorkbench(page);
}
