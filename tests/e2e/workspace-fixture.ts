import { expect, type Page } from '@playwright/test';
import { workspaceChatEvent } from '../workspace-replies';
import { addModel, openModels, returnToWorkbench } from './model-helpers';

const configured = new WeakSet<Page>();

export async function configureWorkspaceFixture(page: Page) {
  if (configured.has(page)) return;
  await page.route('https://workspace-fixture.test/v1/chat/completions', async route => {
    const { messages } = route.request().postDataJSON();
    await route.fulfill({
      contentType: 'text/event-stream',
      body: 'data: ' + JSON.stringify(workspaceChatEvent(messages)) + '\n\ndata: [DONE]\n\n',
    });
  });
  await openModels(page);
  await page.getByRole('button', { name: '添加其他供应商', exact: true }).click();
  await page.getByLabel('连接名称', { exact: true }).fill('工作区测试服务');
  await page.getByLabel('服务基础地址', { exact: true }).fill('https://workspace-fixture.test/v1');
  await page.getByRole('button', { name: '认证方式：无需认证', exact: true }).click();
  await page.getByRole('button', { name: '保存连接', exact: true }).click();
  await addModel(page, '工作区测试模型', 'workspace-fixture');
  await page.getByRole('button', { name: '设为全局默认', exact: true }).click();
  await expect(page.getByRole('button', { name: '已为全局默认', exact: true })).toBeVisible();
  await returnToWorkbench(page);
  configured.add(page);
}
