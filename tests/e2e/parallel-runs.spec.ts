import { selectProject, openProjectTree } from './workbench-helpers';
import { test, expect, type Page } from '@playwright/test';
import { configureModel } from './model-helpers';
import { answerEvents, sse } from '../protocol-fixtures';

async function project(page: Page, name: string) {
  await openProjectTree(page);
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByLabel('项目名称', { exact: true }).fill(name);
  await page.getByRole('button', { name: '创建工作区', exact: true }).click();
}
const text = (value: any) =>
  Array.isArray(value) ? value.map((part: any) => part.text ?? '').join('') : String(value);

test('两个项目并行，当前对话停止只取消自身；其他项目的完成消息实时进入历史', async ({ page }) => {
  await page.goto('/');
  await project(page, '并行甲');
  await configureModel(page);
  let releaseA!: () => void;
  let releaseB!: () => void;
  const a = new Promise<void>(resolve => {
    releaseA = resolve;
  });
  const b = new Promise<void>(resolve => {
    releaseB = resolve;
  });
  const requests: any[] = [];
  await page.route('https://example.test/v1/chat/completions', async route => {
    const body = route.request().postDataJSON();
    requests.push(body);
    const goal = text(body.messages.find((message: any) => message.role === 'user').content);
    await (goal === 'TASK_A' ? a : b);
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sse(answerEvents('chat-completions', goal + '完成')),
    });
  });
  await page.getByLabel('任务目标', { exact: true }).fill('TASK_A');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  await project(page, '并行乙');
  await page.getByLabel('任务目标', { exact: true }).fill('TASK_B');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  await expect(page.getByTestId('run-activity')).toContainText('活动任务 · 2');
  await page.getByRole('button', { name: '查看活动任务 TASK_A', exact: true }).click();
  await expect(
    page.getByTestId('conversation-scroll').getByText('TASK_A', { exact: true }),
  ).toBeVisible();
  releaseA();
  await expect(page.getByText('TASK_A完成', { exact: true })).toBeVisible();
  await expect(page.getByTestId('run-activity')).toContainText('活动任务 · 1');
  await page.getByRole('button', { name: '查看活动任务 TASK_B', exact: true }).click();
  await page.getByRole('button', { name: '停止任务', exact: true }).click();
  await expect(page.getByText('已停止', { exact: true })).toBeVisible();
  releaseB();
  await expect(page.getByTestId('run-activity')).toHaveCount(0);
  expect(JSON.stringify(requests[0])).not.toContain('TASK_B');
  expect(JSON.stringify(requests[1])).not.toContain('TASK_A');
  await selectProject(page, '并行甲');
  await page.reload();
  await expect(page.getByText('TASK_A完成', { exact: true })).toBeVisible();
});

test('同项目第二对话发送后排队，不提前请求模型，首任务完成后正常启动', async ({ page }) => {
  await page.goto('/');
  await project(page, '队列项目');
  await configureModel(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  const goals: string[] = [];
  await page.route('https://example.test/v1/chat/completions', async route => {
    const body = route.request().postDataJSON();
    const goal = text(body.messages.find((message: any) => message.role === 'user').content);
    goals.push(goal);
    if (goal === 'FIRST') await held;
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sse(answerEvents('chat-completions', goal + '结果')),
    });
  });
  await page.getByLabel('任务目标', { exact: true }).fill('FIRST');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect.poll(() => goals.length).toBe(1);
  await page.getByRole('button', { name: '新建对话', exact: true }).click();
  await page.getByLabel('任务目标', { exact: true }).fill('SECOND');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect(page.getByText('等待启动', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '取消排队', exact: true })).toBeVisible();
  expect(goals).toEqual(['FIRST']);
  release();
  await expect(page.getByText('SECOND结果', { exact: true })).toBeVisible();
  expect(goals).toEqual(['FIRST', 'SECOND']);
  await page.getByRole('button', { name: '切换对话 FIRST', exact: true }).click();
  await expect(page.getByText('FIRST结果', { exact: true })).toBeVisible();
});
