import { expect, test, type Page } from '@playwright/test';
import { openProjectTree } from './workbench-helpers';

async function importFile(page: Page, name: string, buffer: Buffer) {
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入', exact: true }).click();
  const chooser = await choosing;
  expect(await chooser.element().getAttribute('accept')).toBeNull();
  await chooser.setFiles({ name, mimeType: 'application/octet-stream', buffer });
}

for (const width of [390, 1280]) {
  test(`${width}px：文本可编辑，二进制保留原字节、明确预览边界并可导出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await openProjectTree(page);
    await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
    await page.getByLabel('项目名称', { exact: true }).fill('通用文本');
    await page.getByRole('button', { name: '创建工作区', exact: true }).click();
    await expect(page.getByLabel('任务目标', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: '文件', exact: true }).click();

    const text = '# 原样保留\n**这不是粗体**\n{"name":"中文😀"}\n';
    await importFile(page, 'config.json', Buffer.from(text));
    await page.getByRole('button', { name: '打开 documents/config.json', exact: true }).click();
    await expect(page.getByTestId('file-plain-preview')).toHaveText(text);
    await page.getByRole('button', { name: '重命名文件', exact: true }).click();
    await page.getByLabel('文件名称', { exact: true }).fill('Dockerfile');
    await page.getByRole('button', { name: '保存名称', exact: true }).click();
    await expect(page.getByTestId('file-plain-preview')).toHaveText(text);
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByLabel('正文', { exact: true }).fill('FROM scratch\n# 中文😀\n');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByTestId('file-plain-preview')).toHaveText('FROM scratch\n# 中文😀\n');
    await page.getByRole('button', { name: '关闭文件', exact: true }).click();

    await page.getByRole('button', { name: '新建文件', exact: true }).click();
    await page.getByLabel('文件名称', { exact: true }).fill('main.ts');
    await page.getByLabel('正文', { exact: true }).fill('export const text = "中文😀";\n');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByTestId('file-plain-preview')).toHaveText(
      'export const text = "中文😀";\n',
    );
    await page.getByRole('button', { name: '关闭文件', exact: true }).click();
    await page.reload();
    await page.getByRole('tab', { name: '文件', exact: true }).click();
    await page.getByRole('button', { name: '打开 documents/Dockerfile', exact: true }).click();
    await expect(page.getByTestId('file-plain-preview')).toHaveText('FROM scratch\n# 中文😀\n');
    await page.getByRole('button', { name: '关闭文件', exact: true }).click();
    await importFile(page, 'binary.dat', Buffer.from([0, 1, 2]));
    await page.getByRole('button', { name: '打开 assets/binary.dat', exact: true }).click();
    await expect(page.getByTestId('file-unavailable-preview')).toBeVisible();
    await expect(page.getByRole('button', { name: '编辑', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '重命名文件', exact: true }).click();
    await page.getByLabel('文件名称', { exact: true }).fill('binary.txt');
    await page.getByRole('button', { name: '保存名称', exact: true }).click();
    await expect(page.getByTestId('file-unavailable-preview')).toBeVisible();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出文件', exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe('binary.txt');
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([0, 1, 2]));
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  });
}
