/** Public book identity belongs to a work; an edition is an optional, explicit
 * choice. A library row keeps its own id and the reader's private reading data. */
export interface CatalogEdition {
  editionId: string;
  title: string;
  coverUrl: string;
  isbn?: string;
  pages?: number;
  publishDate?: string;
  publishers: string[];
  languages: string[];
  physicalFormat?: string;
}

export interface CatalogBook {
  id: string;
  source: 'openlibrary' | 'community';
  title: string;
  author: string;
  authors: string[];
  description: string;
  coverUrl: string;
  firstPublished?: string;
  subjects: string[];
  sourceUrl?: string;
  editions: CatalogEdition[];
  editionCount: number;
  editionsOffset: number;
  nextEditionsOffset: number | null;
}

export interface CatalogCandidate {
  catalogId: string;
  title: string;
  author: string;
  coverUrl: string;
  firstPublished?: string;
  editionId?: string;
}

export interface CatalogResolution {
  match: { catalogId: string; editionId?: string } | null;
  candidates: CatalogCandidate[];
}

export const CATALOG_EDITIONS_PAGE_SIZE = 24;

export function normalizeOpenLibraryWorkId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return /^(?:\/works\/)?(OL[1-9]\d{0,11}W)$/.exec(value.trim())?.[1];
}

export function normalizeOpenLibraryEditionId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return /^(?:\/books\/)?(OL[1-9]\d{0,11}M)$/.exec(value.trim())?.[1];
}

export function normalizeCatalogId(value: unknown): string | undefined {
  const workId = normalizeOpenLibraryWorkId(value);
  if (workId) return workId;
  return typeof value === 'string' && /^cs_[a-f0-9]{64}$/.test(value.trim()) ? value.trim() : undefined;
}

/** Tolerate only typography differences. Subtitles, translated names, initials
 * and series annotations remain distinct; the user can choose a candidate. */
export function catalogMatchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]/gu, '');
}
