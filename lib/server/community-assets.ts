import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { DECOR_CATALOGUE } from '../decor-catalogue';
import { canonicalISBN } from '../spine-image';
import { normalizeOpenLibraryEditionId, normalizeOpenLibraryWorkId } from '../book-catalog';
import { SHARED_ASSET_CONSENT, matchSharedBookArtwork, sharedAssetImageUrl, sharedAssetLicenseUrl, sharedAssetSearchText,
  type SharedAsset, type SharedAssetBookIdentity, type SharedAssetEdition, type SharedAssetKind, type SharedAssetStatus } from '../shared-assets';
import { AssetTransferError, abandonAssetTransfer, cleanupAssetTransfers, reserveAssetTransfer } from './asset-transfers';
import { HttpError } from './http';
import { bucket, database, getAsset } from './storage';
import { configuredModerator, noBlockSql, requireModerator, requireParticipation } from './moderation';
import { openLibraryJSON } from './book-catalog';
import { prepareSharedImage } from './shared-image';

type AssetMetadata = Pick<SharedAsset, 'title' | 'description' | 'tags' | 'category' | 'style' | 'width' | 'height' | 'defaultWidthMm' | 'defaultHeightMm' | 'anchorX' | 'anchorY' | 'creator' | 'sourceUrl' | 'license' | 'licenseUrl' | 'edition'> & { searchText: string };
export type CommunityAssetRow = {
  id: string; contributor_id: string | null; kind: SharedAssetKind; status: SharedAssetStatus;
  storage_id: string; object_key: string; mime: string; size: number; content_hash: string;
  edition_key: string; metadata: string; consent_version: string; review_note: string; created_at: string; updated_at: string;
};
const activeOwner = `EXISTS (SELECT 1 FROM auth_user WHERE id=?) AND NOT EXISTS (SELECT 1 FROM account_deletion_jobs WHERE owner_id=?) AND NOT EXISTS (SELECT 1 FROM account_suspensions WHERE user_id=?)`;
const publicVisible = (alias: string, viewerId?: string) => `${alias}.status='approved'
  AND NOT EXISTS (SELECT 1 FROM community_asset_erasures e WHERE e.asset_id=${alias}.id)
  AND NOT EXISTS (SELECT 1 FROM moderation_hidden h WHERE h.target_kind='asset' AND h.target_id=${alias}.id)
  AND NOT EXISTS (SELECT 1 FROM account_suspensions s WHERE s.user_id=${alias}.contributor_id)
  ${viewerId ? 'AND ' + noBlockSql('?', alias + '.contributor_id') : ''}`;
const clean = (length: number, minimum = 0) => z.string().trim().min(minimum).max(length).refine(value => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value), 'Remove control characters.');
const sourceURL = clean(2048).refine(value => {
  if (!value) return true;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}, 'Use a public http or https source link.');
