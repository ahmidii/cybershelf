const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ORIENTATION_ERROR = 'The image orientation metadata is invalid or ambiguous. Export it as a new image and try again.';

/** Read only the primary image's inline SHORT orientation. Never follow EXIF,
 * GPS, maker-note, or thumbnail pointers. Work is bounded by the input length. */
function exifOrientation(payload: Uint8Array, allowPrefix: boolean): number {
  const prefix = allowPrefix && payload.length >= 6 && payload[0] === 69 && payload[1] === 120 && payload[2] === 105 && payload[3] === 102 && payload[4] === 0 && payload[5] === 0 ? 6 : 0;
  const tiff = payload.subarray(prefix);
  if (tiff.length < 14) throw new Error(ORIENTATION_ERROR);
  const little = tiff[0] === 73 && tiff[1] === 73;
  if (!little && !(tiff[0] === 77 && tiff[1] === 77)) throw new Error(ORIENTATION_ERROR);
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  if (view.getUint16(2, little) !== 42) throw new Error(ORIENTATION_ERROR);
  const first = view.getUint32(4, little);
  if (first < 8 || first > tiff.length - 2) throw new Error(ORIENTATION_ERROR);
  const count = view.getUint16(first, little);
  if (first + 2 + count * 12 + 4 > tiff.length) throw new Error(ORIENTATION_ERROR);
  let orientation: number | undefined;
  for (let index = 0; index < count; index++) {
    const entry = first + 2 + index * 12;
    if (view.getUint16(entry, little) !== 0x0112) continue;
    if (orientation !== undefined || view.getUint16(entry + 2, little) !== 3 || view.getUint32(entry + 4, little) !== 1) throw new Error(ORIENTATION_ERROR);
    orientation = view.getUint16(entry + 8, little);
    if (orientation < 1 || orientation > 8) throw new Error(ORIENTATION_ERROR);
  }
  return orientation ?? 1;
}

