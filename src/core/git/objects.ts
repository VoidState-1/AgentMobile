import type { StorageStat } from '../storage/contracts';
import { AppError } from '../errors';

export interface GitEntry {
  revision: string;
  mode: number;
}
export type GitTree = Record<string, GitEntry>;
export function cloneTree(tree: GitTree): GitTree {
  return Object.assign(Object.create(null), tree);
}
export function assertTreeShape(tree: GitTree): void {
  for (const path of Object.keys(tree)) {
    const parts = path.split('/');
    parts.pop();
    while (parts.length) {
      if (Object.hasOwn(tree, parts.join('/')))
        throw new AppError('CONFLICT', '文件与目录路径冲突，请先处理未跟踪或忽略的内容。');
      parts.pop();
    }
  }
}
export const gitModes = {
  file: 0o100644,
  executable: 0o100755,
  symlink: 0o120000,
  gitlink: 0o160000,
} as const;
export function sameEntry(
  left: GitEntry | null | undefined,
  right: GitEntry | null | undefined,
): boolean {
  return left?.revision === right?.revision && left?.mode === right?.mode;
}
export function storageMode(info: StorageStat): number {
  return info.kind === 'symlink'
    ? gitModes.symlink
    : info.mode && info.mode & 0o100
      ? gitModes.executable
      : gitModes.file;
}
