import { Buffer } from 'buffer';
import type { ContentCodec } from '@/core/storage/codec';

export const contentCodec: ContentCodec = {
  encodeText: text => new Uint8Array(Buffer.from(text, 'utf8')),
  decodeText: bytes => Buffer.from(bytes).toString('utf8'),
  encodeBase64: bytes => Buffer.from(bytes).toString('base64'),
  decodeBase64: text => new Uint8Array(Buffer.from(text, 'base64')),
  encodeHex: bytes => Buffer.from(bytes).toString('hex'),
};
