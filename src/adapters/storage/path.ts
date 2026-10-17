import { AppError } from '@/core/errors';

/** Host-only logical paths may contain .git, but must stay inside the adapter root. */
export function storagePath(path: string): string[] {
  if (path === '/') return [];
  if (!path.startsWith('/') || /[\\:\u0000-\u001f\u007f]/.test(path))
    throw new AppError('VALIDATION', '存储路径无效。');
  const parts = path.slice(1).split('/');
  if (parts.some(part => !part || part === '.' || part === '..'))
    throw new AppError('VALIDATION', '存储路径不能越出应用工作区。');
  return parts;
}
