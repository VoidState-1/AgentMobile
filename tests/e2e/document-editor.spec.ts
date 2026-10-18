import { expect, test } from '@playwright/test';
import { editorFrame, editorInput, editFullDocument, swipeBlock } from './editor-helpers';
import { openProjectTree } from './workbench-helpers';

async function openDocument(page: import('@playwright/test').Page, text: string) {
  await page.goto('/');
  await openProjectTree(page);
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByLabel('项目名称', { exact: true }).fill('块编辑 ' + Date.now());
  await page.getByRole('button', { name: '创建工作区', exact: true }).click();
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入', exact: true }).click();
  await (
    await choosing
  ).setFiles({ name: 'blocks.md', mimeType: 'text/markdown', buffer: Buffer.from(text) });
  await page.getByRole('button', { name: '打开 documents/blocks.md', exact: true }).click();
  await expect(editorFrame(page).getByRole('tab', { name: '分块', exact: true })).toBeVisible();
}
const sample =
  '# 标题\n\n第一段文本。\n\n第二段文本。\n\n第三段文本。\n\n| 列 | 值 |\n| --- | --- |\n| A | B |\n\n- [x] 已完成\n- [ ] 未完成\n';

test('块手势、独立保存、关闭中间块、上下方向键与只读边界', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDocument(page, sample);
  const frame = editorFrame(page);
  await expect(frame.locator('table')).toHaveCount(1);
  await expect(frame.locator('input[type=checkbox]')).toHaveCount(2);
  await expect(frame.locator('.cm-line')).toHaveCount(0);
  const initialScroll = await frame.locator('body').evaluate(() => scrollY);
  await swipeBlock(page, frame.locator('.read-block').filter({ hasText: '第一段文本。' }), 'left');
  await expect(frame.locator('.unlocked-line')).toHaveCount(1);
  expect(
    Math.abs((await frame.locator('body').evaluate(() => scrollY)) - initialScroll),
  ).toBeLessThan(30);
  await editorInput(page).press('ArrowUp');
  await expect(frame.locator('.cm-line:not(.unlocked-line)')).toHaveCount(0);
  await editorInput(page).press('End');
  await editorInput(page).pressSequentially('新增内容');
  await swipeBlock(page, frame.locator('.read-block').filter({ hasText: '第二段文本。' }), 'left');
  await swipeBlock(page, frame.locator('.read-block').filter({ hasText: '第三段文本。' }), 'left');
  const middle = frame.locator('.unlocked-line').filter({ hasText: '第二段文本。' });
  await swipeBlock(page, middle, 'right');
  await expect(frame.locator('.read-block').filter({ hasText: '第二段文本。' })).toHaveCount(1);
  await expect(frame.locator('.cm-line:not(.unlocked-line)')).toHaveCount(0);
  await expect(page.getByText('未保存的修改', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存文件', exact: true }).click();
  await expect(frame.locator('.cm-line')).toHaveCount(0);
  await expect(
    frame.locator('.read-block').filter({ hasText: '第一段文本。新增内容' }),
  ).toHaveCount(1);
  await page.getByRole('button', { name: '关闭文件', exact: true }).click();
  await page.reload();
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '打开 documents/blocks.md', exact: true }).click();
  await expect(
    editorFrame(page).locator('.read-block').filter({ hasText: '第一段文本。新增内容' }),
  ).toHaveCount(1);
});

test('全文输入、离开保护、刷新恢复草稿、左滑放弃、离线安全渲染', async ({ page }) => {
  const requests: string[] = [];
  await openDocument(
    page,
    '# 文档\n\n安全正文\n\n<script>window.markdownExecuted=true</script>\n\n![外部图](https://unsafe.invalid/a.png)',
  );
  page.on('request', request => {
    if (request.url().includes('unsafe.invalid')) requests.push(request.url());
  });
  const frame = editorFrame(page);
  await expect(
    frame.getByText('<script>window.markdownExecuted=true</script>', { exact: true }),
  ).toBeVisible();
  await editFullDocument(page);
  await editorInput(page).fill('# 未保存草稿\n\n保留这段中文 😀');
  await frame.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(editorInput(page)).not.toContainText('保留这段中文 😀');
  await frame.getByRole('button', { name: '重做', exact: true }).click();
  await expect(editorInput(page)).toContainText('保留这段中文 😀');
  await expect(page.getByText('未保存的修改', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭文件', exact: true }).click();
  await expect(page.getByText('有尚未保存的修改', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  page.on('dialog', dialog => {
    void dialog.accept();
  });
  await page.reload();
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '打开 documents/blocks.md', exact: true }).click();
  await expect(editorInput(page)).toContainText('保留这段中文 😀');
  await editorFrame(page).getByRole('button', { name: '放弃', exact: true }).click();
  await expect(
    editorFrame(page).locator('.read-block').filter({ hasText: '安全正文' }),
  ).toHaveCount(1);
  expect(requests).toEqual([]);
});

test('真实触摸指针接管后仍能左滑打开、右滑保存', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDocument(page, '# 标题\n\n触摸段落');
  const touch = await page.context().newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const swipe = async (target: import('@playwright/test').Locator, dx: number) => {
    const bounds = await target.boundingBox();
    if (!bounds) throw new Error('触摸目标不可见');
    const x = bounds.x + Math.min(bounds.width * 0.6, 230),
      y = bounds.y + Math.min(bounds.height / 2, 18);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 8; step++)
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + (dx * step) / 8, y }],
      });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const frame = editorFrame(page);
  await swipe(frame.locator('.read-block').filter({ hasText: '触摸段落' }), -85);
  await expect(frame.locator('.unlocked-line')).toHaveCount(1);
  await swipe(frame.locator('.unlocked-line'), 85);
  await expect(frame.locator('.unlocked-line')).toHaveCount(0);
  await expect(frame.locator('.read-block').filter({ hasText: '触摸段落' })).toHaveCount(1);
});

