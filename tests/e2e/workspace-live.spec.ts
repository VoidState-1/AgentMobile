import { openProjectTree, selectProject } from './workbench-helpers';
import { test, expect, type Page } from '@playwright/test';
import { configureModel } from './model-helpers';
import { sse, toolEvents, answerEvents } from '../protocol-fixtures';

async function project(page: Page, name: string) {
  await openProjectTree(page);
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByLabel('项目名称', { exact: true }).fill(name);
  await page.getByRole('button', { name: '创建工作区', exact: true }).click();
  await expect(page.getByLabel('任务目标', { exact: true })).toBeVisible();
}
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => {
    release = resolve;
  });
  return { promise, release };
};
const revision = (body: any) =>
  body.messages
    .filter((message: any) => message.role === 'tool')
    .reverse()
    .map((message: any) => JSON.parse(message.content))
    .find((result: any) => result.revision)?.revision;

test('发送后立即切到资料，启动完成不会把导航切回会话', async ({ page }) => {
  await page.goto('/');
  await project(page, '启动导航');
  await configureModel(page);
  const held = gate();
  let requests = 0;
  await page.route('https://example.test/v1/chat/completions', async route => {
    requests++;
    await held.promise;
    await route.fulfill({
      contentType: 'text/event-stream',
      body: sse(answerEvents('chat-completions', '任务完成。')),
    });
  });
  await page.getByLabel('任务目标', { exact: true }).fill('检查项目资料');
  await page.getByRole('button', { name: '发送任务', exact: true }).dispatchEvent('click');
  await page.getByRole('tab', { name: '文件', exact: true }).dispatchEvent('click');
  await expect.poll(() => requests).toBe(1);
  await expect(page.getByRole('button', { name: '新建项目', exact: true }).first()).toBeEnabled();
  await expect(page.getByRole('tab', { name: '文件', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  held.release();
  await expect(page.getByRole('button', { name: '新建文件', exact: true })).toBeEnabled();
  await expect(page.getByRole('tab', { name: '文件', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('Agent 等待下一轮时，资料新增、正在阅读的内容、移动、删除和版本均已更新', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await project(page, '实时资料');
  await configureModel(page);
  const holds = [gate(), gate(), gate(), gate()];
  let requests = 0;
  await page.route('https://example.test/v1/chat/completions', async route => {
    const body = route.request().postDataJSON();
    const round = ++requests;
    if (round > 1) await holds[round - 2].promise;
    const events =
      round === 1
        ? toolEvents('chat-completions', 'write_text', {
            path: 'documents/live.md',
            text: '实时内容第一版。',
            expectedRevision: null,
          })
        : round === 2
          ? toolEvents('chat-completions', 'write_text', {
              path: 'documents/live.md',
              text: '实时内容第二版。',
              expectedRevision: revision(body),
            })
          : round === 3
            ? toolEvents('chat-completions', 'move_file', {
                from: 'documents/live.md',
                to: 'documents/moved.md',
                expectedRevision: revision(body),
              })
            : round === 4
              ? toolEvents('chat-completions', 'delete_file', {
                  path: 'documents/moved.md',
                  expectedRevision: revision(body),
                })
              : answerEvents('chat-completions', '已完成实时文件操作。');
    if (round < 5) (events[0] as any).choices[0].delta.tool_calls[0].id = 'live-call-' + round;
    await route.fulfill({ contentType: 'text/event-stream', body: sse(events) });
  });
  await page.getByLabel('任务目标', { exact: true }).fill('分步整理资料');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect.poll(() => requests).toBe(2);
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '打开 documents/live.md', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '打开 documents/live.md', exact: true }).click();
  await expect(page.getByText('实时内容第一版。', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Agent 正在修改项目。你可以阅读，完成后再编辑。', { exact: true }),
  ).toBeVisible();
  holds[0].release();
  await expect.poll(() => requests).toBe(3);
  await expect(page.getByText('实时内容第二版。', { exact: true })).toBeVisible();
  await expect(page.getByText('实时内容第一版。', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'work/workspace-live-reading.png' });
  await page.getByRole('tab', { name: 'Git', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '查看未暂存差异 documents/live.md', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '全部暂存', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: '提交历史 · 1', exact: true }).click();
  await expect(page.getByRole('button', { name: /^查看版本 / })).toHaveCount(1);
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  holds[1].release();
  await expect.poll(() => requests).toBe(4);
  await expect(
    page.getByRole('button', { name: '打开 documents/live.md', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '打开 documents/moved.md', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '关闭文件', exact: true })).toHaveCount(0);
  holds[2].release();
  await expect.poll(() => requests).toBe(5);
  await expect(
    page.getByRole('button', { name: '打开 documents/moved.md', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新建文件', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: '对话', exact: true }).click();
  await expect(page.getByRole('button', { name: '停止任务', exact: true })).toBeVisible();
  await expect(page.getByText('已完成', { exact: true })).toHaveCount(0);
  holds[3].release();
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('手机切到其他项目时，后台 Agent 的资料变更不覆盖当前文件和未保存草稿', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await project(page, '后台项目');
  await configureModel(page);
  await project(page, '当前项目');
  await openProjectTree(page);
  await selectProject(page, '后台项目');
  const held = gate();
  const final = gate();
  let requests = 0;
  await page.route('https://example.test/v1/chat/completions', async route => {
    const round = ++requests;
    await (round === 1 ? held.promise : final.promise);
    await route.fulfill({
      contentType: 'text/event-stream',
      body: sse(
        round === 1
          ? toolEvents('chat-completions', 'write_text', {
              path: 'documents/background.md',
              text: '后台项目新资料。',
              expectedRevision: null,
            })
          : answerEvents('chat-completions', '后台任务完成。'),
      ),
    });
  });
  await page.getByLabel('任务目标', { exact: true }).fill('整理后台项目');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect.poll(() => requests).toBe(1);
  await openProjectTree(page);
  await selectProject(page, '当前项目');
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '打开 documents/notes.md', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('正文', { exact: true }).fill('必须保留的未保存草稿。');
  held.release();
  await expect.poll(() => requests).toBe(2);
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue('必须保留的未保存草稿。');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '关闭文件', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '打开 documents/background.md', exact: true }),
  ).toHaveCount(0);
  await openProjectTree(page);
  await selectProject(page, '后台项目');
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '打开 documents/background.md', exact: true }),
  ).toBeVisible();
  final.release();
  await page.getByRole('tab', { name: '对话', exact: true }).click();
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
});

test('正在阅读的 Markdown 引用图片被删除后即时显示不可用，任务仍在继续', async ({ page }) => {
  await page.goto('/');
  await project(page, '图片刷新');
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入', exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: 'sample.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nXcAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await page.getByRole('button', { name: '打开 documents/notes.md', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page
    .getByLabel('正文', { exact: true })
    .fill('# 图片资料\n\n![项目引用图](../assets/sample.png)');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '关闭文件', exact: true }).click();
  await configureModel(page);
  await page.getByRole('tab', { name: '对话', exact: true }).click();
  const deleting = gate();
  const final = gate();
  let requests = 0;
  await page.route('https://example.test/v1/chat/completions', async route => {
    const body = route.request().postDataJSON();
    const round = ++requests;
    if (round === 2) await deleting.promise;
    if (round === 3) await final.promise;
    const files =
      round === 2
        ? JSON.parse(body.messages.filter((message: any) => message.role === 'tool').at(-1).content)
            .files
        : [];
    await route.fulfill({
      contentType: 'text/event-stream',
      body: sse(
        round === 1
          ? toolEvents('chat-completions', 'list_files')
          : round === 2
            ? toolEvents('chat-completions', 'delete_file', {
                path: 'assets/sample.png',
                expectedRevision: files.find((file: any) => file.path === 'assets/sample.png')
                  .revision,
              })
            : answerEvents('chat-completions', '图片已删除。'),
      ),
    });
  });
  await page.getByLabel('任务目标', { exact: true }).fill('删除项目图片');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect.poll(() => requests).toBe(2);
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '打开 documents/notes.md', exact: true }).click();
  await expect(page.getByRole('img', { name: '项目引用图', exact: true })).toBeVisible();
  deleting.release();
  await expect.poll(() => requests).toBe(3);
  await expect(page.getByRole('img', { name: '项目引用图', exact: true })).toHaveCount(0);
  await expect(page.getByText('图片不可用', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Agent 正在修改项目。你可以阅读，完成后再编辑。', { exact: true }),
  ).toBeVisible();
  final.release();
  await page.getByRole('button', { name: '关闭文件', exact: true }).click();
  await page.getByRole('tab', { name: '对话', exact: true }).click();
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
});
