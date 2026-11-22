import { hasSealedTokens, resealStoredTokens } from '../sources/sync';
import { hasSealedScrobblerCredential, resealScrobblerCredentials } from './Scrobbler';
import {
  adoptProtectionSetting,
  keyringAvailable,
  keyringWorks,
  protectionEnabled,
  setProtectionEnabled,
} from '../utils/secrets';

export interface SignInProtectionStatus {
  enabled: boolean;
  available: boolean;
}

export interface SignInProtectionResult extends SignInProtectionStatus {
  success: boolean;
  /** Sign-ins left sealed because the keyring wouldn't open them. */
  locked: number;
  error?: string;
}

const resealAll = (): number => resealStoredTokens() + resealScrobblerCredentials();

export const getSignInProtection = (): SignInProtectionStatus => ({
  enabled: protectionEnabled(),
  available: keyringAvailable(),
});

export function initSignInProtection(): void {
  try {
    const mustOpen = adoptProtectionSetting(
      () => hasSealedTokens() || hasSealedScrobblerCredential()
    );
    // With protection on, this reads the key only if a plain value is left to seal.
    if (protectionEnabled() || mustOpen) resealAll();
  } catch (err) {
    console.warn('[secrets] could not match saved sign-ins to the protection setting:', err);
  }
}

export function setSignInProtection(on: boolean): SignInProtectionResult {
  if (on && !keyringWorks()) {
    return {
      ...getSignInProtection(),
      success: false,
      locked: 0,
      error: "The system keyring couldn't be used, so sign-ins stay unencrypted.",
    };
  }
  setProtectionEnabled(on);
  try {
    return { ...getSignInProtection(), success: true, locked: resealAll() };
  } catch (err) {
    return { ...getSignInProtection(), success: false, locked: 0, error: (err as Error).message };
  }
}
