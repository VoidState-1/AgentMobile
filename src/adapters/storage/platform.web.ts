import type { CredentialStore, HostFileSystem, MetadataStore, StorageStat } from '@/core/storage/contracts';
import { missing } from './errors';

interface StoredFile extends StorageStat { path: string; bytes?: Uint8Array }

export async function createStorage(): Promise<{
  fs: HostFileSystem;
  metadata: MetadataStore;
  credentials: CredentialStore;
}> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('agent-mobile-prototype', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('records');
      request.result.createObjectStore('files', { keyPath: 'path' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  function transact<T>(store: string, mode: IDBTransactionMode, action: (target: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      const request = action(transaction.objectStore(store));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('浏览器存储操作中断'));
    });
  }
  const metadata: MetadataStore = {
    async get<T>(bucket: string, id: string) {
      return await transact('records', 'readonly', (store) => store.get(bucket + '/' + id)) as T | undefined;
    },
    async put(bucket, id, value) {
      await transact('records', 'readwrite', (store) => store.put(value, bucket + '/' + id));
    },
    async all<T>(bucket: string) {
      const pairs = await new Promise<{ keys: IDBValidKey[]; values: T[] }>((resolve, reject) => {
        const transaction = db.transaction('records', 'readonly');
        const store = transaction.objectStore('records');
        const keys = store.getAllKeys();
        const values = store.getAll();
        transaction.oncomplete = () => resolve({ keys: keys.result, values: values.result });
        transaction.onerror = () => reject(transaction.error);
      });
      return pairs.values.filter((_, index) => String(pairs.keys[index]).startsWith(bucket + '/'));
    },
  };
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
      if (existing?.kind === 'file') throw new Error('父路径是文件');
      if (!existing) await transact('files', 'readwrite', (store) => store.put({
        path: current, kind: 'directory', size: 0, mtime: Date.now(),
      }));
    }
  };
  const fs: HostFileSystem = {
    async read(path) {
      const file = await getFile(path);
      if (!file.bytes) throw new Error('无法读取目录');
      return new Uint8Array(file.bytes);
    },
    async write(path, bytes) {
      await mkdir(path.slice(0, path.lastIndexOf('/')));
      await transact('files', 'readwrite', (store) => store.put({
        path, kind: 'file', size: bytes.length, mtime: Date.now(), bytes: new Uint8Array(bytes),
      }));
    },
    mkdir,
    async remove(path) {
      await getFile(path);
      await transact('files', 'readwrite', (store) => store.delete(path));
    },
    async list(path) {
      await getFile(path);
      const keys = await transact('files', 'readonly', (store) => store.getAllKeys());
      const prefix = path === '/' ? '/' : path + '/';
      return keys.map(String).filter((key) => key.startsWith(prefix) && key !== path)
        .map((key) => key.slice(prefix.length)).filter((key) => !key.includes('/'));
    },
    async stat(path) {
      const { kind, size, mtime } = await getFile(path);
      return { kind, size, mtime };
    },
  };
  let sessionKey = '';
  return {
    fs, metadata,
    credentials: { get: async () => sessionKey, set: async (value) => { sessionKey = value; } },
  };
}
