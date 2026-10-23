import type { AppState, Book } from './types';

/** Includes catalog, reading updates, reviews, layout, and private asset references. File binaries
 * remain separate; use each book's Download original action to back those up. */
export function catalogJSON(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

function cell(value: string | number | null | undefined): string {
  let text = String(value ?? '');
  // Protect spreadsheet users from formula injection in user-supplied metadata.
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function catalogCSV(books: Book[]): string {
  const rows: (string | number | null | undefined)[][] = [[
    'Title', 'Author', 'ISBN13', 'My Rating', 'Exclusive Shelf', 'My Review',
    'Private Notes', 'Date Added', 'Date Read', 'Number of Pages', 'Progress', 'Sources',
    'Book Format', 'Height (mm)', 'Cover Width (mm)', 'Spine Thickness (mm)', 'Size Source', 'Spine Color', 'Cover Image URL', 'Spine Image URL',
    'Reading Log', 'Catalog ID', 'Edition ID', 'Current Page',
  ]];
  const statuses = { unread: 'to-read', reading: 'currently-reading', read: 'read', paused: 'paused', dnf: 'did-not-finish' };
  for (const book of books) rows.push([
    book.title, book.author, book.isbn, book.rating, statuses[book.status], book.review,
    book.notes, book.addedAt.slice(0, 10), book.finishedAt?.slice(0, 10), book.pages,
    book.progress, book.sources.map(source => `${source.label}${source.url ? `: ${source.url}` : source.location ? `: ${source.location}` : ''}`).join(' | '),
    book.format, book.dimensions?.heightMm, book.dimensions?.widthMm, book.dimensions?.thicknessMm, book.dimensions?.source, book.color, book.coverUrl, book.spineUrl,
    book.readingLog ? JSON.stringify(book.readingLog) : undefined, book.catalogId, book.editionId, book.currentPage,
  ]);
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function downloadBlob(blob: Blob | string, filename: string, type = 'application/octet-stream'): void {
  const value = typeof blob === 'string' ? new Blob([blob], { type }) : blob;
  const url = URL.createObjectURL(value);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const BACKUP_LIMIT = 100 * 1024 * 1024;
const crcTable = new Uint32Array(256).map((_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** ZIP "store" entries preserve original bytes and need no compression library. */
function storedZip(entries: { name: string; data: Uint8Array }[]): Blob {
  const chunks: BlobPart[] = [], directory: BlobPart[] = [];
  let offset = 0, directorySize = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name), checksum = crc32(entry.data);
    const local = new Uint8Array(30 + name.length), localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true); localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true); // UTF-8 filenames; no encryption.
    localView.setUint16(12, 33, true); // 1980-01-01 (stable, valid ZIP date).
    localView.setUint32(14, checksum, true); localView.setUint32(18, entry.data.byteLength, true);
    localView.setUint32(22, entry.data.byteLength, true); localView.setUint16(26, name.length, true); local.set(name, 30);
    const central = new Uint8Array(46 + name.length), centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true); centralView.setUint16(4, 20, true); centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true); centralView.setUint16(14, 33, true);
    centralView.setUint32(16, checksum, true); centralView.setUint32(20, entry.data.byteLength, true);
    centralView.setUint32(24, entry.data.byteLength, true); centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true); central.set(name, 46);
    chunks.push(local, new Uint8Array(entry.data)); directory.push(central);
    offset += local.byteLength + entry.data.byteLength; directorySize += central.byteLength;
  }
  const end = new Uint8Array(22), endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true); endView.setUint16(8, entries.length, true); endView.setUint16(10, entries.length, true);
  endView.setUint32(12, directorySize, true); endView.setUint32(16, offset, true);
  return new Blob([...chunks, ...directory, end], { type: 'application/zip' });
}

function safeFilename(name: string): string {
  const filename = name.split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f<>:"|?*]/g, '_').replace(/^\.+/, '').trim();
  return Array.from(filename || 'book').slice(0, 150).join('');
}

/** A complete portable download, not a promise of cross-account asset restore.
 * catalog.json restores metadata; manifest.json maps original asset IDs to files. */
