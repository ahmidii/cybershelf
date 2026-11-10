import { canonicalISBN } from './spine-image';

export type SharedAssetKind = 'decor' | 'spine' | 'cover';
export type SharedAssetStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';
export type SharedAssetLicense = 'CC0-1.0' | 'CC-BY-4.0' | 'community-permission';
export const SHARED_ASSET_CONSENT = 'community-assets-v1' as const;
export const SHARED_ASSET_CONSENT_TEXT = 'I am deliberately contributing a separate copy for other readers to use on Cybershelf. My chosen creator credit is public. An approved contribution can remain after I delete my account. I can withdraw it from Cybershelf, but cannot recall copies already saved by others.';
export interface SharedAssetEdition {
  catalogId?: string; editionId?: string; isbn?: string; isbns?: string[]; variant?: string;
}
export interface SharedAsset {
  id: string; kind: SharedAssetKind; title: string; description: string;
  tags: string[]; category: string; style: string;
  imageUrl: string; thumbnailUrl: string; width: number; height: number;
  defaultWidthMm: number; defaultHeightMm: number; anchorX: number; anchorY: number;
  creator: string; sourceUrl: string; license: SharedAssetLicense; licenseUrl: string;
  origin: 'curated' | 'community'; status: SharedAssetStatus; createdAt: string;
  edition?: SharedAssetEdition; canWithdraw?: boolean; reviewNote?: string;
}
export interface SharedAssetBookIdentity {
  id: string; catalogId?: string; editionId?: string; isbn?: string;
}
export interface SharedAssetMatch {
  bookId: string; spine?: SharedAsset; cover?: SharedAsset; alternatives: SharedAsset[];
}
export function sharedAssetImageUrl(id: string) { return '/api/community-assets/' + encodeURIComponent(id) + '/image'; }
export function sharedAssetIdFromUrl(value: string | undefined): string | undefined {
  return value?.match(/^\/api\/community-assets\/((?:ca_|dc_)[A-Za-z0-9_-]{1,96})\/image$/)?.[1];
}
export function sharedAssetLicenseUrl(license: SharedAssetLicense): string {
  return license === 'CC0-1.0' ? 'https://creativecommons.org/publicdomain/zero/1.0/'
    : license === 'CC-BY-4.0' ? 'https://creativecommons.org/licenses/by/4.0/' : '/community-contributions';
}
/** Both identifiers must agree when present. Work identity alone is never
 * sufficient to reuse edition artwork. ISBN aliases come only from a verified
 * provider edition, never from an untrusted contribution payload. */
export function sharedAssetMatchesEdition(asset: Pick<SharedAsset, 'edition'>, book: Omit<SharedAssetBookIdentity, 'id'>): boolean {
  const edition = asset.edition;
  if (!edition) return false;
  if (book.catalogId && edition.catalogId && book.catalogId !== edition.catalogId) return false;
  if (book.editionId && edition.editionId && book.editionId !== edition.editionId) return false;
  const isbn = canonicalISBN(book.isbn), known = [...new Set([edition.isbn, ...(edition.isbns ?? [])].map(canonicalISBN).filter(Boolean))];
  if (isbn && known.length && !known.includes(isbn)) return false;
  return !!((book.editionId && edition.editionId === book.editionId) || (isbn && known.includes(isbn)));
}
/** Different artwork variants need a reader's choice. A single approved
 * candidate is the only default; custom selections are handled by the caller. */
export function matchSharedBookArtwork(book: SharedAssetBookIdentity, assets: readonly SharedAsset[]): SharedAssetMatch {
  const matches = assets.filter(asset => asset.status === 'approved' && asset.kind !== 'decor' && sharedAssetMatchesEdition(asset, book));
  const spines = matches.filter(asset => asset.kind === 'spine'), covers = matches.filter(asset => asset.kind === 'cover');
  return { bookId: book.id, ...(spines.length === 1 ? { spine: spines[0] } : {}), ...(covers.length === 1 ? { cover: covers[0] } : {}), alternatives: matches };
}
export function sharedAssetSearchText(asset: Pick<SharedAsset, 'title' | 'description' | 'tags' | 'category' | 'creator'>): string {
  return [asset.title, asset.description, asset.category, asset.creator, ...asset.tags].join(' ').normalize('NFKC').toLocaleLowerCase();
}
