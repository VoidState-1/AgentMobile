import { zlibSync } from 'fflate';

// Real PNGs with independent random RGBA pixels, padded to an exact byte size.
// Measures byte transfer and actual image decoding, not only synthetic headers.
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function chunk(type, data) {
  const bytes = new Uint8Array(data.length + 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(new TextEncoder().encode(type), 4);
  bytes.set(data, 8);
  let crc = 0xffffffff;
  for (let index = 4; index < bytes.length - 4; index++)
    crc = crcTable[(crc ^ bytes[index]) & 255] ^ (crc >>> 8);
  view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0);
  return bytes;
}
export function measurementImage(size) {
  const width = size === 4 * 1024 * 1024 ? 1024 : 2048;
  const height = size === 4 * 1024 * 1024 ? 1020 : 2550;
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let offset = 0; offset < raw.length; offset += 65536)
    crypto.getRandomValues(raw.subarray(offset, Math.min(raw.length, offset + 65536)));
  for (let row = 0; row < height; row++) raw[row * (width * 4 + 1)] = 0; // PNG filter: none.
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  const chunks = [chunk('IHDR', header), chunk('IDAT', zlibSync(raw, { level: 0 }))];
  const remaining = size - 8 - chunks.reduce((sum, item) => sum + item.length, 0) - 12;
  if (remaining < 12) throw new Error('PNG sample exceeds its target size');
  chunks.push(chunk('paDd', new Uint8Array(remaining - 12)), chunk('IEND', new Uint8Array()));
  const image = new Uint8Array(size);
  image.set([137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  for (const value of chunks) {
    image.set(value, offset);
    offset += value.length;
  }
  if (offset !== size) throw new Error('PNG sample length mismatch');
  return image;
}
