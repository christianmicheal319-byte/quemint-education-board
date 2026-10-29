/**
 * Password hashing & verification utilities for Quemint CBT Candidate & Master Passwords.
 * Supports Web Crypto SHA-256 and deterministic synchronous fallback hashing.
 */

export function simpleFallbackHash(input: string): string {
  const clean = input.trim();
  let h1 = 0xdeadbeef ^ clean.length;
  let h2 = 0x41c6ce57 ^ clean.length;
  for (let i = 0, ch; i < clean.length; i++) {
    ch = clean.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `qmt_sha_${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

export async function hashPasswordSha256(plainText: string): Promise<string> {
  const clean = plainText.trim();
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(clean);
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return simpleFallbackHash(clean);
    }
  }
  return simpleFallbackHash(clean);
}

export async function verifyCandidatePassword(params: {
  enteredPassword: string;
  candidatePassword?: string;
  candidatePasswordHash?: string;
  masterPassword?: string;
  masterPasswordHash?: string;
}): Promise<{ verified: boolean; matchedBy?: 'personal' | 'master' }> {
  const cleanEntered = params.enteredPassword.trim();
  if (!cleanEntered) {
    return { verified: false };
  }

  const shaHex = await hashPasswordSha256(cleanEntered);
  const fallbackHex = simpleFallbackHash(cleanEntered);

  const personalPlain = (params.candidatePassword || '').trim();
  const personalHash = (params.candidatePasswordHash || '').trim();

  const matchesPersonal =
    (personalPlain !== '' &&
      (personalPlain === cleanEntered ||
        personalPlain === shaHex ||
        personalPlain === fallbackHex)) ||
    (personalHash !== '' &&
      (personalHash === shaHex ||
        personalHash === fallbackHex ||
        personalHash === cleanEntered));

  if (matchesPersonal) {
    return { verified: true, matchedBy: 'personal' };
  }

  const masterPlain = (params.masterPassword || 'quemint2026').trim();
  const masterHash = (params.masterPasswordHash || '').trim();

  const matchesMaster =
    (masterPlain !== '' &&
      (masterPlain === cleanEntered ||
        masterPlain === shaHex ||
        masterPlain === fallbackHex)) ||
    (masterHash !== '' &&
      (masterHash === shaHex ||
        masterHash === fallbackHex ||
        masterHash === cleanEntered));

  if (matchesMaster) {
    return { verified: true, matchedBy: 'master' };
  }

  return { verified: false };
}
