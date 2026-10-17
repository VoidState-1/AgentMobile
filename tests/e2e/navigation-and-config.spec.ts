import { expect, test } from '@playwright/test';
import { setConnectionName } from './model-helpers';

for (const width of [360, 1280]) {
  test(`${width}px：无项目时四个底栏可往返，文件空状态可创建项目`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    await page.goto('/');
    for (const name of ['设置', '对话', '文件', 'Git', '设置', 'Git', '文件', '对话']) {
      const tab = page.getByRole('tab', { name, exact: true });
      await expect(tab).toBeEnabled();
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('workbench-header')).toContainText(
        name === '对话' ? 'Agent Mobile' : name,
      );
      if (name !== '设置') await expect(page.getByTestId('project-empty-state')).toBeVisible();
    }
    await page.getByRole('tab', { name: '文件', exact: true }).click();
    await page
      .getByTestId('project-empty-state')
      .getByRole('button', { name: '新建项目', exact: true })
      .click();
    await page.getByLabel('项目名称', { exact: true }).fill('导航验证');
    await page.getByRole('button', { name: '创建工作区', exact: true }).click();
    await expect(page.getByLabel('任务目标', { exact: true })).toBeVisible();
    await page.getByLabel('任务目标', { exact: true }).fill('切换后保留草稿');
    for (const name of ['文件', 'Git', '设置', '对话']) {
      await page.getByRole('tab', { name, exact: true }).click();
      await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    }
    await expect(page.getByLabel('任务目标', { exact: true })).toHaveValue('切换后保留草稿');
    await page.reload();
    await expect(page.getByLabel('任务目标', { exact: true })).toHaveValue('切换后保留草稿');
  });
}

test('360px 短屏：配置与输入弹层可操作，深色页面无横向溢出', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 360, height: 500 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  const verify = async () => {
    await expect(page.getByTestId('config-dark').filter({ visible: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  };

  await page.getByRole('button', { name: '模型与供应商', exact: true }).click();
  await verify();
  await page.getByRole('button', { name: '添加其他供应商', exact: true }).click();
  await verify();
  await expect(page.getByRole('button', { name: '保存连接', exact: true })).toBeInViewport();
  await setConnectionName(page, '尚未保存');
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page.getByText('有尚未保存的配置', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '继续编辑', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: '放弃修改并离开', exact: true }).click();
  await page.getByRole('button', { name: '返回', exact: true }).click();

  await page.getByRole('button', { name: '远程 MCP', exact: true }).click();
  await verify();
  await page.getByRole('button', { name: '添加连接', exact: true }).click();
  await verify();
  await expect(page.getByRole('button', { name: '保存 MCP 连接', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '返回', exact: true }).click();

  await page.getByRole('button', { name: 'Agent Skills', exact: true }).click();
  await verify();
  await page.getByRole('button', { name: '新建技能', exact: true }).click();
  await verify();
  await expect(page.getByRole('button', { name: '保存技能', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '返回', exact: true }).click();

  await page.getByRole('button', { name: 'Agent 设置', exact: true }).click();
  await verify();
  await expect(page.getByRole('button', { name: '保存 Agent 设置', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: /说明$/ })).toHaveCount(0);
  await page.screenshot({ path: 'work/mobile-ui/config-short-dark.png' });
  expect(errors).toEqual([]);
});

for (const width of [320, 390]) {
  test(`${width}px：参数按单列排列，名称数值单位同排，分组菜单可以恢复默认`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    await page.goto('/');
    await page.getByRole('tab', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: 'Agent 设置', exact: true }).click();
    const rows = page.getByTestId('number-setting');
    await expect(rows).toHaveCount(5);
    let previousY = -1;
    let valueX = -1;
    for (const row of await rows.all()) {
      await row.scrollIntoViewIfNeeded();
      const input = await row.getByRole('textbox').boundingBox();
      const label = await row.locator(':scope > div').first().boundingBox();
      expect(input).not.toBeNull();
      expect(label).not.toBeNull();
      expect(Math.abs(label!.y + label!.height / 2 - input!.y - input!.height / 2)).toBeLessThan(2);
      expect(label!.height).toBeLessThan(25);
      expect(input!.y).toBeGreaterThan(previousY);
      if (valueX >= 0) expect(input!.x).toBe(valueX);
      previousY = input!.y;
      valueX = input!.x;
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await expect(page.getByRole('button', { name: '恢复默认预算', exact: true })).toHaveCount(0);
    await page.getByLabel('模型请求轮数', { exact: true }).fill('80');
    await page.getByRole('button', { name: '执行预算操作', exact: true }).click();
    await page.getByRole('button', { name: '恢复默认预算', exact: true }).click();
    await expect(page.getByLabel('模型请求轮数', { exact: true })).toHaveValue('50');
    await page.getByLabel('系统提示词', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `work/mobile-ui/settings-single-column-${width}.png` });
  });
}