export async function createBackupArchive(state: AppState, onProgress: (text: string) => void = () => {}): Promise<Blob> {
  const assets = new Map<string, string>();
  const addImageUrl = (url: string, label: string) => {
    const match = /^\/api\/assets\/([a-z\d_-]+)$/i.exec(url);
    if (match && !assets.has(match[1])) assets.set(match[1], label);
  };
  for (const book of state.books) {
    for (const source of book.sources) if (source.kind === 'file' && source.assetId) assets.set(source.assetId, source.filename || `${book.title}.book`);
    addImageUrl(book.coverUrl, `${book.title}-cover`);
    if (book.spineUrl) addImageUrl(book.spineUrl, `${book.title}-spine`);
  }
  for (const shelf of state.shelves) for (const item of shelf.items) {
    if (item.kind !== 'decor') continue;
    if (item.assetId) assets.set(item.assetId, item.label || 'decoration');
    if (item.imageUrl) addImageUrl(item.imageUrl, item.label || 'decoration');
  }
  if (assets.size > 5000) throw new Error('This backup contains too many files. Export your catalog and download originals individually.');
  const entries = [{ name: 'catalog.json', data: new TextEncoder().encode(catalogJSON(state)) }];
  let size = entries[0].data.byteLength;
  const manifest: { assetId: string; archivePath: string; size: number; mime: string }[] = [];
  let index = 0;
  for (const [assetId, fallbackName] of assets) {
    index++;
    onProgress(`Packing file ${index} of ${assets.size}…`);
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(`/api/assets/${encodeURIComponent(assetId)}`, { credentials: 'same-origin', signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(`Could not download “${fallbackName}”. Check that it is still available in your account, then retry. No partial backup was created.`);
      if (size + Number(response.headers.get('content-length') || 0) > BACKUP_LIMIT) throw new Error('This backup exceeds 100 MB. Export your catalog and download originals individually.');
      const parts: Uint8Array[] = [];
      let fileSize = 0;
      const reader = response.body.getReader();
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          fileSize += part.value.byteLength;
          if (size + fileSize > BACKUP_LIMIT) { await reader.cancel(); throw new Error('This backup exceeds 100 MB. Export your catalog and download originals individually.'); }
          parts.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const data = new Uint8Array(fileSize);
      let position = 0;
      for (const part of parts) { data.set(part, position); position += part.byteLength; }
      const disposition = response.headers.get('content-disposition') || '';
      const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
      let originalName = /filename="([^"\r\n]*)"/i.exec(disposition)?.[1] || fallbackName;
      if (encodedName) { try { originalName = decodeURIComponent(encodedName); } catch { /* use the safe fallback */ } }
      const mime = (response.headers.get('content-type') || 'application/octet-stream').split(';')[0];
      let filename = safeFilename(originalName);
      const extensions: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'application/epub+zip': '.epub', 'application/pdf': '.pdf' };
      if (!/\.[a-z\d]{2,5}$/i.test(filename) && extensions[mime]) filename += extensions[mime];
      const archivePath = `files/${String(index).padStart(4, '0')}-${filename}`;
      entries.push({ name: archivePath, data }); size += fileSize;
      manifest.push({ assetId, archivePath, size: fileSize, mime });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error(`Downloading “${fallbackName}” took too long. Please retry the backup.`);
      throw error;
    } finally { clearTimeout(timeout); }
  }
  entries.push({ name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), files: manifest }, null, 2)) });
  entries.push({ name: 'README.txt', data: new TextEncoder().encode('cybershelf backup\n\nThe files/ folder contains your original uploaded books and images, unchanged.\ncatalog.json contains your catalog, private reading updates, reviews, notes, sources,\nbook appearance, and shelf layouts. Public post identities and comments are not restored.\nmanifest.json maps private asset IDs in the catalog to files in this archive.\n\nRestore catalog.json through cybershelf Settings. On the original account, existing\nprivate files will reconnect. Another account or server needs the files uploaded\nagain; importing this catalog does not transfer access to the original account.\nRemote platform purchases and externally hosted covers are links, not file copies.\n') });
  onProgress('Preparing your download…');
  const archive = storedZip(entries);
  if (archive.size > BACKUP_LIMIT) throw new Error('This backup exceeds 100 MB. Export your catalog and download originals individually.');
  return archive;
}
