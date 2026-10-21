// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import pluginQuery from '@tanstack/eslint-plugin-query';
import globals from 'globals';

export default defineConfig(
  { ignores: ['.webpack/', 'out/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  pluginQuery.configs['flat/recommended'],
  {
    // Rules only: the plugin's `configs.flat` group doesn't fit ESLint's Plugin type.
    plugins: { 'react-hooks': { meta: reactHooks.meta, rules: reactHooks.rules } },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Not the recommended preset, which adds the React Compiler rules.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-duplicate-imports': ['error', { allowSeparateTypeImports: true }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      // The renderer has Node access, so an eval'd string can do anything.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    // CommonJS on purpose: the scan worker, and helpers the node self-checks require.
    files: ['**/*.js'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // The self-checks sit outside tsconfig, so they get no type information.
    files: ['src/**/*.{ts,tsx}', 'scripts/**/*.ts'],
    ignores: ['**/*.check.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          // navigate only returns a promise under a data router; this app uses HashRouter.
          // These two never reject without throwOnError, which nothing here passes.
          allowForKnownSafeCalls: [
            { from: 'package', name: 'NavigateFunction', package: 'react-router' },
            {
              from: 'package',
              name: ['invalidateQueries', 'prefetchQuery'],
              package: '@tanstack/query-core',
            },
          ],
        },
      ],
      // An async onClick is fine: React ignores what a handler returns.
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
    },
  }
);
