import { expect, test, type Page } from '@playwright/test';
import { mcpFixture, fixtureTools } from '../mcp-fixtures';
import { configureModel, returnToWorkbench } from './model-helpers';
import { answerEvents, toolEvents, sse } from '../protocol-fixtures';

async function project(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByLabel('项目名称', { exact: true }).fill('远程资料项目');
  await page.getByRole('button', { name: '创建工作区', exact: true }).click();
  await expect(page.getByLabel('任务目标', { exact: true })).toBeVisible();
}
async function openMcp(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '远程 MCP', exact: true }).click();
}
async function addMcp(page: Page) {
  await openMcp(page);
  await page.getByRole('button', { name: '添加连接', exact: true }).click();
  await page.getByLabel('MCP 连接名称', { exact: true }).fill('资料搜索');
  await page.getByLabel('MCP 端点', { exact: true }).fill('https://mcp.example.test/mcp');
  await page.getByLabel('MCP Token', { exact: true }).fill('fixture-mcp-token');
  await page.getByRole('button', { name: '保存 MCP 连接', exact: true }).click();
  await expect(page.getByText('Token 已保存 · 留空保留现有凭证', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '检测并发现工具', exact: true }).click();
  await expect(
    page.getByRole('switch', { name: '允许自动调用 lookup', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('switch', { name: '允许自动调用 lookup', exact: true }),
  ).not.toBeChecked();
  await page.getByRole('switch', { name: '允许自动调用 lookup', exact: true }).click();
  await expect(
    page.getByRole('switch', { name: '允许自动调用 lookup', exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole('switch', { name: '允许自动调用 side_effect', exact: true }),
  ).not.toBeChecked();
}
for (const modern of [false, true])
  test(`MCP ${modern ? '2026' : '2025'} 配置、项目授权、真实 Agent 与刷新`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const fixture = mcpFixture({ modern, sse: true, paginated: true, token: 'fixture-mcp-token' });
    await page.route('https://mcp.example.test/**', async route => {
      const request = route.request();
      const response = await fixture.handle(request.url(), {
        method: request.method(),
        headers: request.headers(),
        body: request.postData(),
      });
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      });
    });
    const modelRequests: any[] = [];
    await page.route('https://example.test/v1/chat/completions', async route => {
      const body = route.request().postDataJSON();
      modelRequests.push(body);
      const count = body.messages.filter((message: any) => message.role === 'tool').length;
      const events =
        count === 0
          ? toolEvents('chat-completions', 'mcp_0_0', { query: 'notes' })
          : count === 1
            ? toolEvents('chat-completions', 'write_text', {
                path: 'documents/mcp.md',
                text: '远程资料：MCP 查询成功。',
                expectedRevision: null,
              })
            : answerEvents('chat-completions', '已保存远程资料。');
      await route.fulfill({ contentType: 'text/event-stream', body: sse(events) });
    });
    await project(page);
    await configureModel(page);
    await addMcp(page);
    if (modern) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: 'work/mcp-mobile-light.png', fullPage: true });
      await returnToWorkbench(page);
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('button', { name: '深色', exact: true }).click();
      await page.getByRole('button', { name: '远程 MCP', exact: true }).click();
      await page.getByRole('button', { name: '配置 MCP 资料搜索', exact: true }).click();
      await expect(page.getByTestId('config-dark').last()).toBeVisible();
      await page.screenshot({ path: 'work/mcp-mobile-dark.png', fullPage: true });
    }
    await returnToWorkbench(page);
    await page.getByLabel('任务目标', { exact: true }).fill('搜索并保存远程资料');
    await page.getByRole('button', { name: '发送任务', exact: true }).click();
    await expect(page.getByText('已保存远程资料。', { exact: true })).toBeVisible();
    await page
      .getByRole('button', { name: '查看工具详情 MCP · 资料搜索 · 资料查询 notes', exact: true })
      .click();
    await expect(page.getByText(/远程资料：MCP 查询成功/).first()).toBeVisible();
    expect(fixture.calls).toBe(1);
    expect(
      modelRequests[0].tools.filter((tool: any) => tool.function.name.startsWith('mcp_')),
    ).toHaveLength(1);
    expect(JSON.stringify(modelRequests)).not.toContain('fixture-mcp-token');
    await page.getByRole('tab', { name: '资料', exact: true }).click();
    await page.getByRole('button', { name: '打开 documents/mcp.md', exact: true }).click();
    await expect(page.getByText('远程资料：MCP 查询成功。', { exact: true }).last()).toBeVisible();
    await page.reload();
    await openMcp(page);
    await page.getByRole('button', { name: '配置 MCP 资料搜索', exact: true }).click();
    await expect(
      page.getByText('Token 缺失 · 可先保存连接，稍后补填', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('switch', { name: '允许自动调用 lookup', exact: true }),
    ).toBeChecked();
    expect(errors).toEqual([]);
  });
