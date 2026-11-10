import { AssetTransferError } from './asset-transfers';

export const MAX_MULTIPART_BYTES = 26 * 1024 * 1024;
export const UPLOAD_BODY_DEADLINE_MS = 120_000;
const MAX_WAITING_UPLOADS = 4;
let active = false;
type Waiter = { resume: () => void; reject: (error: Error) => void };
const waiting: Waiter[] = [];

/** Only one multipart parse / full-file buffer (including shared image copies)
 * is held per Worker isolate.
 * Waiting requests have bounded count/time and do not read their bodies yet. */
export async function withUploadBodySlot<T>(request: Request, action: () => Promise<T>): Promise<T> {
  if (request.signal.aborted) throw new AssetTransferError(400, 'The upload was cancelled.', 'UPLOAD_CANCELLED');
  if (active) {
    if (waiting.length >= MAX_WAITING_UPLOADS) throw new AssetTransferError(503, 'File uploads are busy. Please try again shortly.', 'UPLOAD_BUSY');
    await new Promise<void>((resolve, reject) => {
      const remove = () => { const index = waiting.indexOf(waiter); if (index >= 0) waiting.splice(index, 1); };
      const cleanup = () => { clearTimeout(timer); request.signal.removeEventListener('abort', abort); };
      const fail = (error: Error) => { remove(); cleanup(); reject(error); };
      const abort = () => fail(new AssetTransferError(400, 'The upload was cancelled.', 'UPLOAD_CANCELLED'));
      const timer = setTimeout(() => fail(new AssetTransferError(503, 'File uploads are busy. Please try again shortly.', 'UPLOAD_BUSY')), 15_000);
      const waiter = { resume: () => { cleanup(); resolve(); }, reject: fail };
      waiting.push(waiter); request.signal.addEventListener('abort', abort, { once: true });
    });
  }
  active = true;
  try { return await action(); }
  finally { const next = waiting.shift(); if (next) next.resume(); else active = false; }
}

export async function readUploadForm(request: Request, deadlineMs = UPLOAD_BODY_DEADLINE_MS): Promise<FormData> {
  const type = request.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data(?:;|$)/i.test(type)) throw new AssetTransferError(415, 'Choose a file to upload.', 'INVALID_UPLOAD');
  if (Number(request.headers.get('content-length') ?? 0) > MAX_MULTIPART_BYTES) throw new AssetTransferError(413, 'This upload is too large.', 'FILE_TOO_LARGE');
  if (!request.body) throw new AssetTransferError(400, 'Choose a file to upload.', 'INVALID_UPLOAD');
  const reader = request.body.getReader(); let size = 0, settled = false;
  let stop: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const cancel = (error: AssetTransferError) => {
        if (settled) return;
        settled = true; stop?.(); controller.error(error); void reader.cancel().catch(() => {});
      };
      const abort = () => cancel(new AssetTransferError(400, 'The upload was cancelled.', 'UPLOAD_CANCELLED'));
      const timer = setTimeout(() => cancel(new AssetTransferError(408, 'The upload took too long. Check your connection and try again.', 'UPLOAD_TIMED_OUT')), Math.max(1, deadlineMs));
      stop = () => { clearTimeout(timer); request.signal.removeEventListener('abort', abort); };
      request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) abort();
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read(); if (settled) return;
        if (done) { settled = true; stop?.(); controller.close(); return; }
        size += value.byteLength;
        if (size > MAX_MULTIPART_BYTES) {
          settled = true; stop?.(); controller.error(new AssetTransferError(413, 'This upload is too large.', 'FILE_TOO_LARGE'));
          void reader.cancel().catch(() => {}); return;
        }
        controller.enqueue(value);
      } catch (error) { if (!settled) { settled = true; stop?.(); controller.error(error); } }
    },
    cancel() { settled = true; stop?.(); void reader.cancel().catch(() => {}); },
  });
  try { return await new Response(stream, { headers: { 'Content-Type': type } }).formData(); }
  catch (error) {
    if (error instanceof AssetTransferError) throw error;
    throw new AssetTransferError(400, 'The upload could not be read. Choose the file again.', 'INVALID_UPLOAD');
  } finally {
    stop?.();
    if (!settled) { settled = true; void reader.cancel().catch(() => {}); }
  }
}
