import { Directory, File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';

import type { CredentialStore, HostFileSystem, MetadataStore } from '@/core/storage/contracts';
import { missing } from './errors';

export async function createStorage(): Promise<{
  fs: HostFileSystem;
  metadata: MetadataStore;
  credentials: CredentialStore;
}> {
  const root = new Directory(Paths.document, 'agent-mobile');
  root.create({ intermediates: true, idempotent: true });
  const uri = (path: string) => root.uri + '/' + path.replace(/^\/+/, '');
  const db = await SQLite.openDatabaseAsync('agent-mobile.sqlite');
  await db.execAsync(
    'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;' +
    'CREATE TABLE IF NOT EXISTS records (bucket TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (bucket, id));' +
    'PRAGMA user_version = 1;',
  );
  const metadata: MetadataStore = {
    async get<T>(bucket: string, id: string) {
      const row = await db.getFirstAsync<{ payload: string }>(
        'SELECT payload FROM records WHERE bucket = ? AND id = ?', bucket, id,
      );
      return row ? JSON.parse(row.payload) as T : undefined;
    },
    async put(bucket, id, value) {
      await db.runAsync(
        'INSERT INTO records (bucket, id, payload) VALUES (?, ?, ?) ON CONFLICT(bucket, id) DO UPDATE SET payload = excluded.payload',
        bucket, id, JSON.stringify(value),
      );
    },
    async all<T>(bucket: string) {
      const rows = await db.getAllAsync<{ payload: string }>('SELECT payload FROM records WHERE bucket = ?', bucket);
      return rows.map((row) => JSON.parse(row.payload) as T);
    },
  };
  const fs: HostFileSystem = {
    async read(path) {
      const file = new File(uri(path));
      if (!file.exists) throw missing(path);
      return file.bytes();
    },
    async write(path, bytes) {
      new Directory(uri(path.slice(0, path.lastIndexOf('/')))).create({ intermediates: true, idempotent: true });
      const file = new File(uri(path));
      file.write(bytes);
    },
    async mkdir(path) {
      new Directory(uri(path)).create({ intermediates: true, idempotent: true });
    },
    async remove(path) {
      const file = new File(uri(path));
      if (file.exists) { file.delete(); return; }
      const directory = new Directory(uri(path));
      if (directory.exists) { directory.delete(); return; }
      throw missing(path);
    },
    async list(path) {
      const directory = new Directory(uri(path));
      if (!directory.exists) throw missing(path);
      return directory.list().map((entry) => entry.name);
    },
    async stat(path) {
      const directory = new Directory(uri(path));
      if (directory.exists) return { kind: 'directory', size: 0, mtime: 0 };
      const file = new File(uri(path));
      if (file.exists) return { kind: 'file', size: file.size, mtime: file.modificationTime ?? 0 };
      throw missing(path);
    },
  };
  return {
    fs, metadata,
    credentials: {
      get: async (reference) => await SecureStore.getItemAsync(credentialName(reference)) ?? '',
      set: async (key, reference) => {
        if (key) await SecureStore.setItemAsync(credentialName(reference), key);
        else await SecureStore.deleteItemAsync(credentialName(reference));
      },
    },
  };
}

function credentialName(reference?: string): string {
  if (!reference) return 'model-api-key';
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(reference)) throw new Error('无效的凭证引用。');
  return 'model-credential.' + reference;
}
