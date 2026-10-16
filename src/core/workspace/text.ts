import { contentLimits } from '@/core/agent/settings';
import { AppError } from '@/core/errors';

/** Strict UTF-8 without NUL; extensions do not determine whether bytes are text. */
export function validateText(bytes: Uint8Array): void {
  if (bytes.length > contentLimits.textFileBytes) throw new AppError('LIMIT', '文本超过 1 MB 限制');
  const invalid = () => {
    throw new AppError(
      'VALIDATION',
      '文件必须是 UTF-8 文本且不含 NUL 字节，不支持二进制或其他文本编码。',
    );
  };
  for (let index = 0; index < bytes.length; index++) {
    const first = bytes[index];
    if (first === 0) invalid();
    if (first < 0x80) continue;
    const count =
      first >= 0xc2 && first <= 0xdf
        ? 1
        : first >= 0xe0 && first <= 0xef
          ? 2
          : first >= 0xf0 && first <= 0xf4
            ? 3
            : 0;
    if (!count || index + count >= bytes.length) invalid();
    for (let offset = 1; offset <= count; offset++) {
      const byte = bytes[index + offset];
      const min =
        offset === 1 && first === 0xe0 ? 0xa0 : offset === 1 && first === 0xf0 ? 0x90 : 0x80;
      const max =
        offset === 1 && first === 0xed ? 0x9f : offset === 1 && first === 0xf4 ? 0x8f : 0xbf;
      if (byte < min || byte > max) invalid();
    }
    index += count;
  }
}
