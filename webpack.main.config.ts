import path from 'path';
import type { Configuration } from 'webpack';
import CopyWebpackPlugin from 'copy-webpack-plugin';

import { rules } from './webpack.rules';
import { plugins } from './webpack.plugins';

export const mainConfig: Configuration = {
  // The scan worker is a separate entry so its deps (music-metadata,
  // better-sqlite3) get bundled in; a copied file can't resolve them from the
  // packaged asar.
  entry: {
    index: './src/index.ts',
    musicScanWorker: './src/main/utils/musicScanWorker.js',
  },
  output: {
    // Emit one file per entry instead of the forge plugin's hardcoded index.js.
    filename: '[name].js',
  },
  // Terser can't parse music-metadata's modern ESM once bundled.
  optimization: {
    minimize: false,
  },
  externals: {
    'react-native-fs': 'reactNativeFs',
    ...(process.env.NODE_ENV === 'development' && { 'better-sqlite3': 'commonjs better-sqlite3' }),
  },
  module: {
    rules,
  },
  plugins: [
    ...plugins,
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.join(__dirname, 'src', 'loader.html'),
          to: '.',
        },
      ],
    }),
  ],
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.json', '.scss', '.sass'],
  },
};
