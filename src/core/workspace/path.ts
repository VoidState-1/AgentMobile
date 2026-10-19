import { AppError } from '@/core/errors';
export function safePath(input: string, allowRoot = false): string {
  if (allowRoot && input === '') return '';
  const path = input;
  if (
    !path ||
    path !== path.trim() ||
    /[\\:\u0000-\u001f\u007f]/.test(path) ||
    path.startsWith('/') ||
    path
      .split('/')
      .some(
        part =>
          !part ||
          part === '.' ||
          part === '..' ||
          part.toLowerCase() === '.git' ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part),
      )
  ) {
    throw new AppError('VALIDATION', 'INVALID_PATH：请使用工作区内的相对路径。');
  }
  return path;
}

export function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

export function mimeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const images: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
  };
  return ext && Object.hasOwn(images, ext)
    ? images[ext]
    : isMarkdown(path)
      ? 'text/markdown'
      : 'application/octet-stream';
}

export function isImage(path: string): boolean {
  return mimeFor(path).startsWith('image/');
}