test('连续退格跨块合并、共享行拖动独立、关联保存', async ({ page }) => {
  await openDocument(page, 'AAA\n\nBBB\n\nCCC');
  const frame = editorFrame(page);
  await swipeBlock(page, frame.locator('.read-block').filter({ hasText: 'AAA' }), 'left');
  await swipeBlock(page, frame.locator('.read-block').filter({ hasText: 'BBB' }), 'left');
  await frame
    .locator('.unlocked-line')
    .filter({ hasText: 'BBB' })
    .click({ position: { x: 14, y: 10 } });
  await editorInput(page).press('Home');
  for (let i = 0; i < 3; i++) await editorInput(page).press('Backspace');
  await expect(frame.locator('.cm-line').filter({ hasText: 'AABBB' })).toHaveCount(1);
  const moving = frame.locator('[data-source-region]').filter({ hasText: 'BBB' });
  const stationary = frame.locator('[data-source-region]').filter({ hasText: 'AA' });
  const box = (await moving.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + 10, { steps: 5 });
  await expect(stationary).not.toHaveAttribute('style', /left/);
  await expect(moving).toHaveAttribute('style', /left:\s*40px/);
  await page.mouse.up();
  await swipeBlock(page, moving, 'right');
  await expect(frame.locator('.unlocked-line')).toHaveCount(0);
  await expect(frame.locator('.read-block').filter({ hasText: 'AABBB' })).toHaveCount(1);
  await expect(frame.locator('.read-block').filter({ hasText: 'CCC' })).toHaveCount(1);
});

test('切换编辑方式明确保存或放弃，取消不会写入文件', async ({ page }) => {
  await openDocument(page, '原始正文');
  const frame = editorFrame(page);
  await swipeBlock(page, frame.locator('.read-block'), 'left');
  await editorInput(page).press('End');
  await editorInput(page).pressSequentially('草稿');
  await frame.getByRole('tab', { name: '全文', exact: true }).click();
  await expect(page.getByText('切换编辑方式前保存？', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(editorInput(page)).toContainText('原始正文草稿');
  await expect(frame.getByRole('tab', { name: '分块', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await frame.getByRole('tab', { name: '全文', exact: true }).click();
  await page.getByRole('button', { name: '放弃并切换', exact: true }).click();
  await expect(editorInput(page)).toHaveText('原始正文');
  await expect(page.getByText('所有修改已保存', { exact: true })).toBeVisible();
  await editorInput(page).fill('明确保存的内容');
  await frame.getByRole('tab', { name: '分块', exact: true }).click();
  await page.getByRole('button', { name: '保存并切换', exact: true }).click();
  await expect(frame.locator('.read-block')).toHaveText('明确保存的内容');
  await page.getByRole('button', { name: '关闭文件', exact: true }).click();
  await page.reload();
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '打开 documents/blocks.md', exact: true }).click();
  await expect(editorFrame(page).locator('.read-block')).toHaveText('明确保存的内容');
});

test('新建空文件切到分块阅读后仍可保存并导出零字节', async ({ page }) => {
  await openDocument(page, '已有文件');
  await page.getByRole('button', { name: '关闭文件', exact: true }).click();
  await page.getByRole('button', { name: '新建文件', exact: true }).click();
  await page.getByLabel('文件名称', { exact: true }).fill('blank.md');
  await editorFrame(page).getByRole('tab', { name: '分块', exact: true }).click();
  await page.getByRole('button', { name: '保存文件', exact: true }).click();
  await expect(page.getByText('所有修改已保存', { exact: true })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出文件', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('blank.md');
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).length).toBe(0);
});
