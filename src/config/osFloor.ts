/**
 * Oldest OS each build runs on: the packages declare it, so older systems refuse
 * the update instead of getting an app that won't start. Raise one on purpose,
 * along with the README and docs/linux-support.md.
 */
export const OS_FLOOR = {
  /** Set by the CI build image, not Electron (which needs 2.25); see docs/linux-support.md. */
  glibc: '2.28',
  /** Electron 43: Monterey. */
  macos: '12.0',
  /** Electron 43: Windows 10. The exe's PE header already makes Windows refuse anything older. */
  windows: '10.0',
};
