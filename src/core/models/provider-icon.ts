import { AppError } from '@/core/errors';
import type { ContentCodec } from '@/core/storage/codec';
import { validateImage } from '@/core/workspace/image';
import type { ProviderIcon } from './types';

export const providerIconMaxBytes = 256 * 1024;
const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const;

function validateBytes(name: string, bytes: Uint8Array) {
  if (bytes.byteLength > providerIconMaxBytes)
    throw new AppError('LIMIT', '供应商图标最大为 256 KB，请缩小图片后上传。');
  validateImage(name, bytes);
}

export function createProviderIcon(
  file: { name: string; bytes: Uint8Array },
  codec: ContentCodec,
): ProviderIcon {
  validateBytes(file.name, file.bytes);
  const mediaType = /\.png$/i.test(file.name)
    ? 'image/png'
    : /\.jpe?g$/i.test(file.name)
      ? 'image/jpeg'
      : 'image/webp';
  return { mediaType, base64: codec.encodeBase64(file.bytes) };
}

export function validateProviderIcon(icon: ProviderIcon | undefined, codec: ContentCodec): void {
  if (icon === undefined) return;
  if (!icon || !Object.hasOwn(extensions, icon.mediaType) || typeof icon.base64 !== 'string')
    throw new AppError('VALIDATION', '供应商图标需要 PNG、JPEG 或 WebP 图片。');
  if (icon.base64.length > Math.ceil(providerIconMaxBytes / 3) * 4)
    throw new AppError('LIMIT', '供应商图标最大为 256 KB，请缩小图片后上传。');
  const bytes = codec.decodeBase64(icon.base64);
  if (codec.encodeBase64(bytes) !== icon.base64)
    throw new AppError('VALIDATION', '供应商图标数据无效，请重新上传。');
  validateBytes('icon.' + extensions[icon.mediaType], bytes);
}