/** A new 26-byte TIFF record containing exactly one tag and no linked IFDs. */
function orientationTiff(orientation: number): Uint8Array {
  return new Uint8Array([73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
function pngOrientation(orientation: number): Uint8Array {
  const bytes = new Uint8Array(38), view = new DataView(bytes.buffer);
  view.setUint32(0, 26); bytes.set([101, 88, 73, 102], 4); bytes.set(orientationTiff(orientation), 8);
  view.setUint32(34, crc32(bytes.subarray(4, 34)));
  return bytes;
}
function webpChunk(type: string, payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(8 + payload.length + payload.length % 2);
  for (let index = 0; index < 4; index++) bytes[index] = type.charCodeAt(index);
  new DataView(bytes.buffer).setUint32(4, payload.length, true); bytes.set(payload, 8);
  return bytes;
}

/** Bounded parsers for raster uploads. Shared copies discard original EXIF,
 * XMP, text and thumbnails, rebuilding only a needed orientation marker.
 * Private originals are untouched; dimensions describe the displayed image. */
export function prepareSharedImage(input: Uint8Array, mime: string): { bytes: Uint8Array; width: number; height: number } {
  if (!input.length || input.length > MAX_IMAGE_BYTES) throw new Error('Choose an image up to 4 MB.');
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const text = (start: number, end: number) => String.fromCharCode(...input.subarray(start, end));
  let width = 0, height = 0, orientation = 1, seenExif = false;
  const chunks: Uint8Array[] = [];
  const readExif = (payload: Uint8Array, allowPrefix: boolean) => {
    if (seenExif) throw new Error(ORIENTATION_ERROR);
    seenExif = true; orientation = exifOrientation(payload, allowPrefix);
  };
  if (mime === 'image/png') {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (input.length < 45 || !signature.every((byte, index) => input[index] === byte) || text(12, 16) !== 'IHDR' || view.getUint32(8) !== 13) throw new Error('The PNG image is incomplete.');
    width = view.getUint32(16); height = view.getUint32(20); chunks.push(input.subarray(0, 8));
    let offset = 8, ended = false, data = false;
    const keep = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'sRGB', 'gAMA', 'cHRM', 'sBIT']);
    while (offset + 12 <= input.length) {
      const length = view.getUint32(offset), type = text(offset + 4, offset + 8), end = offset + length + 12;
      if (end > input.length || (type === 'IHDR' && offset !== 8)) throw new Error('The PNG image is incomplete.');
      if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') throw new Error('Choose a still image for the shared shelf collection.');
      if (type === 'eXIf') {
        if (view.getUint32(end - 4) !== crc32(input.subarray(offset + 4, end - 4))) throw new Error(ORIENTATION_ERROR);
        readExif(input.subarray(offset + 8, end - 4), false);
      } else if (keep.has(type)) chunks.push(input.subarray(offset, end));
      else if (!/^[a-z]/.test(type)) throw new Error('This PNG uses an unsupported image format.');
      if (type === 'IDAT') data = true;
      offset = end;
      if (type === 'IEND') { ended = length === 0; break; }
    }
    if (!ended || !data) throw new Error('The PNG image is incomplete.');
    // Put the canonical marker before image data even if the original was late.
    if (orientation > 1) chunks.splice(2, 0, pngOrientation(orientation));
  } else if (mime === 'image/jpeg') {
    if (input[0] !== 255 || input[1] !== 216) throw new Error('The JPEG image is incomplete.');
    chunks.push(input.subarray(0, 2)); let offset = 2, ended = false, scan = false;
    while (offset < input.length) {
      const begin = offset;
      if (input[offset++] !== 255) throw new Error('The JPEG image is incomplete.');
      while (input[offset] === 255) offset++;
      const marker = input[offset++];
      if (marker === 217) { chunks.push(new Uint8Array([255, 217])); ended = true; break; }
      if (offset + 2 > input.length || marker === 0 || marker === 216) throw new Error('The JPEG image is incomplete.');
      const length = view.getUint16(offset), end = offset + length;
      if (length < 2 || end > input.length) throw new Error('The JPEG image is incomplete.');
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (length < 8) throw new Error('The JPEG image has no dimensions.');
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5);
      }
      if (marker === 225 && text(offset + 2, Math.min(end, offset + 6)) === 'Exif') {
        if (length < 8 || input[offset + 6] !== 0 || input[offset + 7] !== 0) throw new Error(ORIENTATION_ERROR);
        readExif(input.subarray(offset + 2, end), true);
      }
      // Adobe's fixed colour-transform marker contains no free-form strings.
      const adobeColour = marker === 238 && length === 14 && text(offset + 2, offset + 7) === 'Adobe';
      const metadata = (marker >= 224 && marker <= 239 && !adobeColour) || marker === 254;
      if (!metadata) chunks.push(input.subarray(begin, end));
      offset = end;
      if (marker === 218) {
        scan = true; const entropy = offset;
        while (offset < input.length) {
          if (input[offset] !== 255) { offset++; continue; }
          const next = input[offset + 1];
          if (next === 0 || (next >= 208 && next <= 215)) { offset += 2; continue; }
          if (next === 255) { offset++; continue; }
          break;
        }
        chunks.push(input.subarray(entropy, offset));
      }
    }
    if (!ended || !scan) throw new Error('The JPEG image is incomplete.');
    if (orientation > 1) {
      const marker = new Uint8Array(36);
      marker.set([255, 225, 0, 34, 69, 120, 105, 102, 0, 0]); marker.set(orientationTiff(orientation), 10);
      chunks.splice(1, 0, marker);
    }
  } else if (mime === 'image/webp') {
    if (input.length < 26 || text(0, 4) !== 'RIFF' || text(8, 12) !== 'WEBP' || view.getUint32(4, true) + 8 !== input.length) throw new Error('The WebP image is incomplete.');
    chunks.push(input.slice(0, 12));
    let offset = 12, data = false, extended = false, alpha = false, alphaChunk = false, canvasWidth = 0, canvasHeight = 0;
    while (offset + 8 <= input.length) {
      const type = text(offset, offset + 4), size = view.getUint32(offset + 4, true), end = offset + 8 + size + (size % 2), start = offset + 8;
      if (end > input.length) throw new Error('The WebP image is incomplete.');
      if (type === 'ANIM' || type === 'ANMF') throw new Error('Choose a still image for the shared shelf collection.');
      if (type === 'VP8X') {
        if (extended || offset !== 12 || size !== 10) throw new Error('The WebP image is incomplete.');
        if (input[start] & 2) throw new Error('Choose a still image for the shared shelf collection.');
        extended = true;
        canvasWidth = 1 + input[start + 4] + (input[start + 5] << 8) + (input[start + 6] << 16);
        canvasHeight = 1 + input[start + 7] + (input[start + 8] << 8) + (input[start + 9] << 16);
      } else if (type === 'VP8 ') {
        if (data || size < 10 || input[start + 3] !== 157 || input[start + 4] !== 1 || input[start + 5] !== 42) throw new Error('The WebP image is incomplete.');
        width = view.getUint16(start + 6, true) & 16383; height = view.getUint16(start + 8, true) & 16383;
        data = true; chunks.push(input.subarray(offset, end));
      } else if (type === 'VP8L') {
        if (data || alphaChunk || size < 5 || input[start] !== 47) throw new Error('The WebP image is incomplete.');
        const bits = view.getUint32(start + 1, true);
        width = (bits & 16383) + 1; height = ((bits >>> 14) & 16383) + 1; alpha = !!(bits & 0x10000000);
        data = true; chunks.push(input.subarray(offset, end));
      } else if (type === 'ALPH') {
        if (data || alphaChunk || size < 1) throw new Error('The WebP image is incomplete.');
        alpha = true; alphaChunk = true; chunks.push(input.subarray(offset, end));
      } else if (type === 'EXIF') readExif(input.subarray(start, start + size), true);
      offset = end;
    }
    if (!data || offset !== input.length || (extended && (canvasWidth !== width || canvasHeight !== height))) throw new Error('The WebP image is incomplete.');
    if (extended || orientation > 1 || alphaChunk) {
      const header = new Uint8Array(10);
      header[0] = (alpha ? 16 : 0) | (orientation > 1 ? 8 : 0);
      for (let index = 0; index < 3; index++) { header[4 + index] = ((width - 1) >>> (8 * index)) & 255; header[7 + index] = ((height - 1) >>> (8 * index)) & 255; }
      chunks.splice(1, 0, webpChunk('VP8X', header));
    }
    if (orientation > 1) chunks.push(webpChunk('EXIF', orientationTiff(orientation)));
  } else throw new Error('Use a PNG, JPEG, or WebP image.');
  if (!width || !height || width > 4096 || height > 4096 || width * height > 8_000_000) throw new Error('Shared images can be up to 4,096 pixels per side and 8 megapixels.');
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  if (size > MAX_IMAGE_BYTES) throw new Error('Choose an image up to 4 MB.');
  const bytes = new Uint8Array(size); let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.length; }
  if (mime === 'image/webp') new DataView(bytes.buffer).setUint32(4, size - 8, true);
  if (orientation >= 5) [width, height] = [height, width];
  return { bytes, width, height };
}
