import { expect, test } from '@playwright/test';

test('旧开发格式阻断启动；确认重建前数据保留，确认后只清理本应用实例', async ({ page }) => {
  await page.route('**/_expo/static/js/**', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto('/');
  await page.evaluate(async () => {
    for (const name of ['agent-mobile-prototype', 'other-app-fixture']) await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('records').put({ privateText: 'fixture-only' }, 'marker');
      };
      request.onsuccess = () => { request.result.close(); resolve(); };
      request.onerror = () => reject(request.error);
    });
  });
  await page.unroute('**/_expo/static/js/**'); await page.reload();
  await expect(page.getByText('开发数据需要重建', { exact: true })).toBeVisible();
  const retained = async (name: string) => page.evaluate(async databaseName => {
    const request = indexedDB.open(databaseName);
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const marker = db.transaction('records').objectStore('records').get('marker');
    const value = await new Promise<unknown>((resolve, reject) => { marker.onsuccess = () => resolve(marker.result); marker.onerror = () => reject(marker.error); });
    db.close(); return value;
  }, name);
  await page.getByRole('button', { name: '重建开发数据', exact: true }).click();
  expect(await retained('agent-mobile-prototype')).toMatchObject({ privateText: 'fixture-only' });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect(await retained('agent-mobile-prototype')).toBeDefined();
  await page.getByRole('button', { name: '重建开发数据', exact: true }).click();
  await page.getByRole('button', { name: '确认重建开发数据', exact: true }).click();
  await expect(page.getByText('创建你的第一个项目', { exact: true })).toBeVisible();
  expect(await retained('agent-mobile-prototype')).toBeUndefined();
  expect(await retained('other-app-fixture')).toMatchObject({ privateText: 'fixture-only' });
});
