import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { sourceModule } from './source-module.mjs';

const storage = await sourceModule('src/adapters/storage/indexeddb-business.ts');
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-precise-memory-info'] });
try {
  const context = await browser.newContext(); const page = await context.newPage();
  // A fresh browser context isolates the benchmark from the developer instance.
  await page.goto(process.env.PREVIEW_URL ?? 'http://localhost:4180');
  const result = await page.evaluate(async url => {
    const module = await import(url); const name = 'range-fixture-' + crypto.randomUUID();
    const current = await module.openWebDatabase(name); const metadata = await module.createWebBusinessStore(current);
    const unrelated = Array.from({ length: 32 }, (_, id) => ({ bucket: 'large-body', id: String(id), value: { text: String(id) + 'x'.repeat(128 * 1024) } }));
    const selected = Array.from({ length: 3000 }, (_, id) => ({ bucket: 'summaries', id: String(id), value: { id, projectId: 'benchmark', state: 'completed', preview: '摘要 ' + id } }));
    await metadata.batch([...unrelated, ...selected]);
    const queries = []; const original = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function(range, ...args) { queries.push({ lower: range?.lower, upper: range?.upper }); return original.call(this, range, ...args); };
    const durations = [];
    for (let round = 0; round < 5; round++) {
      const start = performance.now(); const records = await metadata.all('summaries');
      durations.push(performance.now() - start);
      if (records.length !== 3000 || records.some(record => record.text)) throw new Error('bucket isolation failed');
    }
    const baseline = [];
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    for (let round = 0; round < 5; round++) {
      const start = performance.now();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction('records'); const store = transaction.objectStore('records');
        const keys = store.getAllKeys(); const values = store.getAll();
        transaction.oncomplete = () => { values.result.filter((_, index) => String(keys.result[index]).startsWith('summaries/')); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      });
      baseline.push(performance.now() - start);
    }
    db.close();
    // Unicode IDs and prefix-adjacent buckets must remain isolated.
    await metadata.put('sample', '\u{10ffff}', { id: 'unicode' });
    await metadata.put('sample-other', 'a', { id: 'other' });
    if ((await metadata.all('sample')).length !== 1) throw new Error('range boundary failed');
    current.close();
    return { durations, baseline, queries, heapBytes: performance.memory?.usedJSHeapSize, rows: selected.length,
      unrelatedPayloadBytes: unrelated.reduce((sum, row) => sum + row.value.text.length, 0) };
  }, storage);
  result.durations.sort((a, b) => a - b);
  result.medianMs = result.durations[2]; result.maxMs = result.durations.at(-1);
  result.runtime = { browser: browser.version(), platform: process.platform, architecture: process.arch };
  await fs.mkdir('work/validation', { recursive: true });
  await fs.writeFile('work/validation/storage-range.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
