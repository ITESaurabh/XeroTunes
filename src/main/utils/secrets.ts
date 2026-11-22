import fs from 'fs';
import path from 'path';
import { safeStorage } from 'electron';
import { APP_CONF_FOLDER } from '../../config/core_config';

// Unprefixed values predate encryption and pass through openSecret, so old
// installs keep signing in. Long because a legacy value can be a Subsonic password.
const PREFIX = 'xt-sealed:v1:';
// Not in settings.json: a settings reset mustn't turn it off while sealed values remain.
const FLAG_FILE = path.join(APP_CONF_FOLDER, 'sign-in-protection.json');

let enabled: boolean | null = null;

export const isSealed = (stored: string | null | undefined): boolean =>
  !!stored?.startsWith(PREFIX);

/** Touches the macOS Keychain, so only call it once the user has opted in. */
function keyringUsable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  // `basic_text` encrypts with a key hardcoded in Chromium, which protects nothing.
  return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text';
}

/** Never reads the macOS Keychain: macOS and Windows always have a store. */
export function keyringAvailable(): boolean {
  return process.platform !== 'linux' || keyringUsable();
}

function readFlag(): boolean | null {
  try {
    const value = JSON.parse(fs.readFileSync(FLAG_FILE, 'utf8')).enabled;
    return typeof value === 'boolean' ? value : null;
  } catch {
    return null;
  }
}

/** Opt-in: on macOS an unsigned build asks for the login password to read the key. */
export function protectionEnabled(): boolean {
  if (enabled === null) enabled = readFlag() ?? false;
  return enabled;
}

export function setProtectionEnabled(on: boolean): void {
  fs.mkdirSync(APP_CONF_FOLDER, { recursive: true });
  fs.writeFileSync(FLAG_FILE, JSON.stringify({ enabled: on }));
  enabled = on;
}

/**
 * Versions before the setting sealed every sign-in, so those installs start with it on.
 * Returns true when sealed values must be opened now because this computer has no keyring.
 */
export function adoptProtectionSetting(hasSealed: () => boolean): boolean {
  if (readFlag() !== null) return false;
  const sealed = hasSealed();
  const on = sealed && keyringAvailable();
  setProtectionEnabled(on);
  return sealed && !on;
}

/** Round-trips a value so a denied Keychain prompt fails here, not on the next sign-in. */
export function keyringWorks(): boolean {
  try {
    return keyringUsable() && safeStorage.decryptString(safeStorage.encryptString('xt')) === 'xt';
  } catch {
    return false;
  }
}

/** Returns the value unchanged while protection is off or the keyring can't be used. */
export function sealSecret(plain: string | null): string | null {
  if (!plain || !protectionEnabled() || !keyringUsable()) return plain;
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
