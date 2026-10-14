import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { HostFileSystem, MetadataStore } from '../src/core/storage/contracts';

export async function testStorage() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-mobile-'));
  const records = new Map<string, unknown>();
  const resolve = (internal: string) => path.join(root, internal.replace(/^\/+/, ''));
  const metadata: MetadataStore = {
    batch: async (entries) => {
      const copies = entries.map((entry) => [entry.bucket + '/' + entry.id, structuredClone(entry.value)] as const);
      for (const [key, value] of copies) records.set(key, value);
    },
    get: async <T>(bucket: string, id: string) => structuredClone(records.get(bucket + '/' + id)) as T | undefined,
    put: async (bucket, id, value) => { records.set(bucket + '/' + id, structuredClone(value)); },
    all: async <T>(bucket: string) => [...records.entries()].filter(([key]) => key.startsWith(bucket + '/')).map(([, value]) => structuredClone(value) as T),
  };
  const files: HostFileSystem = {
    read: async (file) => new Uint8Array(await fs.readFile(resolve(file))),
    write: async (file, bytes) => {
      await fs.mkdir(path.dirname(resolve(file)), { recursive: true });
      await fs.writeFile(resolve(file), bytes);
    },
    mkdir: async (directory) => { await fs.mkdir(resolve(directory), { recursive: true }); },
    remove: async (file) => { await fs.rm(resolve(file), { recursive: true }); },
    list: (directory) => fs.readdir(resolve(directory)),
    stat: async (file) => {
      const value = await fs.lstat(resolve(file));
      if (value.isSymbolicLink()) throw new Error('符号链接不可访问');
      return { kind: value.isDirectory() ? 'directory' : 'file', size: value.size, mtime: value.mtimeMs };
    },
  };
  return { root, records, metadata, files, resolve, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}
