import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { prepareSharedImage } from '../lib/server/shared-image';

function crc32(bytes: Uint8Array) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Uint8Array) { const label = Buffer.from(type), out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); label.copy(out, 4); Buffer.from(data).copy(out, 8); out.writeUInt32BE(crc32(out.subarray(4, -4)), out.length - 4); return out; }
function png(extra: Buffer[] = [], width = 2, height = 3) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), ...extra,
    chunk('IDAT', deflateSync(Buffer.alloc(3 * 9))), chunk('IEND', Buffer.alloc(0))]);
}

/** Realistic TIFF: IFD0 description/orientation/GPS pointer, a GPS IFD, and
 * a linked thumbnail IFD. None of those linked private fields may survive. */
function exif(orientation: number | null = 1, little = true): Buffer {
  const description = Buffer.from('PRIVATE_CAMERA_OWNER\0'), gps = Buffer.from('PRIVATE_GPS_LOCATION'), thumbnail = Buffer.from('PRIVATE_THUMBNAIL');
  const count = orientation === null ? 2 : 3, descriptionAt = 8 + 2 + count * 12 + 4;
  const gpsAt = descriptionAt + description.length, gpsTextAt = gpsAt + 18, thumbIfdAt = gpsTextAt + gps.length, thumbAt = thumbIfdAt + 30;
  const bytes = Buffer.alloc(thumbAt + thumbnail.length);
  const u16 = (offset: number, value: number) => little ? bytes.writeUInt16LE(value, offset) : bytes.writeUInt16BE(value, offset);
  const u32 = (offset: number, value: number) => little ? bytes.writeUInt32LE(value, offset) : bytes.writeUInt32BE(value, offset);
  bytes.write(little ? 'II' : 'MM'); u16(2, 42); u32(4, 8); u16(8, count);
  const entry = (at: number, tag: number, type: number, size: number, value: number) => {
    u16(at, tag); u16(at + 2, type); u32(at + 4, size);
    if (type === 3 && size === 1) u16(at + 8, value); else u32(at + 8, value);
  };
  entry(10, 0x010e, 2, description.length, descriptionAt);
  if (orientation !== null) entry(22, 0x0112, 3, 1, orientation);
  entry(10 + (count - 1) * 12, 0x8825, 4, 1, gpsAt); u32(10 + count * 12, thumbIfdAt);
  description.copy(bytes, descriptionAt); u16(gpsAt, 1); entry(gpsAt + 2, 0x001c, 7, gps.length, gpsTextAt); gps.copy(bytes, gpsTextAt);
  u16(thumbIfdAt, 2); entry(thumbIfdAt + 2, 0x0201, 4, 1, thumbAt); entry(thumbIfdAt + 14, 0x0202, 4, 1, thumbnail.length); thumbnail.copy(bytes, thumbAt);
  return bytes;
}

// Genuine 2×3 six-colour images, encoded once with Pillow. Tests need no codec.
const REAL_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAADAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3DwCsFl4F8OW8djYNHFpttGplsoZHIESgbnZSzH1JJJ6k0UUV+lYng7hqdepKWWUG23d+xp9/8J/nVxNneaU88x0IYqokqtRJKcrJc70Wp//Z', 'base64');
const REAL_WEBP = Buffer.from('UklGRjIAAABXRUJQVlA4TCUAAAAvAYAAAC8gEEjaH3qN+RcQFPk/2vwHH0QCg0AgDVFkMMAR/Y8GAA==', 'base64');

