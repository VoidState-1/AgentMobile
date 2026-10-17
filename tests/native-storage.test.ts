import { beforeEach, expect, it, vi } from 'vitest';
import { createStorage } from '../src/adapters/storage/platform';
import { gitFileSystem } from '../src/adapters/git/filesystem';

const native = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  directories: new Set<string>(),
  read: vi.fn(),
  write: vi.fn(),
  move: vi.fn(),
}));
vi.mock('expo-file-system', () => {
  const uri = (parts: (string | { uri: string })[]) => {
    const [first, ...rest] = parts.map(part => (typeof part === 'string' ? part : part.uri));
    return (
      first.replace(/\/+$/, '') + rest.map(part => '/' + part.replace(/^\/+|\/+$/g, '')).join('')
    );
  };
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = uri(parts);
    }
    get exists() {
      return native.files.has(this.uri);
    }
    get size() {
      return native.files.get(this.uri)?.length ?? 0;
    }
    get md5() {
      return 'content';
    }
    async bytes() {
      native.read(this.uri);
      return native.files.get(this.uri)!.slice();
    }
    write(bytes: Uint8Array) {
      native.write(this.uri);
      native.files.set(this.uri, bytes.slice());
    }
    async move(target: File, options: { overwrite: boolean }) {
      native.move(this.uri, target.uri, options);
      native.files.set(target.uri, native.files.get(this.uri)!);
      native.files.delete(this.uri);
      this.uri = target.uri;
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = uri(parts);
    }
    get exists() {
      return native.directories.has(this.uri);
    }
    create() {
      native.directories.add(this.uri);
    }
  }
  return { File, Directory, Paths: { document: { uri: 'file:///app/Documents/' } } };
});
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => ({}) }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'native-fixture' }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock('../src/adapters/storage/sqlite-business', () => ({
  createSqliteBusinessStore: async () => ({ dataInstanceId: 'native-fixture' }),
}));

beforeEach(() => {
  native.files.clear();
  native.directories.clear();
  vi.clearAllMocks();
});

it('原生适配直接调用 File.move 且不覆盖目标，不通过 JS 读取和写回移动正文（SDK 契约模拟）', async () => {
  const { fs } = await createStorage();
  const from = '/workspaces/project/repository/file.bin';
  const to = '/workspaces/project/repository/new/file.bin';
  await fs.write(from, new Uint8Array([0, 1, 255]));
  const writes = native.write.mock.calls.length;
  await fs.moveFile(from, to);
  expect(native.move).toHaveBeenCalledWith(
    'file:///app/Documents/agent-mobile' + from,
    'file:///app/Documents/agent-mobile' + to,
    { overwrite: false },
  );
  expect(native.read).not.toHaveBeenCalled();
  expect(native.write).toHaveBeenCalledTimes(writes);
  expect(await fs.read(to)).toEqual(new Uint8Array([0, 1, 255]));
  await fs.write(from, new Uint8Array([9]));
  await expect(fs.moveFile(from, to)).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(native.move).toHaveBeenCalledTimes(1);
});

it('原生根目录映射拒绝越界，不支持的权限操作明确失败（SDK 契约模拟）', async () => {
  const { fs } = await createStorage();
  for (const path of ['/workspaces/../../secret', 'file:///secret', '/a\\b', '/a//b'])
    await expect(fs.write(path, new Uint8Array([1]))).rejects.toMatchObject({ code: 'VALIDATION' });
  expect(native.write).not.toHaveBeenCalled();
  await expect(gitFileSystem(fs).promises.chmod()).rejects.toThrow('不支持修改文件权限');
  await expect(gitFileSystem(fs).promises.symlink()).rejects.toThrow('不支持符号链接');
});
