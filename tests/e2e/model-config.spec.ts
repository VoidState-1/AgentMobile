import { editorFrame } from './editor-helpers';
import { openProjectTree } from './workbench-helpers';
import { test, expect, type Page } from '@playwright/test';
import { protocols, toolEvents, answerEvents, sse } from '../protocol-fixtures';
import {
  addConnection,
  addModel,
  configureModel,
  openModels,
  returnToWorkbench,
  setConnectionName,
} from './model-helpers';

async function createProject(page: Page) {
  await page.goto('/');
  await openProjectTree(page);
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByLabel('项目名称', { exact: true }).fill('配置器验证');
  await page.getByRole('button', { name: '创建工作区', exact: true }).click();
  await expect(page.getByLabel('任务目标', { exact: true })).toBeVisible();
}
for (const protocol of protocols)
  test(protocol + '：目录、文本、工具、图片与文件写入', async ({ page }) => {
    await createProject(page);
    await configureModel(page, { protocol, images: true });
    let calls = 0;
    await page.route('https://example.test/**', async route => {
      const request = route.request();
      const raw = request.postData() ?? '';
      let events: unknown[];
      if (request.method() === 'GET') {
        await route.fulfill({
          json:
            protocol === 'gemini'
              ? {
                  models: [
                    {
                      name: 'models/protocol-test',
                      displayName: '模型',
                      supportedGenerationMethods: ['generateContent'],
                    },
                  ],
                }
              : { data: [{ id: 'protocol-test', display_name: '模型' }], has_more: false },
        });
        return;
      }
      calls++;
      if (raw.includes('MOBILE_OK')) events = answerEvents(protocol, 'MOBILE_OK');
      else if (raw.includes('四个色块'))
        events = answerEvents(protocol, 'red, green, blue, yellow');
      else if (raw.includes('diagnostic_echo')) {
        const marker = raw.match(/host_[a-z0-9]+/)?.[0];
        events = marker ? answerEvents(protocol, marker) : toolEvents(protocol, 'diagnostic_echo');
      } else
        events = raw.includes('native-e2e.md')
          ? answerEvents(protocol, '已保存文档。')
          : toolEvents(protocol, 'write_text', {
              path: 'documents/native-e2e.md',
              text: '三协议浏览器工具闭环',
              expectedRevision: null,
            });
      await route.fulfill({ contentType: 'text/event-stream', body: sse(events) });
    });
    await openModels(page);
    await page.getByRole('button', { name: '打开连接 模拟服务', exact: true }).click();
    await page.getByRole('button', { name: '检测连接并发现模型', exact: true }).click();
    await expect(page.getByText(/发现 1 个模型/)).toBeVisible();
    await page.getByRole('button', { name: '编辑模型 模拟模型', exact: true }).click();
    for (const label of ['文本检测', '工具检测', '图片检测']) {
      await page.getByRole('button', { name: label + ' · 可能计费', exact: true }).click();
      await expect(
        page.getByText(
          label === '文本检测'
            ? '指定模型的完整文本生成通过。'
            : label === '工具检测'
              ? '工具调用 → 宿主返回 → 模型继续回答已通过。'
              : '模型正确识别了内置图片的四个色块。',
          { exact: true },
        ),
      ).toBeVisible();
    }
    await page.getByLabel('最大输出 tokens', { exact: true }).fill('512');
    await page.getByRole('button', { name: '保存模型', exact: true }).click();
    await expect(page.getByText('模型配置已保存。', { exact: true })).toBeVisible();
    await returnToWorkbench(page);
    await page.getByLabel('任务目标', { exact: true }).fill('创建一份文档');
    await page.getByRole('button', { name: '发送任务', exact: true }).click();
    await expect(page.getByText('已完成', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: '文件', exact: true }).click();
    await page.getByRole('button', { name: '打开 documents/native-e2e.md', exact: true }).click();
    await expect(
      editorFrame(page).getByText('三协议浏览器工具闭环', { exact: true }),
    ).toBeVisible();
    expect(calls).toBe(6);
  });

