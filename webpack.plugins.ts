import type { WebpackPluginInstance } from 'webpack';
import type IForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
import Dotenv from 'dotenv-webpack';
import path from 'path';
import fs from 'fs';
import { CHANNEL } from './src/config/channel';

// Toggle this to enable/disable real-time TypeScript type checking during builds
const ENABLE_TYPE_CHECKING = false;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ForkTsCheckerWebpackPlugin: typeof IForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

// Real env vars (APP_CHANNEL from make:prod) win over these file values because
// dotenv-webpack copies systemvars in before reading the .env file.
const channelEnvFile = CHANNEL === 'stable' ? '.env.production' : '.env.local';
const dotenvPath = [channelEnvFile, '.env']
  .map(f => path.resolve(__dirname, f))
  .find(fs.existsSync);

export const plugins: WebpackPluginInstance[] = [
  ...(ENABLE_TYPE_CHECKING
    ? [new ForkTsCheckerWebpackPlugin({ logger: 'webpack-infrastructure' })]
    : []),
  // In CI there's no .env file; the values come from systemvars (the job env),
  // so skip the path and silence the "Failed to load" warning.
  new Dotenv(
    dotenvPath
      ? { path: dotenvPath, safe: false, systemvars: true }
      : { systemvars: true, silent: true }
  ),
];
