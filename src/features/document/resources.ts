/** Resource policy also used by the native host, without loading a DOM parser. */
export const safeImageData = (uri: unknown): uri is string =>
  typeof uri === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z\d+/=]+$/.test(uri);

export function externalLink(url: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}
