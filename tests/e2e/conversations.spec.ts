import { test, expect, type Page } from '@playwright/test';
import { configureModel, openModels, addModel, returnToWorkbench } from './model-helpers';
import { answerEvents, sse } from '../protocol-fixtures';

async function project(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByLabel('项目名称', { exact: true }).fill('多对话项目'); await page.getByRole('button', { name: '创建工作区', exact: true }).click();
  await expect(page.getByLabel('任务目标', { exact: true })).toBeVisible();
}
async function rename(page: Page, title: string) {
  await page.getByRole('button', { name: '重命名当前对话', exact: true }).click();
  await page.getByLabel('对话名称', { exact: true }).fill(title); await page.getByRole('button', { name: '保存对话名称', exact: true }).click();
  await expect(page.getByTestId('conversation-bar')).toContainText(title);
}
async function select(page: Page, title: string) {
  await page.getByRole('button', { name: '切换对话', exact: true }).click();
  await page.getByRole('button', { name: '切换对话 ' + title, exact: true }).last().click();
  await expect(page.getByTestId('conversation-bar')).toContainText(title);
}

test('手机：独立草稿与附件、刷新选择、归档与恢复、项目共享文件', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await project(page); await rename(page, '写作');
  await page.getByLabel('任务目标', { exact: true }).fill('仅属于写作的草稿');
  await page.getByRole('button', { name: '添加参考资料', exact: true }).click();
  await page.getByRole('button', { name: '引用 documents/notes.md', exact: true }).click();
  await expect(page.getByText(/草稿已保存/)).toBeVisible();
  await page.getByRole('button', { name: '新建对话', exact: true }).click(); await rename(page, '阅读');
  await expect(page.getByLabel('任务目标', { exact: true })).toHaveValue(''); await expect(page.getByRole('button', { name: '移除参考文件', exact: true })).toHaveCount(0);
  await page.getByLabel('任务目标', { exact: true }).fill('仅属于阅读的草稿'); await expect(page.getByText(/草稿已保存/)).toBeVisible();
  await select(page, '写作'); await expect(page.getByLabel('任务目标', { exact: true })).toHaveValue('仅属于写作的草稿');
  await expect(page.getByRole('button', { name: '移除参考文件', exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByTestId('conversation-bar')).toContainText('写作');
  await expect(page.getByLabel('任务目标', { exact: true })).toHaveValue('仅属于写作的草稿');
  await select(page, '阅读'); await expect(page.getByLabel('任务目标', { exact: true })).toHaveValue('仅属于阅读的草稿');
  await page.getByRole('tab', { name: '资料', exact: true }).click(); await expect(page.getByRole('button', { name: '打开 documents/notes.md', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '会话', exact: true }).click(); await page.getByRole('button', { name: '切换对话', exact: true }).click();
  await page.getByRole('button', { name: '归档对话 阅读', exact: true }).click(); await page.getByRole('button', { name: '归档对话', exact: true }).click();
  await expect(page.getByTestId('conversation-bar')).toContainText('写作');
  await page.getByRole('button', { name: '切换对话', exact: true }).click(); await page.getByRole('button', { name: '已归档', exact: true }).click();
  await page.getByRole('button', { name: '恢复对话 阅读', exact: true }).first().click();
  await expect(page.getByLabel('任务目标', { exact: true })).toHaveValue('仅属于阅读的草稿');
  await page.screenshot({ path: 'work/conversations-mobile-light.png' });
  await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('button', { name: '深色', exact: true }).click(); await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '切换对话', exact: true }).click(); await page.screenshot({ path: 'work/conversations-mobile-dark.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('真实 Agent 上下文和模型按对话隔离，切换对话不取消任务', async ({ page }) => {
  await project(page); await rename(page, '甲对话'); await configureModel(page);
  await openModels(page); await page.getByRole('button', { name: '打开连接 模拟服务', exact: true }).click(); await addModel(page, '备用模型', 'alternate-model'); await returnToWorkbench(page);
  await page.getByRole('button', { name: '模型设置', exact: true }).click(); await page.getByRole('button', { name: '选择模型 模拟服务 · 模拟模型', exact: true }).click();
  const requests: any[] = []; let release = () => {}; const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('https://example.test/v1/chat/completions', async (route) => {
    const body = route.request().postDataJSON(); requests.push(body); const index = requests.length;
    if (index === 1) await held;
    await route.fulfill({ contentType: 'text/event-stream', body: sse(answerEvents('chat-completions', index === 1 ? '甲对话独有回答' : index === 2 ? '乙对话独有回答' : '甲对话后续回答')) });
  });
  await page.getByLabel('任务目标', { exact: true }).fill('A_PRIVATE'); await page.getByRole('button', { name: '发送任务', exact: true }).click(); await expect.poll(() => requests.length).toBe(1);
  await page.getByRole('button', { name: '新建对话', exact: true }).click(); await rename(page, '乙对话');
  await expect(page.getByText('A_PRIVATE', { exact: true })).toHaveCount(0); await expect(page.getByText(/另一个对话的任务仍在运行/)).toBeVisible();
  await page.getByRole('button', { name: '模型设置', exact: true }).click(); await page.getByRole('button', { name: '选择模型 模拟服务 · 备用模型', exact: true }).click();
  await page.getByLabel('任务目标', { exact: true }).fill('B_PRIVATE'); await expect(page.getByText(/草稿已保存/)).toBeVisible();
  release(); await expect(page.getByRole('button', { name: '发送任务', exact: true })).toBeEnabled();
  await expect(page.getByText('甲对话独有回答', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '发送任务', exact: true }).click(); await expect(page.getByText('乙对话独有回答', { exact: true })).toBeVisible();
  await expect(page.getByText('已完成', { exact: true })).toHaveCount(1); expect(requests[1].model).toBe('alternate-model'); expect(JSON.stringify(requests[1])).not.toContain('A_PRIVATE');
  await page.getByRole('button', { name: '模型设置', exact: true }).click(); await page.getByRole('button', { name: '演示模式', exact: true }).click();
  await select(page, '甲对话'); await expect(page.getByRole('button', { name: '模型设置', exact: true })).toContainText('模拟模型');
  await page.getByLabel('任务目标', { exact: true }).fill('A_FOLLOWUP'); await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect(page.getByText('甲对话后续回答', { exact: true })).toBeVisible(); expect(requests[2].model).toBe('protocol-test');
  expect(JSON.stringify(requests[2])).toContain('A_PRIVATE'); expect(JSON.stringify(requests[2])).not.toContain('B_PRIVATE');
  await page.screenshot({ path: 'work/conversations-desktop.png' });
});
