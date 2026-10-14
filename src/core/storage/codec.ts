/** Encoding is supplied by the host; application code handles plain bytes. */
export interface ContentCodec {
  encodeText(text: string): Uint8Array;
  decodeText(bytes: Uint8Array): string;
  encodeBase64(bytes: Uint8Array): string;
  decodeBase64(text: string): Uint8Array;
  encodeHex(bytes: Uint8Array): string;
}
