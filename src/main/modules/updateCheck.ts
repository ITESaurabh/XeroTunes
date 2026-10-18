/** No Electron imports: updateCheck.check.ts runs this under plain node. */

export interface Release {
  tag_name: string;
  prerelease: boolean;
  draft: boolean;
  published_at: string;
  html_url: string;
  assets: { name: string; browser_download_url: string }[];
}

/**
 * install: Squirrel replaces the app (Windows). download: the user installs a
 * file. system: apt, dnf or an AUR helper does.
 */
export type UpdateAction = 'install' | 'download' | 'system';

export interface UpdateStatus {
  state:
    | 'idle'
    | 'checking'
    | 'up-to-date'
    | 'available'
    | 'downloading'
    | 'ready'
    | 'unsupported'
    | 'error';
  version?: string;
  action?: UpdateAction;
  /** The command for action 'system'. */
  hint?: string;
  /** For 'unsupported': the system the new version needs, e.g. "macOS 13.0". */
  needs?: string;
}

const split = (v: string): [number[], string[]] => {
  const [core, ...pre] = v.replace(/^v/, '').split('+')[0].split('-');
  return [core.split('.').map(Number), pre.length ? pre.join('-').split('.') : []];
};

/** Semver precedence, so beta.10 sorts after beta.9. Also orders dotted OS versions. */
export function compareVersions(a: string, b: string): number {
  const [aCore, aPre] = split(a);
  const [bCore, bPre] = split(b);
  for (let i = 0; i < Math.max(aCore.length, bCore.length); i++) {
    const d = (aCore[i] ?? 0) - (bCore[i] ?? 0);
    if (d) return d;
  }
  // 1.0.0 outranks 1.0.0-beta.1.
  if (!aPre.length || !bPre.length) return bPre.length - aPre.length;
  for (let i = 0; i < Math.max(aPre.length, bPre.length); i++) {
    if (aPre[i] === undefined) return -1;
    if (bPre[i] === undefined) return 1;
    const aNum = /^\d+$/.test(aPre[i]);
    const bNum = /^\d+$/.test(bPre[i]);
    if (aNum && bNum) {
      const d = Number(aPre[i]) - Number(bPre[i]);
      if (d) return d;
    } else if (aNum !== bNum) {
      return aNum ? -1 : 1;
    } else if (aPre[i] !== bPre[i]) {
      return aPre[i] < bPre[i] ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Beta ships as prereleases and stable as full releases, and they're different
 * apps, so a channel never takes the other's release.
 */
export function newestRelease(releases: Release[], beta: boolean): Release | null {
  return releases
    .filter(r => !r.draft && r.prerelease === beta)
    .reduce<Release | null>(
      (best, r) => (!best || compareVersions(r.tag_name, best.tag_name) > 0 ? r : best),
      null
    );
}