test('shared PNG copies strip private metadata while preserving pixels and the private source', () => {
  const source = png([chunk('tEXt', Buffer.from('Location\0PRIVATE_GPS_SENTINEL')), chunk('eXIf', exif())]);
  const original = source.slice(), prepared = prepareSharedImage(source, 'image/png');
  assert.equal(prepared.width, 2); assert.equal(prepared.height, 3);
  assert.deepEqual(Buffer.from(prepared.bytes), png()); assert.deepEqual(source, original);
  assert.equal(Buffer.from(prepared.bytes).includes(Buffer.from('PRIVATE_')), false);
});
test('shared image parser rejects incomplete, oversized and animated files', () => {
  assert.throws(() => prepareSharedImage(png().subarray(0, 30), 'image/png'), /incomplete/);
  assert.throws(() => prepareSharedImage(png([], 5000, 2), 'image/png'), /4,096/);
  assert.throws(() => prepareSharedImage(png([chunk('acTL', Buffer.alloc(8))]), 'image/png'), /still image/);
  assert.throws(() => prepareSharedImage(new Uint8Array(4 * 1024 * 1024 + 1), 'image/png'), /4 MB/);
  assert.throws(() => prepareSharedImage(Buffer.from('<svg/>'), 'image/svg+xml'), /PNG, JPEG, or WebP/);
});
function jpegSegment(marker: number, body: Uint8Array) { const result = Buffer.alloc(body.length + 4); result[0] = 255; result[1] = marker; result.writeUInt16BE(body.length + 2, 2); Buffer.from(body).copy(result, 4); return result; }
test('JPEG metadata is stripped before and between scans without retaining the original EXIF', () => {
  const frame = jpegSegment(192, Buffer.from([8, 0, 3, 0, 2, 1, 1, 17, 0]));
  const scan = jpegSegment(218, Buffer.from([1, 1, 0, 0, 63, 0])), entropy = Buffer.from([12, 34, 255, 0, 56]);
  const source = Buffer.concat([Buffer.from([255, 216]), jpegSegment(225, Buffer.concat([Buffer.from('Exif\0\0'), exif()])),
    frame, scan, entropy, jpegSegment(254, Buffer.from('PRIVATE_COMMENT')), scan, entropy, Buffer.from([255, 217])]);
  const prepared = prepareSharedImage(source, 'image/jpeg');
  assert.equal(prepared.width, 2); assert.equal(prepared.height, 3);
  assert.equal(Buffer.from(prepared.bytes).includes(Buffer.from('PRIVATE_')), false);
  assert.deepEqual(Buffer.from(prepared.bytes), Buffer.concat([Buffer.from([255, 216]), frame, scan, entropy, scan, entropy, Buffer.from([255, 217])]));
  assert.throws(() => prepareSharedImage(source.subarray(0, -2), 'image/jpeg'), /incomplete/);
});
function webpChunk(type: string, data: Buffer) { const out = Buffer.alloc(8 + data.length + data.length % 2); out.write(type); out.writeUInt32LE(data.length, 4); data.copy(out, 8); return out; }
test('WebP shared copy removes EXIF/XMP and fixes container length and metadata flags', () => {
  const extended = Buffer.from([12, 0, 0, 0, 1, 0, 0, 2, 0, 0]);
  const pixels = Buffer.from([47, 1, 128, 0, 0]);
  const chunks = Buffer.concat([webpChunk('VP8X', extended), webpChunk('EXIF', exif()), webpChunk('XMP ', Buffer.from('PRIVATE_XMP')), webpChunk('VP8L', pixels)]);
  const header = Buffer.alloc(12); header.write('RIFF'); header.writeUInt32LE(chunks.length + 4, 4); header.write('WEBP', 8);
  const prepared = prepareSharedImage(Buffer.concat([header, chunks]), 'image/webp'), result = Buffer.from(prepared.bytes);
  assert.equal(prepared.width, 2); assert.equal(prepared.height, 3);
  assert.equal(result.includes(Buffer.from('PRIVATE_')), false); assert.equal(result[20] & 12, 0);
  assert.equal(result.readUInt32LE(4) + 8, result.length);
});

