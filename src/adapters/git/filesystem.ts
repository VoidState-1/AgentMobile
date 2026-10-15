import { AppError } from '@/core/errors';
import { Buffer } from 'buffer';
import type { HostFileSystem } from '@/core/storage/contracts';

export function gitFileSystem(fs: HostFileSystem) {
  const stat = async (path: string) => {
    const value = await fs.stat(path);
    return {
      size: value.size, mode: value.kind === 'directory' ? 0o40755 : 0o100644,
      mtimeMs: value.mtime, ctimeMs: value.mtime, ino: 0, uid: 0, gid: 0, dev: 0,
      isFile: () => value.kind === 'file',
      isDirectory: () => value.kind === 'directory',
      isSymbolicLink: () => false,
    };
  };
  return {
    promises: {
      async readFile(path: string, options?: string | { encoding?: string }) {
        const bytes = Buffer.from(await fs.read(path));
        return (typeof options === 'string' ? options : options?.encoding) ? bytes.toString('utf8') : bytes;
      },
      async writeFile(path: string, data: string | Uint8Array) {
        await fs.write(path, typeof data === 'string' ? Buffer.from(data) : data);
      },
      mkdir: fs.mkdir, unlink: fs.remove, rmdir: fs.remove, readdir: fs.list, stat, lstat: stat,
      async readlink() { throw new AppError('VALIDATION', '不支持符号链接'); },
      async symlink() { throw new AppError('VALIDATION', '不支持符号链接'); },
      async chmod() { /* Private files only; symlinks and executables are not supported. */ },
    },
  };
}
