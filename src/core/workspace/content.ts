import { AppError } from '@/core/errors';
import { imageMimeType } from './image';
import { isMarkdown } from './path';
import { isUtf8Text, validateText } from './text';
import type { FileKind } from './types';

export function describeContent(
  path: string,
  bytes: Uint8Array,
): { kind: FileKind; mimeType: string } {
  const image = imageMimeType(bytes);
  if (image) return { kind: 'image', mimeType: image };
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-')
    return { kind: 'binary', mimeType: 'application/pdf' };
  if (isUtf8Text(bytes))
    return { kind: 'text', mimeType: isMarkdown(path) ? 'text/markdown' : 'text/plain' };
  return { kind: 'binary', mimeType: 'application/octet-stream' };
}

/** Text editing policy; raw storage deliberately does not call this. */
export function validateTextContent(bytes: Uint8Array): void {
  validateText(bytes);
  if (describeContent('', bytes).kind !== 'text')
    throw new AppError('VALIDATION', '当前文件不是可编辑的 UTF-8 文本。');
}
