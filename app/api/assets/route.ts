import { env } from 'cloudflare:workers';
import { authenticated, handled, HttpError, json, sameOrigin } from '@/lib/server/http';
import { database, type AssetRow } from '@/lib/server/storage';
import { detectedFileType } from '@/lib/server/file-types';
import { AssetTransferError, assetUsage, cleanupAssetTransfers, limitUploadAttempts, reserveAssetTransfer, writeReservedAsset } from '@/lib/server/asset-transfers';
import { readUploadForm, withUploadBodySlot } from '@/lib/server/upload-body';

export const dynamic = 'force-dynamic';
const assetAction = (action: () => Promise<Response>) => handled(async () => {
  try { return await action(); }
  catch (error) {
    if (error instanceof AssetTransferError) throw new HttpError(error.status, error.message, error.code);
    throw error;
  }
});

export async function GET(request: Request) { return assetAction(async () => {
  const user = await authenticated(request);
  const result = await database().prepare('SELECT * FROM assets WHERE owner_id = ? ORDER BY created_at DESC LIMIT 1000').bind(user.userId).all<AssetRow>();
  const usage = await assetUsage(env, user.userId);
  return json({ assets: result.results.map(asset => ({ id: asset.id, filename: asset.filename, mime: asset.mime, size: asset.size, url: '/api/assets/' + asset.id })), ...usage });
}); }

export async function POST(request: Request) { return assetAction(async () => {
  sameOrigin(request); const user = await authenticated(request);
  await limitUploadAttempts(env, request, user.userId);
  return withUploadBodySlot(request, async () => {
    const form = await readUploadForm(request), file = form.get('file'), kind = form.get('kind');
    if (!(file instanceof File) || (kind !== 'book' && kind !== 'image')
      || form.getAll('file').length !== 1 || form.getAll('kind').length !== 1
      || [...form.keys()].some(key => key !== 'file' && key !== 'kind')) {
      throw new HttpError(400, 'Choose one book or image file.');
    }
    const limit = kind === 'book' ? 25 * 1024 * 1024 : 4 * 1024 * 1024;
    if (file.size === 0 || file.size > limit) throw new HttpError(413, kind === 'book' ? 'Books can be up to 25 MB.' : 'Images can be up to 4 MB.');
    const bytes = new Uint8Array(await file.arrayBuffer()), detected = detectedFileType(bytes);
    if (!detected || detected.kind !== kind) throw new HttpError(415, kind === 'book' ? 'Use a valid EPUB or PDF file.' : 'Use a PNG, JPEG, or WebP image.');
    // Retry a small amount of prior cleanup before checking available space.
    await cleanupAssetTransfers(env, { ownerId: user.userId, limit: 2 });
    const transfer = await reserveAssetTransfer(env, user.userId, file.size);
    const filename = file.name.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 220) || 'book';
    const cleanFilename = filename.toLowerCase().endsWith('.' + detected.extension)
      || (detected.extension === 'jpg' && filename.toLowerCase().endsWith('.jpeg')) ? filename : filename + '.' + detected.extension;
    const saved = await writeReservedAsset(env, transfer, bytes, { kind, filename: cleanFilename, mime: detected.mime });
    return json(saved, 201);
  });
}); }
