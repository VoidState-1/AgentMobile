import { AppError } from '@/core/errors';
export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

export function imageMimeType(bytes: Uint8Array): ImageMimeType | undefined {
  if (
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
  )
    return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  )
    return 'image/webp';
  return undefined;
}

export function validateImageContent(bytes: Uint8Array): ImageMimeType {
  const mimeType = imageMimeType(bytes);
  if (!mimeType) throw new AppError('VALIDATION', '文件不是支持的 PNG / JPEG / WebP 图片。');
  validateImage(
    mimeType === 'image/png' ? 'image.png' : mimeType === 'image/jpeg' ? 'image.jpg' : 'image.webp',
    bytes,
  );
  return mimeType;
}
/** Header checks avoid decoding unexpected formats and oversized images. */
export function validateImage(path: string, bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const invalid = () => {
    throw new AppError('VALIDATION', '图片不是有效的 PNG / JPEG / WebP');
  };
  const size = (width: number, height: number) => {
    if (!width || !height || width > 16000 || height > 16000 || width * height > 24_000_000) {
      throw new AppError('LIMIT', '图片尺寸过大，请缩小后导入（最多 2400 万像素）');
    }
  };
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.slice(offset, offset + length));
  if (/\.png$/i.test(path)) {
    if (bytes.length < 24 || ascii(1, 3) !== 'PNG' || bytes[0] !== 137 || ascii(12, 4) !== 'IHDR')
      invalid();
    size(view.getUint32(16), view.getUint32(20));
  } else if (/\.jpe?g$/i.test(path)) {
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) invalid();
    let offset = 2;
    let found = false;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 255) break;
      const marker = bytes[offset + 1];
      if (marker === 255) {
        offset++;
        continue;
      }
      if (marker === 217 || marker === 218) break;
      const length = view.getUint16(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) invalid();
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        size(view.getUint16(offset + 7), view.getUint16(offset + 5));
        found = true;
        break;
      }
      offset += 2 + length;
    }
    if (!found) invalid();
  } else if (/\.webp$/i.test(path)) {
    if (bytes.length < 30 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP') invalid();
    const type = ascii(12, 4);
    if (type === 'VP8X') {
      size(
        1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
      );
    } else if (type === 'VP8L') {
      if (bytes[20] !== 47) invalid();
      const bits = view.getUint32(21, true);
      size((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    } else if (type === 'VP8 ') {
      if (bytes[23] !== 157 || bytes[24] !== 1 || bytes[25] !== 42) invalid();
      size(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
    } else invalid();
  } else invalid();
}
