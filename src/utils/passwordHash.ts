// Deterministic SHA-256 / fallback hash utility for candidate & master password verification

export async function hashPasswordSha256(plainText: string): Promise<string> {
  const clean = plainText.trim();
  if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(clean);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return simpleFallbackHash(clean);
}

export function simpleFallbackHash(plainText: string): string {
  const clean = plainText.trim();
  let h1 = 0xdeadbeef ^ clean.length;
  let h2 = 0x41c6ce57 ^ clean.length;
  for (let i = 0, ch; i < clean.length; i++) {
    ch = clean.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (
    (h2 >>> 0).toString(16).padStart(8, '0') +
    (h1 >>> 0).toString(16).padStart(8, '0')
  );
}

export async function verifyPasswordMatch(
  enteredPassword: string,
  storedPlainOrHash?: string,
  storedHash?: string
): Promise<boolean> {
  const cleanEntered = enteredPassword.trim();
  if (!cleanEntered) return false;

  const enteredSha256 = await hashPasswordSha256(cleanEntered);
  const enteredFallback = simpleFallbackHash(cleanEntered);

  if (storedHash) {
    const cleanStoredHash = storedHash.trim();
    if (
      cleanStoredHash === enteredSha256 ||
      cleanStoredHash === enteredFallback ||
      cleanStoredHash === cleanEntered
    ) {
      return true;
    }
  }

  if (storedPlainOrHash) {
    const cleanStored = storedPlainOrHash.trim();
    if (
      cleanStored === cleanEntered ||
      cleanStored === enteredSha256 ||
      cleanStored === enteredFallback
    ) {
      return true;
    }
  }

  return false;
}
