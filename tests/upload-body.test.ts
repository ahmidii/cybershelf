import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AssetTransferError } from '../lib/server/asset-transfers';
import { MAX_MULTIPART_BYTES, readUploadForm, withUploadBodySlot } from '../lib/server/upload-body';

test('upload parsing preserves a valid file and rejects non-multipart input before reading', async () => {
  const form = new FormData(); form.set('kind', 'book'); form.set('file', new Blob(['%PDF-1.7\nlocal file']), 'book.pdf');
  const parsed = await readUploadForm(new Request('https://cybershelf.test/api/assets', { method: 'POST', body: form }));
  assert.equal(parsed.get('kind'), 'book');
  assert.equal(await (parsed.get('file') as File).text(), '%PDF-1.7\nlocal file');
  await assert.rejects(readUploadForm(new Request('https://cybershelf.test/api/assets', { method: 'POST', body: '{}' })), (error: unknown) => {
    assert.ok(error instanceof AssetTransferError); assert.equal(error.status, 415); return true;
  });
});

test('multipart limits reject declared and actual oversize bodies', async () => {
  const oversizedHeaders = new Request('https://cybershelf.test/api/assets', { method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=test', 'Content-Length': String(MAX_MULTIPART_BYTES + 1) }, body: 'x' });
  await assert.rejects(readUploadForm(oversizedHeaders), (error: unknown) => {
    assert.ok(error instanceof AssetTransferError); assert.equal(error.status, 413); return true;
  });
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(MAX_MULTIPART_BYTES + 1)); controller.close(); } });
  const actual = new Request('https://cybershelf.test/api/assets', { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=test' }, body, duplex: 'half' } as RequestInit);
  await assert.rejects(readUploadForm(actual), (error: unknown) => {
    assert.ok(error instanceof AssetTransferError); assert.equal(error.status, 413); return true;
  });
});

test('a stalled multipart body times out, cancels its reader, and does not hold the upload slot', async () => {
  let cancelled = false;
  const stalled = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const request = new Request('https://cybershelf.test/api/assets', { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=test' }, body: stalled, duplex: 'half' } as RequestInit);
  await assert.rejects(withUploadBodySlot(request, () => readUploadForm(request, 10)), (error: unknown) => {
    assert.ok(error instanceof AssetTransferError); assert.equal(error.status, 408); return true;
  });
  assert.equal(cancelled, true);
  assert.equal(await withUploadBodySlot(new Request('https://cybershelf.test'), async () => 'next upload'), 'next upload');
});

test('multipart buffering serializes active work and bounds waiting requests without stranding a slot', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let active = 0, peak = 0;
  const work = () => withUploadBodySlot(new Request('https://cybershelf.test'), async () => {
    active++; peak = Math.max(peak, active);
    await gate; active--; return 'saved';
  });
  const pending = Array.from({ length: 6 }, work);
  // Attach handlers before releasing the held request to avoid an unhandled
  // rejection for the deliberately refused sixth upload.
  const complete = Promise.allSettled(pending); release();
  const results = await complete;
  assert.equal(peak, 1);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 5);
  const refused = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.ok(refused.reason instanceof AssetTransferError); assert.equal(refused.reason.status, 503);
  assert.equal(await work(), 'saved');
});
