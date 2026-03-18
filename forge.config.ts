import path from 'path';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';

const config: ForgeConfig = {
  packagerConfig: {
    icon:
      process.platform === 'darwin'
        ? [
            './src/assets/logo/XeroTunesLogo',
            './src/assets/logo/XeroTunesLogo.icns',
            './src/assets/logo/XeroTunesLogo.icon',
          ]
        : './src/assets/logo/XeroTunesLogo',

    executableName: 'xero-music-player',
    asar: true,
    appCategoryType: 'public.app-category.music',
    name: 'Xero Music Player',
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: 'xero-music-player',
      iconUrl: path.resolve(__dirname, 'src/assets/logo/XeroTunesLogo.ico'),
      setupIcon: path.resolve(__dirname, 'src/assets/logo/XeroTunesLogo.ico'),
      loadingGif: './src/assets/meowding.gif',
    }),
    new MakerZIP({}, ['darwin']),
    new MakerDeb({
      options: {
        name: 'xero-music-player',
        section: 'sound',
        genericName: 'Music Player',
        categories: ['Audio'],
        icon: './src/assets/logo/XeroTunesLogo.png',
      },
    }),
    new MakerRpm({
      options: {
        name: 'xero-music-player',
        genericName: 'Music Player',
        categories: ['Audio'],
        icon: './src/assets/logo/XeroTunesLogo.png',
      },
    }),
    new MakerDMG({
      name: 'Xero Music Player',
      background: './src/assets/dmg-bg/background.tiff',
      // background: path.resolve(__dirname, 'src/assets/dmg-bg/bg.png'),
      additionalDMGOptions: {
        window: {
          size: { width: 480, height: 320 },
        },
      },
      contents(opts) {
        return [
          {
            x: 45,
            y: 150,
            path: path.resolve(opts.appPath, '..', `${opts.name}.app`),
            type: 'file',
          },
          {
            x: 270,
            y: 70,
            path: '/Applications',
            type: 'link',
          },
        ];
      },
      overwrite: true,
    }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig,
      devContentSecurityPolicy: "'unsafe-eval'",
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './src/index.html',
            js: './src/renderer.ts',
            name: 'main_window',
            preload: {
              js: './src/preload.ts',
            },
          },
          {
            html: './src/mini_player.html',
            js: './src/mini_player_renderer.ts',
            name: 'mini_player',
            preload: {
              js: './src/preload.ts',
            },
          },
          {
            html: './src/overlay.html',
            js: './src/overlay_renderer.ts',
            name: 'overlay',
          },
        ],
      },
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
