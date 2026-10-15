import type { BusinessStore } from '@/core/storage/business-store';
import { createSqliteBusinessStore } from './sqlite-business';
import { randomUUID } from 'expo-crypto';
import { AppError } from '@/core/errors';
import { Directory, File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';

import type { CredentialStore, HostFileSystem } from '@/core/storage/contracts';
import { missing } from './errors';

/** Called only while bootstrap is blocked on a format mismatch, with no kernel. */
export async function rebuildDevelopmentStorage(): Promise<void> {
  const root = new Directory(Paths.document, 'agent-mobile');
  if (root.uri.replace(/\/+$/, '') !== Paths.document.uri.replace(/\/+$/, '') + '/agent-mobile')
    throw new AppError('STORAGE', '开发实例目录校验失败。');
  // Outside the deleted tree: interrupted rebuild cannot start a partially reset
  // instance. Re-entering the same explicit rebuild finishes it idempotently.
  const marker = new File(Paths.document, 'agent-mobile-rebuild.pending');
  marker.write('pending');
  // SQLite exposes a native path; Expo FileSystem constructors require a URI.
  const databaseDirectory = SQLite.defaultDatabaseDirectory;
  const database = new File(
    databaseDirectory.startsWith('file:') ? databaseDirectory : 'file://' + databaseDirectory,
    'agent-mobile.sqlite',
  );
  try {
    if (database.exists) await SQLite.deleteDatabaseAsync('agent-mobile.sqlite');
  } catch {
    throw new AppError('STORAGE', '开发数据库无法删除，请重新打开应用后再次重建。');
  }
  try {
    if (root.exists) root.delete();
  } catch {
    throw new AppError('STORAGE', '开发工作区无法删除，请重新打开应用后再次重建。');
  }
  try {
    marker.delete();
  } catch {
    throw new AppError('STORAGE', '开发重建标记无法清除，请再次完成重建。');
  }
  // SecureStore is intentionally outside the development data scope.
}

export async function createStorage(): Promise<{
  fs: HostFileSystem;
  metadata: BusinessStore;
  credentials: CredentialStore;
}> {
  if (new File(Paths.document, 'agent-mobile-rebuild.pending').exists)
    throw new AppError('DATA_FORMAT', '开发数据重建曾中断，请完成重建后再打开应用。');
  const root = new Directory(Paths.document, 'agent-mobile');
  root.create({ intermediates: true, idempotent: true });
  const uri = (path: string) =>
    root.uri.replace(/\/+$/, '') +
    '/' +
    path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
  const db = await SQLite.openDatabaseAsync('agent-mobile.sqlite');
  let metadata: BusinessStore;
  try {
    metadata = await createSqliteBusinessStore(db, randomUUID);
  } catch (error) {
    await db.closeAsync();
    throw error;
  }
  const fs: HostFileSystem = {
    async read(path) {
      const file = new File(uri(path));
      if (!file.exists) throw missing(path);
      return file.bytes();
    },
    async write(path, bytes) {
      new Directory(uri(path.slice(0, path.lastIndexOf('/')))).create({
        intermediates: true,
        idempotent: true,
      });
      const file = new File(uri(path));
      file.write(bytes);
    },
    async mkdir(path) {
      new Directory(uri(path)).create({ intermediates: true, idempotent: true });
    },
    async remove(path) {
      const file = new File(uri(path));
      if (file.exists) {
        file.delete();
        return;
      }
      const directory = new Directory(uri(path));
      if (directory.exists) {
        directory.delete();
        return;
      }
      throw missing(path);
    },
    async list(path) {
      const directory = new Directory(uri(path));
      if (!directory.exists) throw missing(path);
      return directory.list().map(entry => entry.name);
    },
    async stat(path) {
      const directory = new Directory(uri(path));
      if (directory.exists) return { kind: 'directory', size: 0, mtime: 0 };
      const file = new File(uri(path));
      if (file.exists) return { kind: 'file', size: file.size, mtime: file.modificationTime ?? 0 };
      throw missing(path);
    },
    async contentStamp(path) {
      // Native hashing still reads the file. It avoids a JS byte/base64 copy,
      // and provides content evidence even for equal mtime/size edits.
      const file = new File(uri(path));
      if (!file.exists) throw missing(path);
      return file.md5 ?? undefined;
    },
  };
  return {
    fs,
    metadata,
    credentials: {
      get: async reference => (await SecureStore.getItemAsync(credentialName(reference))) ?? '',
      set: async (key, reference) => {
        if (key) await SecureStore.setItemAsync(credentialName(reference), key);
        else await SecureStore.deleteItemAsync(credentialName(reference));
      },
    },
  };
}

function credentialName(reference: string): string {
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(reference))
    throw new AppError('VALIDATION', '无效的凭证引用。');
  return 'model-credential.' + reference;
}
