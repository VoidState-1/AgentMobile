import type { BusinessStore } from '@/core/storage/business-store';
import { openWebDatabase, createWebBusinessStore } from './indexeddb-business';
import { AppError } from '@/core/errors';
import type { CredentialStore, HostFileSystem, StorageStat } from '@/core/storage/contracts';
import { missing } from './errors';

interface StoredFile extends StorageStat { path: string; bytes?: Uint8Array }

/** Explicit development rebuild of this app's one IndexedDB instance only. */
export async function rebuildDevelopmentStorage(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('agent-mobile-prototype');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new AppError('STORAGE', '开发实例无法重建。'));
    request.onblocked = () => reject(new AppError('CONFLICT', '请关闭此应用的其他页面，再重建开发数据。'));
  });
}

export async function createStorage(): Promise<{
  fs: HostFileSystem;
  metadata: BusinessStore;
  credentials: CredentialStore;
}> {
  const db = await openWebDatabase();
  function transact<T>(store: string, mode: IDBTransactionMode, action: (target: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      const request = action(transaction.objectStore(store));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new AppError('STORAGE', '浏览器存储操作中断'));
    });
  }
  const metadata = await createWebBusinessStore(db);
  const getFile = async (path: string): Promise<StoredFile> => {
    const file = await transact('files', 'readonly', (store) => store.get(path)) as StoredFile | undefined;
    if (!file) throw missing(path);
    return file;
  };
  const mkdir = async (path: string): Promise<void> => {
    const parts = path.split('/').filter(Boolean);
    for (let index = 0; index <= parts.length; index++) {
      const current = '/' + parts.slice(0, index).join('/');
      let existing: StoredFile | undefined;
      try { existing = await getFile(current); } catch (error) {
        if ((error as { code?: string }).code !== 'ENOENT') throw error;
      }
      if (existing?.kind === 'file') throw new AppError('VALIDATION', '父路径是文件');
      if (!existing) await transact('files', 'readwrite', (store) => store.put({
        path: current, kind: 'directory', size: 0, mtime: Date.now(), contentVersion: crypto.randomUUID(),
      }));
    }
  };
  const fs: HostFileSystem = {
    async read(path) {
      const file = await getFile(path);
      if (!file.bytes) throw new AppError('STORAGE', '无法读取目录');
      return new Uint8Array(file.bytes);
    },
    async write(path, bytes) {
      await mkdir(path.slice(0, path.lastIndexOf('/')));
      await transact('files', 'readwrite', (store) => store.put({
        path, kind: 'file', size: bytes.length, mtime: Date.now(), contentVersion: crypto.randomUUID(), bytes: new Uint8Array(bytes),
      }));
    },
    mkdir,
    async remove(path) {
      await getFile(path);
      await transact('files', 'readwrite', (store) => store.delete(path));
    },
    async list(path) {
      await getFile(path);
      const prefix = path === '/' ? '/' : path + '/';
      const end = prefix.slice(0, -1) + '0';
      const keys = await transact('files', 'readonly', store => store.getAllKeys(IDBKeyRange.bound(prefix, end, false, true)));
      return keys.map(String).filter((key) => key.startsWith(prefix) && key !== path)
        .map((key) => key.slice(prefix.length)).filter((key) => !key.includes('/'));
    },
    async stat(path) {
      // Key cursor reads only the index tuple, never clones a large image blob.
      const cursor = await transact('files', 'readonly', store => store.index('stat')
        .openKeyCursor(IDBKeyRange.bound([path], [path, []])));
      if (!cursor) throw missing(path);
      const [, kind, size, mtime, contentVersion] = cursor.key as [string, StorageStat['kind'], number, number, string];
      return { kind, size, mtime, contentVersion };
    },
  };
  const sessionKeys = new Map<string, string>();
  return {
    fs, metadata,
    credentials: { get: async reference => sessionKeys.get(reference) ?? '',
      set: async (value, reference) => { if (value) sessionKeys.set(reference, value); else sessionKeys.delete(reference); } },
  };
}