test('MCP 未保存保护、定义变化撤销授权、校验与停用', async ({ page }) => {
  const fixture = mcpFixture();
  await page.route('https://mcp.example.test/**', async route => {
    const request = route.request();
    const response = await fixture.handle(request.url(), {
      method: request.method(),
      body: request.postData(),
      headers: request.headers(),
    });
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    });
  });
  await project(page);
  await addMcp(page);
  await page.getByLabel('MCP 连接名称', { exact: true }).fill('未保存');
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page.getByText('有尚未保存的配置', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await page.getByLabel('MCP 连接名称', { exact: true }).fill('资料搜索');
  fixture.setTools([{ ...fixtureTools[0], description: 'changed permissions' }, fixtureTools[1]]);
  await page.getByRole('button', { name: '检测并发现工具', exact: true }).click();
  await expect(
    page.getByRole('switch', { name: '允许自动调用 lookup', exact: true }),
  ).not.toBeChecked();
  await page.getByLabel('MCP 端点', { exact: true }).fill('http://remote.test/mcp');
  await page.getByRole('button', { name: '保存 MCP 连接', exact: true }).click();
  await expect(
    page.getByText('MCP 地址需要 HTTPS；本机开发地址可使用 HTTP。', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('MCP 端点', { exact: true }).fill('https://mcp.example.test/mcp');
  await page.getByRole('switch', { name: '启用 MCP 连接', exact: true }).click();
  await page.getByRole('button', { name: '保存 MCP 连接', exact: true }).click();
  await expect(page.getByText('MCP 连接已保存。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page.getByText('已停用', { exact: true })).toBeVisible();
});
test('MCP 未知结果阻止重复发送，删除连接后仍能核对记录', async ({ page }) => {
  const fixture = mcpFixture();
  fixture.setStatus(500);
  await page.route('https://mcp.example.test/**', async route => {
    const request = route.request();
    const response = await fixture.handle(request.url(), {
      method: request.method(),
      body: request.postData(),
      headers: request.headers(),
    });
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    });
  });
  await page.route('https://example.test/v1/chat/completions', async route => {
    const body = route.request().postDataJSON();
    const count = body.messages.filter((message: any) => message.role === 'tool').length;
    await route.fulfill({
      contentType: 'text/event-stream',
      body: sse(
        count
          ? answerEvents('chat-completions', '请先核对远端执行状态。')
          : toolEvents('chat-completions', 'mcp_0_0', { query: 'same' }),
      ),
    });
  });
  await project(page);
  await configureModel(page);
  await addMcp(page);
  await returnToWorkbench(page);
  for (const prompt of ['查询资料', '再次查询']) {
    await page.getByLabel('任务目标', { exact: true }).fill(prompt);
    await page.getByRole('button', { name: '发送任务', exact: true }).click();
    await expect(page.getByText('请先核对远端执行状态。', { exact: true }).last()).toBeVisible();
  }
  expect(fixture.calls).toBe(1);
  await expect(
    page.getByText('MCP · 资料搜索 · 资料查询 · 远端结果未知', { exact: true }).last(),
  ).toBeVisible();
  await openMcp(page);
  await page.getByRole('button', { name: '配置 MCP 资料搜索', exact: true }).click();
  await page.getByRole('button', { name: '删除 MCP 连接', exact: true }).click();
  await page.getByRole('button', { name: '确认删除 MCP 连接', exact: true }).click();
  await page.getByRole('button', { name: '核对调用 lookup', exact: true }).click();
  await expect(page.getByText('解除重试限制', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '已核对，允许再次调用', exact: true }).click();
  await expect(page.getByRole('button', { name: '核对调用 lookup', exact: true })).toHaveCount(0);
  expect(fixture.calls).toBe(1);
});
