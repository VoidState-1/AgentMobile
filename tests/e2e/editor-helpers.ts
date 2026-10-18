import { expect, type Page, type Locator } from '@playwright/test';

export const editorFrame = (page: Page) => page.frameLocator('[data-testid="document-surface"]');
export const editorInput = (page: Page) =>
  editorFrame(page).getByRole('textbox', { name: '正文', exact: true });
export async function expectEditorText(page: Page, text: string) {
  await expect
    .poll(async () => (await editorFrame(page).locator('.cm-line').allTextContents()).join('\n'))
    .toBe(text);
}
export async function editFullDocument(page: Page) {
  const frame = editorFrame(page);
  await frame.getByRole('tab', { name: /^(全文|编辑)$/ }).click();
  await expect(editorInput(page)).toHaveAttribute('contenteditable', 'true');
}
export async function swipeBlock(page: Page, block: Locator, direction: 'left' | 'right') {
  await block.scrollIntoViewIfNeeded();
  const bounds = await block.boundingBox();
  if (!bounds) throw new Error('块不可见');
  const x = bounds.x + Math.min(bounds.width * 0.6, 240);
  const y = bounds.y + Math.min(bounds.height / 2, 20);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + (direction === 'left' ? -85 : 85), y, { steps: 8 });
  await page.mouse.up();
}