test('运行中改参数和密钥、浏览配置，后续轮次保留旧配置', async ({ page }) => {
  await createProject(page);
  await configureModel(page, { key: 'fixture-old-key' });
  const requests: { headers: Record<string, string>; body: any }[] = [];
  let release: (() => void) | undefined;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route('https://example.test/v1/chat/completions', async route => {
    requests.push({ headers: route.request().headers(), body: route.request().postDataJSON() });
    if (requests.length === 1) await held;
    await route.fulfill({
      contentType: 'text/event-stream',
      body: sse(
        requests.length === 1
          ? toolEvents('chat-completions', 'list_files')
          : answerEvents('chat-completions', '查看完成。'),
      ),
    });
  });
  await page.getByLabel('任务目标', { exact: true }).fill('查看当前项目');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  await openModels(page);
  await page.getByRole('button', { name: '打开连接 模拟服务', exact: true }).click();
  await page.getByLabel('API Key', { exact: true }).fill('fixture-new-key');
  await page.getByRole('button', { name: '保存连接', exact: true }).click();
  await expect(page.getByText('连接已保存。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑模型 模拟模型', exact: true }).click();
  await page.getByLabel('最大输出 tokens', { exact: true }).fill('1024');
  await page.getByRole('button', { name: '保存模型', exact: true }).click();
  await expect(page.getByText('模型配置已保存。', { exact: true })).toBeVisible();
  release!();
  await returnToWorkbench(page);
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  for (const request of requests) {
    expect(request.headers.authorization).toBe('Bearer fixture-old-key');
    expect(request.body.max_tokens).toBe(8192);
  }
  await page.getByLabel('任务目标', { exact: true }).fill('下一条消息');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2].headers.authorization).toBe('Bearer fixture-new-key');
  expect(requests[2].body.max_tokens).toBe(1024);
});

test('两份连接不串密钥，收藏搜索、复制、未保存保护与刷新缺失凭证', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createProject(page);
  await configureModel(page, { name: '个人连接', key: 'fixture-A' });
  await openModels(page);
  await addConnection(page, '工作连接', 'chat-completions', 'fixture-B');
  await addModel(page, '工作模型');
  await page.getByRole('button', { name: '收藏模型', exact: true }).click();
  await page.getByRole('button', { name: '保存模型', exact: true }).click();
  await returnToWorkbench(page);
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await page.getByRole('tab', { name: '模型筛选：收藏', exact: true }).click();
  await page.getByRole('button', { name: '选择模型 工作连接 · 工作模型', exact: true }).click();
  const keys: string[] = [];
  await page.route('https://example.test/**', async route => {
    keys.push(route.request().headers().authorization);
    await route.fulfill({
      contentType: 'text/event-stream',
      body: sse(answerEvents('chat-completions', '连接验证完成。')),
    });
  });
  await page.getByLabel('任务目标', { exact: true }).fill('测试工作连接');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await page.getByRole('button', { name: '选择模型 个人连接 · 模拟模型', exact: true }).click();
  await page.getByLabel('任务目标', { exact: true }).fill('测试个人连接');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys).toEqual(['Bearer fixture-B', 'Bearer fixture-A']);
  await openModels(page);
  await page.screenshot({ path: 'work/config-mobile-light.png' });
  await page.getByRole('button', { name: '打开连接 工作连接', exact: true }).click();
  await setConnectionName(page, '未保存名称');
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page.getByRole('heading', { name: '未保存名称', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改并离开', exact: true }).click();
  await page.getByRole('button', { name: '打开连接 工作连接', exact: true }).click();
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('button', { name: '复制连接', exact: true }).click();
  await expect(page.getByText('已复制连接，凭证需要重新填写。', { exact: true })).toBeVisible();
  await returnToWorkbench(page);
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByRole('button', { name: '模型与供应商', exact: true }).click();
  await expect(page.getByTestId('config-dark')).toBeVisible();
  await page.screenshot({ path: 'work/config-mobile-dark.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await returnToWorkbench(page);
  await page.reload();
  await page.getByLabel('任务目标', { exact: true }).fill('保留这条草稿');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect(page.getByText(/此连接需要填写 API Key/)).toBeVisible();
  await expect(page.getByLabel('任务目标', { exact: true })).toHaveValue('保留这条草稿');
});

test('连接表单实时校验，保存后刷新目录发现模型', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await openModels(page);
  await page.getByRole('button', { name: '添加其他供应商', exact: true }).click();
  const save = page.getByRole('button', { name: '保存连接', exact: true });
  await expect(save).toBeDisabled();
  await page.getByLabel('服务地址', { exact: true }).fill('ftp://example.test');
  await page.getByLabel('服务地址', { exact: true }).blur();
  await expect(
    page.getByText('服务地址需要 HTTPS；本机开发地址可使用 HTTP。', { exact: true }),
  ).toBeVisible();
  await expect(save).toBeDisabled();
  await page.getByLabel('服务地址', { exact: true }).fill('https://example.test/v1');
  await setConnectionName(page, '一次完成连接');
  await page.getByLabel('API Key', { exact: true }).fill('fixture-key');
  await page.route('https://example.test/**', route =>
    route.fulfill({
      json: { data: [{ id: 'discovered-model', display_name: '发现模型' }], has_more: false },
    }),
  );
  await page.getByRole('button', { name: '保存连接', exact: true }).click();
  await expect(page.getByText('连接已保存。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '检测连接并发现模型', exact: true }).click();
  await expect(page.getByText(/发现 1 个模型/)).toBeVisible();
  await expect(page.getByRole('button', { name: '编辑模型 发现模型', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '一次完成连接', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '更多操作', exact: true })).toBeVisible();
});
