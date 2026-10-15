import type { Page } from '@playwright/test';

/** Fixture inspection of the current schema, independent of UI presentation. */
export async function readCurrentRuns(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('agent-mobile-prototype'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const request = <T>(value: IDBRequest<T>) => new Promise<T>((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
    const headers = await request(db.transaction('run_headers').objectStore('run_headers').getAll());
    const result = [];
    for (const header of headers) {
      const [input, output, launch] = await Promise.all([
        request(db.transaction('run_inputs').objectStore('run_inputs').get(header.id)),
        request(db.transaction('run_results').objectStore('run_results').get(header.id)),
        request(db.transaction('records').objectStore('records').get('run-launches/' + header.launchSnapshotRef)),
      ]);
      result.push({ ...header, ...input, ...output, modelSnapshot: launch?.model, agentSettingsSnapshot: launch?.settings });
    }
    db.close(); return result;
  });
}
