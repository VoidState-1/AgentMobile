import { expect, test } from '@playwright/test';
import { openProjectTree } from './workbench-helpers';
import { configureModel } from './model-helpers';

test('首次配置只有一个添加入口，侧栏空状态与设置摘要可直接操作', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await page.goto('/');
  await openProjectTree(page);
  await expect(
    page.getByTestId('project-tree').getByRole('button', { name: '新建项目', exact: true }),
  ).toHaveCount(1);
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  await expect(page.getByRole('button', { name: '模型与供应商', exact: true })).toContainText(
    '演示模式',
  );
  await expect(page.getByRole('button', { name: '远程 MCP', exact: true })).toContainText(
    '已启用 0',
  );
  await page.getByRole('button', { name: '模型与供应商', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加连接', exact: true })).toHaveCount(1);
  await expect(page.getByLabel('搜索连接', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'work/mobile-ui/unified-onboarding-light.png' });
  await page.getByRole('button', { name: '添加连接', exact: true }).click();
  await page.getByRole('button', { name: '自定义服务', exact: true }).click();
  await expect(page.getByRole('button', { name: '手工添加', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByRole('button', { name: '模型与供应商', exact: true }).click();
  await page.screenshot({ path: 'work/mobile-ui/unified-onboarding-dark.png' });
});

test('阅读编辑由顶栏切换，文件与 Git 共享状态，窄屏切换保持内容', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByLabel('项目名称', { exact: true }).fill('一致性');
  await page.getByRole('button', { name: '创建工作区', exact: true }).click();
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await expect(page.getByRole('tablist', { name: '文件类型', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '打开 documents/notes.md', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '阅读', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'work/mobile-ui/unified-reader.png' });
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByRole('button', { name: '完成编辑', exact: true })).toBeVisible();
  await page.getByLabel('正文', { exact: true }).fill('一致的文件状态');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑', exact: true })).toBeVisible();
  await expect(page.getByLabel('正文', { exact: true })).toHaveCount(0);
  await expect(page.getByText('一致的文件状态', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭文件', exact: true }).click();
  const fileBadge = page
    .getByRole('button', { name: '打开 documents/notes.md', exact: true })
    .getByLabel('Git 修改', { exact: true });
  await expect(fileBadge).toBeVisible();
  const fileColor = await fileBadge
    .getByText('修改', { exact: true })
    .evaluate(node => getComputedStyle(node).color);
  await page.getByRole('tab', { name: 'Git', exact: true }).click();
  await expect(page.getByTestId('workbench-header')).toContainText('main');
  await expect(page.getByRole('tablist', { name: 'Git 视图', exact: true })).toBeVisible();
  const gitBadge = page.getByLabel('Git 修改', { exact: true });
  expect(
    await gitBadge
      .getByText('修改', { exact: true })
      .evaluate(node => getComputedStyle(node).color),
  ).toBe(fileColor);
  await page.screenshot({ path: 'work/mobile-ui/unified-git.png' });
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await page.getByRole('tab', { name: '文字', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '打开 documents/notes.md', exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 500 });
  const search = await page.getByLabel('搜索文件', { exact: true }).boundingBox();
  const upload = await page.getByRole('button', { name: '导入', exact: true }).boundingBox();
  const create = await page.getByRole('button', { name: '新建文件', exact: true }).boundingBox();
  expect(search!.width).toBeGreaterThanOrEqual(44);
  expect(search!.x + search!.width).toBeLessThanOrEqual(upload!.x);
  expect(upload!.width).toBeGreaterThanOrEqual(44);
  expect(create!.width).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('多产物显示真实行数并直达所选差异，后续编辑不改变任务历史统计', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByLabel('项目名称', { exact: true }).fill('产物统计');
  await page.getByRole('button', { name: '创建工作区', exact: true }).click();
  await configureModel(page);
  let round = 0;
  await page.route('https://example.test/v1/chat/completions', async route => {
    const delta =
      ++round === 1
        ? {
            content: '先整理两份文件。',
            tool_calls: [
              {
                index: 0,
                id: 'alpha',
                function: {
                  name: 'write_text',
                  arguments: JSON.stringify({
                    path: 'documents/alpha.md',
                    text: '甲\n乙\n',
                    expectedRevision: null,
                  }),
                },
              },
              {
                index: 1,
                id: 'beta',
                function: {
                  name: 'write_text',
                  arguments: JSON.stringify({
                    path: 'documents/beta.md',
                    text: '丙\n',
                    expectedRevision: null,
                  }),
                },
              },
            ],
          }
        : { content: '已整理两份文件。' };
    await route.fulfill({
      contentType: 'text/event-stream',
      body:
        'data: ' +
        JSON.stringify({
          choices: [{ delta, finish_reason: round === 1 ? 'tool_calls' : 'stop' }],
        }) +
        '\n\ndata: [DONE]\n\n',
    });
  });
  await page.getByLabel('任务目标', { exact: true }).fill('整理两份文件');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
  const alpha = page.getByRole('button', { name: '查看产物差异 documents/alpha.md', exact: true });
  const beta = page.getByRole('button', { name: '查看产物差异 documents/beta.md', exact: true });
  await expect(alpha).toContainText('+2');
  await expect(beta).toContainText('+1');
  await expect(beta).toContainText('−0');
  await expect(page.getByTestId('run-process').getByTestId('run-response')).toHaveCount(0);
  await expect(page.getByTestId('run-response')).toContainText('已整理两份文件。');
  await page.screenshot({ path: 'work/mobile-ui/unified-conversation-light.png' });
  await beta.click();
  await expect(
    page.getByRole('tab', { name: '查看变化 documents/beta.md', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('丙', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '打开 documents/beta.md', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('正文', { exact: true }).fill('丙\n丁\n戊\n');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭文件', exact: true }).click();
  await page.getByRole('tab', { name: '对话', exact: true }).click();
  await expect(beta).toContainText('+1');
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  await expect(page.getByRole('button', { name: '模型与供应商', exact: true })).toContainText(
    '模拟模型',
  );
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByRole('tab', { name: '对话', exact: true }).click();
  await expect(beta).toContainText('+1');
  await page.screenshot({ path: 'work/mobile-ui/unified-conversation-dark.png' });
});