function webp(chunks: Buffer[]): Buffer {
  const body = Buffer.concat(chunks), header = Buffer.alloc(12);
  header.write('RIFF'); header.writeUInt32LE(body.length + 4, 4); header.write('WEBP', 8);
  return Buffer.concat([header, body]);
}
function withExif(mime: string, payloads: Buffer[], prefix = false): Buffer {
  if (mime === 'image/png') return png(payloads.map(payload => chunk('eXIf', payload)));
  if (mime === 'image/jpeg') return Buffer.concat([REAL_JPEG.subarray(0, 2), ...payloads.map(payload => jpegSegment(225, Buffer.concat([Buffer.from('Exif\0\0'), payload]))), REAL_JPEG.subarray(2)]);
  return webp([webpChunk('VP8X', Buffer.from([12, 0, 0, 0, 1, 0, 0, 2, 0, 0])), REAL_WEBP.subarray(12),
    ...payloads.map(payload => webpChunk('EXIF', prefix ? Buffer.concat([Buffer.from('Exif\0\0'), payload]) : payload)), webpChunk('XMP ', Buffer.from('PRIVATE_XMP'))]);
}
function outputExif(input: Uint8Array, mime: string): Buffer[] {
  const bytes = Buffer.from(input), result: Buffer[] = [];
  if (mime === 'image/jpeg') {
    for (let at = 2; at + 4 <= bytes.length;) {
      const marker = bytes[at + 1]; if (marker === 218 || marker === 217) break;
      const length = bytes.readUInt16BE(at + 2);
      if (marker === 225) { assert.equal(bytes.subarray(at + 4, at + 10).toString(), 'Exif\0\0'); result.push(bytes.subarray(at + 10, at + 2 + length)); }
      at += length + 2;
    }
  } else if (mime === 'image/png') {
    for (let at = 8; at + 12 <= bytes.length;) {
      const length = bytes.readUInt32BE(at), type = bytes.subarray(at + 4, at + 8).toString();
      if (type === 'eXIf') { assert.equal(bytes.readUInt32BE(at + 8 + length), crc32(bytes.subarray(at + 4, at + 8 + length))); result.push(bytes.subarray(at + 8, at + 8 + length)); }
      at += length + 12;
    }
  } else {
    for (let at = 12; at + 8 <= bytes.length;) {
      const length = bytes.readUInt32LE(at + 4), type = bytes.subarray(at, at + 4).toString();
      if (type === 'EXIF') result.push(bytes.subarray(at + 8, at + 8 + length));
      at += length + 8 + length % 2;
    }
  }
  return result;
}
const formats = ['image/jpeg', 'image/png', 'image/webp'];
for (const mime of formats) {
  test(`${mime} preserves all rotated/mirrored orientations with only a canonical marker`, () => {
    for (let orientation = 1; orientation <= 8; orientation++) {
      for (const little of [true, false]) {
        const original = withExif(mime, [exif(orientation, little)]), saved = Buffer.from(original);
        const result = prepareSharedImage(original, mime), tags = outputExif(result.bytes, mime);
        assert.deepEqual([result.width, result.height], orientation >= 5 ? [3, 2] : [2, 3]);
        assert.deepEqual(original, saved, 'private original must remain untouched');
        assert.equal(Buffer.from(result.bytes).includes(Buffer.from('PRIVATE_')), false, 'camera, GPS, thumbnail and XMP content must be stripped');
        if (orientation === 1) assert.equal(tags.length, 0);
        else {
          // Exact public metadata allowlist: little-endian TIFF + one SHORT,
          // count=1, no value padding, pointers, next IFD, or original strings.
          const expected = Buffer.from('49492a0008000000010012010300010000000000000000000000', 'hex'); expected[18] = orientation;
          assert.deepEqual(tags, [expected]);
        }
        const repeated = prepareSharedImage(result.bytes, mime);
        assert.deepEqual(repeated, result, 'sanitizing an already shared copy must be byte-for-byte idempotent');
        if (mime === 'image/webp') {
          const bytes = Buffer.from(result.bytes);
          assert.equal(bytes[20] & 8, orientation > 1 ? 8 : 0);
          assert.equal(bytes[20] & (32 | 4), 0, 'stripped ICC/XMP flags must be cleared');
          assert.equal(bytes.readUInt32LE(4) + 8, bytes.length);
        }
      }
    }
  });
  test(`${mime} strips an EXIF block that has no primary orientation`, () => {
    const result = prepareSharedImage(withExif(mime, [exif(null)]), mime);
    assert.deepEqual([result.width, result.height], [2, 3]);
    assert.equal(outputExif(result.bytes, mime).length, 0);
    assert.equal(Buffer.from(result.bytes).includes(Buffer.from('PRIVATE_')), false);
  });
  test(`${mime} rejects malformed, invalid, or ambiguous orientation metadata`, () => {
    const minimal = Buffer.from('49492a0008000000010012010300010000000600000000000000', 'hex');
    const mutations: Buffer[] = [Buffer.from('PRIVATE_INVALID_EXIF'), minimal.subarray(0, 20)];
    for (const [offset, value, size] of [[2, 43, 2], [4, 0xfffffffc, 4], [4, 0, 4], [8, 65535, 2], [12, 4, 2], [14, 2, 4], [18, 0, 2], [18, 9, 2]]) {
      const changed = Buffer.from(minimal); if (size === 2) changed.writeUInt16LE(value, offset); else changed.writeUInt32LE(value, offset); mutations.push(changed);
    }
    const duplicateTag = Buffer.alloc(38); minimal.subarray(0, 22).copy(duplicateTag); duplicateTag.writeUInt16LE(2, 8); minimal.subarray(10, 22).copy(duplicateTag, 22); mutations.push(duplicateTag);
    for (const invalid of mutations) assert.throws(() => prepareSharedImage(withExif(mime, [invalid]), mime), /orientation metadata/);
    for (const second of [exif(6), exif(3)]) assert.throws(() => prepareSharedImage(withExif(mime, [exif(6), second]), mime), /orientation metadata/);
  });
}

