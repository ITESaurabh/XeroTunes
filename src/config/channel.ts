export type Channel = 'stable' | 'beta';

// Beta is the default; a release build must opt in with APP_CHANNEL=stable
export const CHANNEL: Channel = process.env.APP_CHANNEL === 'stable' ? 'stable' : 'beta';

interface Identity {
  productName: string; // display name: window/menu, macOS menu bar, Titlebar
  appId: string; // Windows AppUserModelId; drives taskbar grouping + SMTC
  installName: string; // Squirrel/deb/rpm package + executable name (no spaces)
  menuKey: string; // registry subkey for the "Open with" context menu
  label: string; // Titlebar channel badge; empty on stable
}

const IDENTITIES: Record<Channel, Identity> = {
  stable: {
    productName: 'XeroTunes',
    appId: 'com.itesaurabh.xerotunes',
    installName: 'xerotunes',
    menuKey: 'XeroTunes',
    label: '',
  },
  beta: {
    productName: 'XeroTunes Beta',
    appId: 'com.itesaurabh.xerotunes-beta',
    installName: 'xerotunes-beta',
    menuKey: 'XeroTunesBeta',
    label: 'Beta',
  },
};

export const IDENTITY: Identity = IDENTITIES[CHANNEL];
