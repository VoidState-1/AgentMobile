import { describeContent, validateTextContent } from '@/core/workspace/content';
import { validateImageContent } from '@/core/workspace/image';
import type { ContentCodec } from '@/core/storage/codec';
import type { ContentPreview } from '@/core/workspace/types';
import { publicError } from '@/core/errors';

/** Presentation budgets never prevent storing/versioning the original bytes. */
export function previewContent(
  path: string,
  bytes: Uint8Array,
  codec: ContentCodec,
): ContentPreview {
  const info = describeContent(path, bytes);
  if (info.kind === 'binary')
    return {
      ...info,
      content: '',
      unavailableReason: '此文件按原始字节保存，当前不支持内容预览，可导出后打开。',
    };
  try {
    if (info.kind === 'image') {
      validateImageContent(bytes);
      return { ...info, content: 'data:' + info.mimeType + ';base64,' + codec.encodeBase64(bytes) };
    }
    validateTextContent(bytes);
    return { ...info, content: codec.decodeText(bytes) };
  } catch (error) {
    return { ...info, content: '', unavailableReason: publicError(error).message };
  }
}
