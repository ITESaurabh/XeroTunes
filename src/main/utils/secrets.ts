import { safeStorage } from 'electron';

// Unprefixed values predate encryption and pass through openSecret, so old
// installs keep signing in. Long because a legacy value can be a Subsonic password.
const PREFIX = 'xt-sealed:v1:';

export const isSealed = (stored: string | null | undefined): boolean =>
  !!stored?.startsWith(PREFIX);

/** Returns the value unchanged when encryption is unavailable, e.g. on Linux before `ready`. */
export function sealSecret(plain: string | null): string | null {
  if (!plain || !safeStorage.isEncryptionAvailable()) return plain;
  return PREFIX + safeStorage.encryptString(plain).toString('base64');
}

/**
 * Null when the keyring can't decrypt (locked, reset, or a profile from another
 * machine). Never write that null back; the keyring may unlock later.
 */
export function openSecret(stored: string | null): string | null {
  if (!stored || !isSealed(stored)) return stored;
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(PREFIX.length), 'base64'));
  } catch (err) {
    console.warn('[secrets] cannot decrypt a saved sign-in:', (err as Error).message);
    return null;
  }
}

/** False on Linux without a keyring (`basic_text`), where Chromium uses a hardcoded key. */
export function secretsProtected(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text';
}
