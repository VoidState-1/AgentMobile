import { expect, test } from '@playwright/test';
import { openProjectTree } from './workbench-helpers';
import { configureModel } from './model-helpers';

test('流式 Markdown 更新保留不变区段的 DOM 节点', async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const control: { ready: boolean; release?: () => void } = { ready: false };
    Object.assign(window, { __markdownStreamControl: control });
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.endsWith('/chat/completions')) return originalFetch(input, init);
      let release!: () => void;
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      control.release = release;
      control.ready = true;
      const encoder = new TextEncoder();
      const event = (delta: object, finishReason?: string) =>
        'data: ' +
        JSON.stringify({
          choices: [{ delta, ...(finishReason ? { finish_reason: finishReason } : {}) }],
        }) +
        '\n\n';
      const body = new ReadableStream<Uint8Array>({
        async start(stream) {
          stream.enqueue(encoder.encode(event({ content: '# 稳定标题\n\n稳定段落\n\n活动片段' })));
          await gate;
          stream.enqueue(encoder.encode(event({ content: '继续' })));
          await new Promise(resolve => setTimeout(resolve, 40));
          stream.enqueue(encoder.encode(event({}, 'stop') + 'data: [DONE]\n\n'));
          stream.close();
        },
      });
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    };
  });
  await page.goto('/');
  await openProjectTree(page);
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByLabel('项目名称', { exact: true }).fill('流式渲染');
  await page.getByRole('button', { name: '创建工作区', exact: true }).click();
  await configureModel(page);
  await page.getByLabel('任务目标', { exact: true }).fill('检查流式 Markdown');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await page.waitForFunction(() =>
    Boolean(
      (window as unknown as { __markdownStreamControl?: { ready: boolean } })
        .__markdownStreamControl?.ready,
    ),
  );
  const title = page.locator('.markdown h1').filter({ hasText: '稳定标题' });
  const paragraph = page.locator('.markdown p').filter({ hasText: '稳定段落' });
  await expect(title).toBeVisible();
  await expect(paragraph).toBeVisible();
  const titleNode = await title.elementHandle();
  const paragraphNode = await paragraph.elementHandle();
  await page.evaluate(() => {
    (
      window as unknown as { __markdownStreamControl: { release(): void } }
    ).__markdownStreamControl.release();
  });
  await expect(page.getByText('活动片段继续', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(node => node === document.querySelector('.markdown h1'), titleNode),
  ).toBe(true);
  expect(
    await page.evaluate(
      node => node === document.querySelectorAll('.markdown p')[0],
      paragraphNode,
    ),
  ).toBe(true);
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
  await expect(page.getByText('读取中…', { exact: true })).toHaveCount(0);
});
