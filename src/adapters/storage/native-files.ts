import type { HostFileSystem } from '@/core/storage/contracts';
import { AppError } from '@/core/errors';
import { contentCodec } from './codec';
import { storagePath } from './path';

type NativeCall = <T>(
  projectId: string,
  method: string,
  input?: Record<string, unknown>,
) => Promise<T>;

/** Only repository content crosses this boundary; Git internals remain inside the module. */
export function createNativeFileSystem(call: NativeCall): HostFileSystem {
  function scope(path: string) {
    const [area, projectId, folder, ...parts] = storagePath(path);
    if (
      area !== 'workspaces' ||
      folder !== 'repository' ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(projectId ?? '') ||
      parts.some(part => part.toLowerCase() === '.git')
    )
      throw new AppError('VALIDATION', '文件必须位于已授权项目的正文目录。');
    return { projectId, path: parts.join('/') };
  }
  return {
    read: async path => {
      const target = scope(path);
      return contentCodec.decodeBase64(
        await call(target.projectId, 'fileRead', { path: target.path }),
      );
    },
    write: async (path, bytes) => {
      const target = scope(path);
      await call(target.projectId, 'fileWrite', {
        path: target.path,
        bytes: contentCodec.encodeBase64(bytes),
      });
    },
    mkdir: async path => {
      const target = scope(path);
      await call(target.projectId, 'fileMkdir', { path: target.path });
    },
    remove: async path => {
      const target = scope(path);
      await call(target.projectId, 'fileRemove', { path: target.path });
    },
    list: async path => {
      const target = scope(path);
      return call(target.projectId, 'fileList', { path: target.path });
    },
    stat: async path => {
      const target = scope(path);
      return call(target.projectId, 'fileStat', { path: target.path });
    },
    contentStamp: async path => {
      const target = scope(path);
      return call(target.projectId, 'fileStamp', { path: target.path });
    },
    moveFile: async (from, to) => {
      const source = scope(from),
        target = scope(to);
      if (source.projectId !== target.projectId)
        throw new AppError('VALIDATION', '不能跨项目移动文件。');
      await call(source.projectId, 'fileMove', { path: source.path, to: target.path });
    },
  };
}
