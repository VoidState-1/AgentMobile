import { expect, type Page } from '@playwright/test';

export async function openProjectTree(page: Page) {
  if (await page.getByTestId('project-tree').isVisible()) return;
  await expect(page.getByRole('tab', { name: '对话', exact: true })).toBeVisible();
  if (!(await page.getByTestId('project-tree').isVisible()))
    await page.getByRole('button', { name: '项目与对话', exact: true }).click();
}
export async function closeProjectTree(page: Page) {
  const close = page.getByRole('button', { name: '收起侧栏', exact: true });
  if (await close.isVisible()) await close.click();
}
export async function selectProject(page: Page, name: string) {
  await openProjectTree(page);
  const project = page
    .getByTestId('project-node')
    .filter({ has: page.getByRole('button', { name: '展开项目 ' + name, exact: true }) });
  const toggle = project.getByRole('button', { name: '展开项目 ' + name, exact: true });
  if (!(await project.getByRole('button', { name: /^切换对话 / }).count())) await toggle.click();
  await project
    .getByRole('button', { name: /^切换对话 / })
    .first()
    .click();
  await closeProjectTree(page);
}
export async function conversationActions(page: Page, title: string) {
  await openProjectTree(page);
  await page.getByRole('button', { name: '切换对话 ' + title, exact: true }).click({ delay: 650 });
}
export async function addReference(page: Page) {
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('button', { name: '添加参考资料', exact: true }).click();
}
export async function expandToolGroups(page: Page) {
  const groups = page.getByRole('button', { name: /^展开连续工具调用 / });
  for (let count = 0; count < 20 && (await groups.count()); count++) await groups.first().click();
}