test('WebP accepts raw or Exif-prefixed TIFF and reconstructs identical safe metadata', () => {
  const raw = prepareSharedImage(withExif('image/webp', [exif(7)]), 'image/webp');
  assert.deepEqual(prepareSharedImage(withExif('image/webp', [exif(7)], true), 'image/webp'), raw);
  // A legacy metadata writer may omit VP8X; recreate the required header.
  const simple = webp([REAL_WEBP.subarray(12), webpChunk('EXIF', exif(7))]);
  assert.deepEqual(prepareSharedImage(simple, 'image/webp'), raw);
});
test('WebP rejects mismatched canvas dimensions and repeated still-image bitstreams', () => {
  const mismatch = withExif('image/webp', [exif(6)]); mismatch[24] = 40;
  assert.throws(() => prepareSharedImage(mismatch, 'image/webp'), /incomplete/);
  assert.throws(() => prepareSharedImage(webp([REAL_WEBP.subarray(12), REAL_WEBP.subarray(12)]), 'image/webp'), /incomplete/);
});
test('WebP orientation reconstruction preserves lossy and lossless transparency', () => {
  const images = [
    Buffer.from('UklGRj4AAABXRUJQVlA4TDIAAAAvAYAAEC8gEEjaH3oNAUGR/6MJCIr8H40g22b+RFOYxz0ewM6cwm8QyKahXSmWIvofDg==', 'base64'),
    Buffer.from('UklGRoQAAABXRUJQVlA4WAoAAAAQAAAAAQAAAgAAQUxQSAcAAAAA/wCAZP/IAFZQOCBWAAAA8AIAnQEqAgADAAFAJiWoAnRrgP4BhAHr/3YADA0WsAAA/rha6/V796+gcbikuwn4mPOJjT/9KFr83Nyb//8Fd/5ubk3//7Bx+9b+LB6QhfjQ3SDtwAA=', 'base64'),
  ];
  for (const image of images) {
    const pixels = image.subarray(image.subarray(12, 16).toString() === 'VP8X' ? 30 : 12);
    const source = webp([webpChunk('VP8X', Buffer.from([24, 0, 0, 0, 1, 0, 0, 2, 0, 0])), pixels, webpChunk('EXIF', exif(6))]);
    const result = prepareSharedImage(source, 'image/webp'), bytes = Buffer.from(result.bytes);
    assert.deepEqual([result.width, result.height], [3, 2]);
    assert.equal(bytes[20], 24, 'both alpha and EXIF flags must remain set');
    assert.deepEqual(bytes.subarray(30, -34), pixels, 'alpha and compressed pixels must be untouched');
    assert.deepEqual(prepareSharedImage(bytes, 'image/webp'), result);
  }
});
test('PNG rejects a corrupt EXIF checksum and keeps the safe orientation before image data', () => {
  const metadata = chunk('eXIf', exif(8)); metadata[metadata.length - 1] ^= 1;
  assert.throws(() => prepareSharedImage(png([metadata]), 'image/png'), /orientation metadata/);
  const original = png(), late = Buffer.concat([original.subarray(0, -12), chunk('eXIf', exif(8)), original.subarray(-12)]);
  const result = prepareSharedImage(late, 'image/png');
  assert.equal(Buffer.from(result.bytes).subarray(37, 41).toString(), 'eXIf');
  assert.deepEqual([result.width, result.height], [3, 2]);
});
test('orientation parsing respects a Uint8Array subview and existing image-size limits', () => {
  const original = withExif('image/jpeg', [exif(5)]), padded = Buffer.concat([Buffer.alloc(7, 255), original, Buffer.alloc(9, 255)]);
  assert.deepEqual(prepareSharedImage(padded.subarray(7, -9), 'image/jpeg'), prepareSharedImage(original, 'image/jpeg'));
  assert.throws(() => prepareSharedImage(png([chunk('eXIf', exif(6))], 5000, 2), 'image/png'), /4,096/);
  assert.throws(() => prepareSharedImage(png([chunk('eXIf', exif(6))], 3000, 3000), 'image/png'), /8 megapixels/);
});