export const contributionSchema = z.object({
  assetId: z.string().regex(/^as_[A-Za-z0-9_-]{1,96}$/), kind: z.enum(['decor', 'spine', 'cover']),
  title: clean(150, 1), description: clean(1000).default(''), creator: clean(100, 1),
  tags: z.array(clean(30, 1)).max(12).default([]), category: clean(32).default('other'), style: clean(24).default('photographic'),
  sourceUrl: sourceURL.default(''), license: z.enum(['CC0-1.0', 'CC-BY-4.0', 'community-permission']),
  defaultWidthMm: z.number().finite().min(5).max(350).optional(), defaultHeightMm: z.number().finite().min(10).max(280).optional(),
  edition: z.object({ catalogId: z.string().regex(/^OL[1-9]\d{0,11}W$/).optional(), editionId: z.string().regex(/^OL[1-9]\d{0,11}M$/).optional(),
    isbn: clean(32).refine(value => !!canonicalISBN(value), 'Use a valid ISBN.').optional(), variant: clean(120).optional() }).strict().optional(),
  consent: z.literal(SHARED_ASSET_CONSENT), rightsConfirmed: z.literal(true),
}).strict().superRefine((value, ctx) => {
  if (value.kind !== 'decor' && (!value.edition || (!value.edition.editionId && !value.edition.isbn))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Choose an identifiable edition before contributing book artwork.' });
  if (value.kind !== 'decor' && value.license !== 'community-permission') ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Book artwork uses the community permission statement, not a claim to own the publisher’s copyright.' });
  if (value.kind === 'decor' && value.edition) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Decorations do not need a book edition.' });
});
export type ContributionInput = z.infer<typeof contributionSchema>;

function fromRow(row: CommunityAssetRow, viewerId?: string, moderator = false): SharedAsset {
  const data = JSON.parse(row.metadata) as AssetMetadata;
  // An explicit allowlist prevents internal owner IDs, storage keys and source
  // upload identities from becoming public through a convenient object spread.
  return { id: row.id, kind: row.kind, title: data.title, description: data.description, tags: data.tags,
    category: data.category, style: data.style, width: data.width, height: data.height,
    defaultWidthMm: data.defaultWidthMm, defaultHeightMm: data.defaultHeightMm, anchorX: data.anchorX, anchorY: data.anchorY,
    creator: data.creator, sourceUrl: data.sourceUrl, license: data.license, licenseUrl: data.licenseUrl,
    ...(data.edition ? { edition: data.edition } : {}), imageUrl: sharedAssetImageUrl(row.id), thumbnailUrl: sharedAssetImageUrl(row.id),
    origin: 'community', status: row.status, createdAt: row.created_at,
    ...(viewerId && viewerId === row.contributor_id ? { canWithdraw: row.status === 'approved' || row.status === 'pending' } : {}),
    ...((moderator || (viewerId && viewerId === row.contributor_id)) && row.review_note ? { reviewNote: row.review_note } : {}) };
}
function curatedAssets(): SharedAsset[] {
  return DECOR_CATALOGUE.map(asset => ({ ...asset, imageUrl: sharedAssetImageUrl(asset.id), thumbnailUrl: sharedAssetImageUrl(asset.id) + '?size=thumb',
    origin: 'curated' as const, status: 'approved' as const, createdAt: '2026-11-10T00:00:00.000Z' }));
}
async function visibleCurated(): Promise<SharedAsset[]> {
  const assets = curatedAssets(), hidden = new Set<string>();
  for (let offset = 0; offset < assets.length; offset += 80) {
    const ids = assets.slice(offset, offset + 80).map(asset => asset.id);
    const rows = await database().prepare(`SELECT target_id FROM moderation_hidden WHERE target_kind='asset' AND target_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ target_id: string }>();
    rows.results.forEach(row => hidden.add(row.target_id));
  }
  return assets.filter(asset => !hidden.has(asset.id));
}
const validId = (id: string) => /^(?:ca_|dc_)[A-Za-z0-9_-]{1,96}$/.test(id);
export async function getSharedAsset(id: string, viewerId?: string, moderator = false): Promise<SharedAsset> {
  if (!validId(id)) throw new HttpError(404, 'This shared item is unavailable.');
  if (id.startsWith('dc_')) {
    const asset = curatedAssets().find(asset => asset.id === id);
    const hidden = !moderator && asset ? await database().prepare("SELECT 1 FROM moderation_hidden WHERE target_kind='asset' AND target_id=?").bind(id).first() : null;
    if (!asset || hidden) throw new HttpError(404, 'This shared item is unavailable.');
    return asset;
  }
  const db = database(), row = await db.prepare('SELECT * FROM community_assets WHERE id=?').bind(id).first<CommunityAssetRow>();
  if (!row) throw new HttpError(404, 'This shared item is unavailable.');
  if (!moderator && row.contributor_id !== viewerId) {
    const allowed = await db.prepare(`SELECT 1 FROM community_assets a WHERE a.id=? AND ${publicVisible('a', viewerId)}`).bind(id, ...(viewerId ? [viewerId, viewerId] : [])).first();
    if (!allowed) throw new HttpError(404, 'This shared item is unavailable.');
  }
  return fromRow(row, viewerId, moderator);
}

export async function listSharedAssets(params: URLSearchParams, viewerId?: string, moderation = false) {
  const kind = params.get('kind') ?? (moderation ? 'all' : 'decor'), origin = params.get('origin') ?? '', mine = params.get('mine') === 'true';
  const q = (params.get('q') ?? '').trim().normalize('NFKC').toLocaleLowerCase(), category = (params.get('category') ?? '').trim();
  const status = params.get('status') ?? 'pending';
  if (!['decor', 'spine', 'cover', 'all'].includes(kind) || !['', 'curated', 'community'].includes(origin) || q.length > 80 || category.length > 32
    || (moderation && !['pending', 'approved', 'rejected', 'withdrawn'].includes(status))) throw new HttpError(400, 'Choose a valid catalogue filter.');
  if (mine && !viewerId) throw new HttpError(401, 'Sign in to see your contributions.');
  const signature = JSON.stringify([kind, origin, mine, q, category, moderation ? status : '']);
  let offset = 0;
  if (params.get('cursor')) {
    try { const cursor = params.get('cursor')!; if (cursor.length > 1500) throw new Error();
      const saved = JSON.parse(decodeURIComponent(atob(cursor))); if (!Number.isSafeInteger(saved.offset) || saved.offset < 0 || saved.offset > 10000 || saved.signature !== signature) throw new Error(); offset = saved.offset;
    } catch { throw new HttpError(400, 'Refresh the catalogue before loading more items.'); }
  }
  const terms = q.split(/\s+/).filter(Boolean), curated = !mine && !moderation && origin !== 'community'
    ? (await visibleCurated()).filter(asset => (kind === 'all' || kind === asset.kind) && (!category || asset.category === category) && terms.every(term => sharedAssetSearchText(asset).includes(term))) : [];
  let community: SharedAsset[] = [];
  if (origin !== 'curated' || mine || moderation) {
    const conditions = [moderation ? 'a.status=?' : mine ? 'a.contributor_id=?' : publicVisible('a', viewerId)];
    const bindings: (string | number)[] = moderation ? [status] : mine ? [viewerId!] : viewerId ? [viewerId, viewerId] : [];
    if (kind !== 'all') { conditions.push('a.kind=?'); bindings.push(kind); }
    if (category) { conditions.push("json_extract(a.metadata,'$.category')=?"); bindings.push(category); }
    for (const term of terms) { conditions.push("json_extract(a.metadata,'$.searchText') LIKE ? ESCAPE '\\'"); bindings.push('%' + term.replace(/[\\%_]/g, '\\$&') + '%'); }
    const communityOffset = Math.max(0, offset - curated.length), take = Math.max(0, 41 - Math.max(0, curated.length - offset));
    if (take) {
      const rows = await database().prepare(`SELECT a.* FROM community_assets a WHERE ${conditions.join(' AND ')} ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?`)
        .bind(...bindings, take, communityOffset).all<CommunityAssetRow>();
      community = rows.results.map(row => fromRow(row, viewerId, moderation));
    }
  }
  const available = [...curated.slice(offset, offset + 41), ...community], assets = available.slice(0, 40);
  return { assets, ...(available.length > 40 ? { nextCursor: btoa(encodeURIComponent(JSON.stringify({ offset: offset + 40, signature }))) } : {}) };
}

function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
/** Only the fixed Open Library interface can verify contributor identifiers. */
async function verifiedEdition(input: NonNullable<ContributionInput['edition']>): Promise<SharedAssetEdition> {
  const isbn = canonicalISBN(input.isbn), path = input.editionId ? '/books/' + input.editionId : '/isbn/' + isbn;
  const data = object(await openLibraryJSON(new URL('https://openlibrary.org' + path + '.json')));
  const editionId = normalizeOpenLibraryEditionId(data.key);
  const workIds = [...new Set((Array.isArray(data.works) ? data.works : []).map(work => normalizeOpenLibraryWorkId(object(work).key)).filter((id): id is string => !!id))];
  const isbns = [...new Set([data.isbn_13, data.isbn_10].flatMap(value => Array.isArray(value) ? value.slice(0, 20) : []).map(canonicalISBN).filter((value): value is string => !!value))];
  if (!editionId || workIds.length !== 1 || (input.editionId && input.editionId !== editionId) || (input.catalogId && input.catalogId !== workIds[0]) || (isbn && !isbns.includes(isbn))) {
    throw new HttpError(400, 'These identifiers could not be verified as the same edition. Choose the correct edition on its book page, then try again.');
  }
  return { catalogId: workIds[0], editionId, ...(isbn || isbns[0] ? { isbn: isbn ?? isbns[0] } : {}), isbns,
    ...(input.variant?.trim() ? { variant: input.variant.trim() } : {}) };
}
export async function contributeSharedAsset(ownerId: string, input: ContributionInput): Promise<SharedAsset> {
  await requireParticipation(ownerId);
  const original = await getAsset(input.assetId, ownerId);
  if (!original || original.kind !== 'image' || original.size < 1 || original.size > 4 * 1024 * 1024) throw new HttpError(404, 'Choose one of your uploaded images.');
  const edition = input.kind === 'decor' ? undefined : await verifiedEdition(input.edition!);
  const source = await bucket().get(original.object_key);
  if (!source || source.size !== original.size || source.size > 4 * 1024 * 1024) { if (source) void source.body.cancel(); throw new HttpError(404, 'The source image is unavailable. Upload it again.'); }
  const sourceBytes = new Uint8Array(await source.arrayBuffer());
  let prepared: ReturnType<typeof prepareSharedImage>;
  try { prepared = prepareSharedImage(sourceBytes, original.mime); }
  catch (error) { throw new HttpError(415, error instanceof Error ? error.message : 'Choose a readable image.'); }
  const { bytes, width, height } = prepared, digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const editionKey = edition ? 'edition:' + edition.editionId + '|' + (edition.variant ?? '').normalize('NFKC').toLocaleLowerCase() : '';
  const existing = await database().prepare("SELECT * FROM community_assets WHERE contributor_id=? AND content_hash=? AND kind=? AND edition_key=? AND status IN ('pending','approved')").bind(ownerId, hash, input.kind, editionKey).first<CommunityAssetRow>();
  if (existing) return fromRow(existing, ownerId);
  const defaultHeightMm = input.defaultHeightMm ?? 110, defaultWidthMm = input.defaultWidthMm ?? Math.max(5, Math.min(350, Math.round(defaultHeightMm * width / height)));
  const metadata: AssetMetadata = { title: input.title, description: input.description, creator: input.creator, tags: [...new Set(input.tags)], category: input.category || 'other',
    style: input.style || 'photographic', sourceUrl: input.sourceUrl, license: input.license, licenseUrl: sharedAssetLicenseUrl(input.license),
    width, height, defaultWidthMm, defaultHeightMm, anchorX: .5, anchorY: 1, ...(edition ? { edition } : {}), searchText: '' };
  metadata.searchText = sharedAssetSearchText(metadata);
  const transfer = await reserveAssetTransfer(env, ownerId, bytes.length), id = 'ca_' + crypto.randomUUID();
  let writerDone = false;
  try {
    const written = await bucket().put(transfer.object_key, bytes, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: original.mime } });
    writerDone = true;
    if (!written) throw new HttpError(409, 'This contribution was cancelled. Please try again.');
    const db = database(), now = Date.now(), stamp = new Date(now).toISOString(), day = new Date(now - 86400000).toISOString();
    const keys = edition ? ['edition:' + edition.editionId, ...(edition.isbns ?? []).map(value => 'isbn:' + value)] : [];
    const result = await db.batch([
      db.prepare(`INSERT INTO community_assets (id,contributor_id,kind,status,storage_id,object_key,mime,size,content_hash,edition_key,metadata,consent_version,review_note,created_at,updated_at)
        SELECT ?,owner_id,?,'pending',id,object_key,?,size,?,?,?,?,'',?,? FROM asset_transfers
        WHERE id=? AND owner_id=? AND state='uploading' AND expires_at>? AND ${activeOwner}
          AND EXISTS (SELECT 1 FROM assets WHERE id=? AND owner_id=? AND object_key=?)
          AND (SELECT COUNT(*) FROM community_assets WHERE contributor_id=? AND status='pending')<40
          AND (SELECT COUNT(*) FROM community_assets WHERE contributor_id=? AND created_at>=?)<20
          AND NOT EXISTS (SELECT 1 FROM community_assets WHERE contributor_id=? AND content_hash=? AND kind=? AND edition_key=? AND status IN ('pending','approved'))`)
        .bind(id, input.kind, original.mime, hash, editionKey, JSON.stringify(metadata), SHARED_ASSET_CONSENT, stamp, stamp,
          transfer.id, ownerId, now, ownerId, ownerId, ownerId, original.id, ownerId, original.object_key, ownerId, ownerId, day, ownerId, hash, input.kind, editionKey),
      ...keys.map(key => db.prepare('INSERT INTO community_asset_editions (asset_id,edition_key) SELECT ?,? WHERE EXISTS (SELECT 1 FROM community_assets WHERE id=?)').bind(id, key, id)),
      db.prepare('DELETE FROM asset_transfers WHERE id=? AND EXISTS (SELECT 1 FROM community_assets WHERE id=? AND storage_id=asset_transfers.id AND object_key=asset_transfers.object_key)').bind(transfer.id, id),
    ]);
    if (result[0].meta.changes !== 1) {
      const duplicate = await db.prepare("SELECT * FROM community_assets WHERE contributor_id=? AND content_hash=? AND kind=? AND edition_key=? AND status IN ('pending','approved')").bind(ownerId, hash, input.kind, editionKey).first<CommunityAssetRow>();
      if (duplicate) { await abandonAssetTransfer(env, transfer, true); await cleanupAssetTransfers(env, { ownerId, limit: 2 }); return fromRow(duplicate, ownerId); }
      throw new HttpError(409, 'This contribution could not be saved. Check your account and source image. You can contribute up to 20 items a day and keep 40 awaiting review.');
    }
    return getSharedAsset(id, ownerId);
  } catch (error) {
    try { await abandonAssetTransfer(env, transfer, writerDone); await cleanupAssetTransfers(env, { ownerId, limit: 2 }); } catch { console.error('cybershelf community copy cleanup deferred'); }
    throw error;
  }
}

export async function resolveSharedBookAssets(books: SharedAssetBookIdentity[], viewerId?: string) {
  const all = new Map<string, SharedAsset>();
  for (let offset = 0; offset < books.length; offset += 30) {
    const keys = [...new Set(books.slice(offset, offset + 30).flatMap(book => [book.editionId ? 'edition:' + book.editionId : '', canonicalISBN(book.isbn) ? 'isbn:' + canonicalISBN(book.isbn) : '']).filter(Boolean))];
    if (!keys.length) continue;
    // Two hundred alternatives per batch is an explicit safety bound; the
    // resolver marks truncated batches ambiguous rather than choosing a winner.
    const rows = await database().prepare(`SELECT DISTINCT a.* FROM community_assets a JOIN community_asset_editions e ON e.asset_id=a.id WHERE e.edition_key IN (${keys.map(() => '?').join(',')}) AND ${publicVisible('a', viewerId)} ORDER BY a.id LIMIT 201`)
      .bind(...keys, ...(viewerId ? [viewerId, viewerId] : [])).all<CommunityAssetRow>();
    for (const row of rows.results) all.set(row.id, fromRow(row, viewerId));
    if (rows.results.length > 200) return { matches: books.map(book => ({ bookId: book.id, alternatives: [] })), truncated: true };
  }
  return { matches: books.map(book => matchSharedBookArtwork(book, [...all.values()])) };
}

/** Queuing bytes and revoking visibility are one transaction. A stale public
 * reference never grants access after withdrawal, even if R2 cleanup is delayed. */
async function removeSharedCopy(id: string, status: 'rejected' | 'withdrawn', ownerId: string | undefined, moderatorId: string | undefined, note: string) {
  const db = database(), now = Date.now(), stamp = new Date(now).toISOString();
  const predicate = `id=? AND status IN ('pending','approved')${ownerId ? ' AND contributor_id=?' : ''}`;
  const values = [id, ...(ownerId ? [ownerId] : [])];
  const result = await db.batch([
    db.prepare(`INSERT INTO community_asset_erasures (asset_id,storage_id,requested_at,expires_at) SELECT id,storage_id,?,? FROM community_assets WHERE ${predicate}
      ON CONFLICT(asset_id) DO UPDATE SET requested_at=excluded.requested_at,expires_at=excluded.expires_at`).bind(now, now + 35 * 86400000, ...values),
    db.prepare(`INSERT INTO asset_transfers (id,owner_id,object_key,size,state,writer_done,created_at,updated_at,expires_at,next_attempt_at,attempts,lease_until)
      SELECT storage_id,COALESCE(contributor_id,'community'),object_key,size,'cleanup',1,?,?,?,?,0,0 FROM community_assets WHERE ${predicate}
      ON CONFLICT(id) DO UPDATE SET state='cleanup',writer_done=1,updated_at=excluded.updated_at,next_attempt_at=excluded.next_attempt_at`).bind(now, now, now, now, ...values),
    db.prepare(`INSERT INTO community_asset_reviews (id,asset_id,moderator_id,action,note,created_at) SELECT ?,id,?,?,?,? FROM community_assets WHERE ${predicate}`)
      .bind('car_' + crypto.randomUUID(), moderatorId ?? null, status, note, stamp, ...values),
    db.prepare(`UPDATE community_assets SET status=?,review_note=?,updated_at=? WHERE ${predicate}`).bind(status, note, stamp, ...values),
  ]);
  if (!result.at(-1)!.meta.changes) throw new HttpError(409, 'This contribution is no longer awaiting this action. Refresh the collection.');
  try { await cleanupAssetTransfers(env, { ...(ownerId ? { ownerId } : {}), limit: 2 }); } catch { console.error('cybershelf community removal cleanup deferred'); }
}
export async function withdrawSharedAsset(id: string, ownerId: string) {
  const row = await database().prepare('SELECT status FROM community_assets WHERE id=? AND contributor_id=?').bind(id, ownerId).first<{ status: SharedAssetStatus }>();
  if (!row) throw new HttpError(404, 'This contribution is unavailable.');
  if (row.status === 'withdrawn' || row.status === 'rejected') return { withdrawn: true };
  await removeSharedCopy(id, 'withdrawn', ownerId, undefined, 'Withdrawn by its contributor.');
  return { withdrawn: true };
}
export async function reviewSharedAsset(id: string, moderatorId: string, action: 'approve' | 'reject' | 'withdraw', note: string): Promise<SharedAsset> {
  if (action !== 'approve') await removeSharedCopy(id, action === 'reject' ? 'rejected' : 'withdrawn', undefined, moderatorId, note);
  else {
    const db = database(), stamp = new Date().toISOString();
    const row = await db.prepare("SELECT * FROM community_assets WHERE id=? AND status='pending'").bind(id).first<CommunityAssetRow>();
    if (!row || !row.contributor_id || row.contributor_id === moderatorId) throw new HttpError(409, 'Choose a pending contribution from another reader.');
    const head = await bucket().head(row.object_key);
    if (!head || head.size !== row.size) throw new HttpError(409, 'The contribution image is unavailable. Reject this submission and ask for a new upload.');
    const eligible = `id=? AND status='pending' AND contributor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM community_asset_erasures e WHERE e.asset_id=community_assets.id)
      AND EXISTS (SELECT 1 FROM auth_user u WHERE u.id=community_assets.contributor_id) AND NOT EXISTS (SELECT 1 FROM account_deletion_jobs d WHERE d.owner_id=community_assets.contributor_id)
      AND NOT EXISTS (SELECT 1 FROM account_suspensions s WHERE s.user_id=community_assets.contributor_id)`;
    const result = await db.batch([
      db.prepare(`INSERT INTO community_asset_reviews (id,asset_id,moderator_id,action,note,created_at) SELECT ?,id,?,'approved',?,? FROM community_assets WHERE ${eligible}`).bind('car_' + crypto.randomUUID(), moderatorId, note, stamp, id),
      db.prepare(`UPDATE community_assets SET status='approved',review_note=?,updated_at=? WHERE ${eligible}`).bind(note, stamp, id),
    ]);
    if (!result[1].meta.changes) throw new HttpError(409, 'This contribution changed during review. Refresh the queue.');
  }
  return getSharedAsset(id, moderatorId, true);
}

export async function sharedAssetImageResponse(id: string, request: Request, viewerId?: string): Promise<Response> {
  if (!validId(id)) throw new HttpError(404, 'This shared image is unavailable.');
  let moderator = false;
  if (viewerId && configuredModerator(viewerId)) { await requireModerator(viewerId); moderator = true; }
  const headers: Record<string, string> = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox", 'Referrer-Policy': 'no-referrer' };
  if (id.startsWith('dc_')) {
    const source = DECOR_CATALOGUE.find(asset => asset.id === id);
    const hidden = !moderator && source ? await database().prepare("SELECT 1 FROM moderation_hidden WHERE target_kind='asset' AND target_id=?").bind(id).first() : null;
    if (!source || hidden) throw new HttpError(404, 'This shared image is unavailable.');
    const staticAssets = (env as unknown as { ASSETS?: Fetcher }).ASSETS;
    const path = new URL(request.url).searchParams.get('size') === 'thumb' ? source.thumbnailUrl : source.imageUrl;
    if (!staticAssets || !/^\/decor-catalogue\/[a-zA-Z0-9/_-]+\.(?:png|webp)$/.test(path)) throw new HttpError(503, 'The decoration collection is temporarily unavailable.');
    const response = await staticAssets.fetch(new URL(path, request.url));
    if (!response.ok) throw new HttpError(404, 'This shared image is unavailable.');
    const mime = path.endsWith('.png') ? 'image/png' : 'image/webp';
    return new Response(response.body, { headers: { ...headers, 'Content-Type': mime, 'Content-Disposition': 'inline; filename="cybershelf-decoration.' + (mime === 'image/png' ? 'png' : 'webp') + '"' } });
  }
  const row = await database().prepare('SELECT * FROM community_assets WHERE id=?').bind(id).first<CommunityAssetRow>();
  if (!row || !['approved', 'pending'].includes(row.status)) throw new HttpError(404, 'This shared image is unavailable.');
  if (!moderator && !(row.status === 'pending' && row.contributor_id === viewerId)) {
    const allowed = await database().prepare(`SELECT 1 FROM community_assets a WHERE a.id=? AND ${publicVisible('a', viewerId)}`).bind(id, ...(viewerId ? [viewerId, viewerId] : [])).first();
    if (!allowed) throw new HttpError(404, 'This shared image is unavailable.');
  }
  const image = await bucket().get(row.object_key);
  if (!image || image.size !== row.size) { if (image) void image.body.cancel(); throw new HttpError(404, 'This shared image is unavailable.'); }
  // Repeat the visibility decision after object retrieval to avoid a withdrawal
  // race returning a just-revoked body from a slow storage GET.
  const current = await database().prepare('SELECT status,contributor_id FROM community_assets WHERE id=?').bind(id).first<{ status: SharedAssetStatus; contributor_id: string | null }>();
  if (!current || !['approved', 'pending'].includes(current.status) || (current.status === 'pending' && !moderator && current.contributor_id !== viewerId)) {
    void image.body.cancel(); throw new HttpError(404, 'This shared image is unavailable.');
  }
  if (!moderator && current.status === 'approved') {
    const stillVisible = await database().prepare(`SELECT 1 FROM community_assets a WHERE a.id=? AND ${publicVisible('a', viewerId)}`).bind(id, ...(viewerId ? [viewerId, viewerId] : [])).first();
    if (!stillVisible) { void image.body.cancel(); throw new HttpError(404, 'This shared image is unavailable.'); }
  }
  const extension = row.mime === 'image/png' ? 'png' : row.mime === 'image/webp' ? 'webp' : 'jpg';
  return new Response(image.body, { headers: { ...headers, 'Content-Type': row.mime, 'Content-Length': String(image.size),
    'Content-Disposition': 'inline; filename="cybershelf-shared-image.' + extension + '"' } });
}
export function sharedAssetError(error: unknown): never {
  if (error instanceof AssetTransferError) throw new HttpError(error.status, error.message, error.code);
  throw error;
}
