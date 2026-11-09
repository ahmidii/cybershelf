// These secrets have 256 random bits. A fast one-way digest is appropriate for
// a random recovery credential; human-chosen passwords use the password KDF.
export function generateRecoveryKey(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
  return 'csrk_' + hex.match(/.{8}/g)!.join('-');
}

export function canonicalRecoveryKey(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 512) return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]/g, '');
  return /^csrk_[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

export async function hashRecoveryKey(value: string): Promise<string> {
  const canonical = canonicalRecoveryKey(value);
  if (!canonical) throw new Error('Invalid recovery key.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('cybershelf.recovery-key.v1\0' + canonical));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
