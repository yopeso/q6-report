// Everything is an error and lint runs at --max-warnings=0, because a warning nobody has to fix is a rule that does not exist.
// Where a rule cannot hold, the exception is a block naming the file and saying why, at the end of this file,
// never a downgrade to 'warn' and never a bare inline disable.

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['node_modules/**', '**/build/**', 'dist/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // The type-aware rules that catch bugs rather than style: a floating promise in a callback,
  // an await on something that is not a promise, an assertion that changes nothing.
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'recorder-test/*.ts', 'scripts/*.ts', 'build.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/require-await': 'error',
    },
  },

  // Import order is off, because it churns diffs and catches no defect; duplicated and misplaced imports are real problems.
  {
    files: ['**/*.{ts,mjs}'],
    plugins: { 'simple-import-sort': simpleImportSort, 'import-x': importX },
    rules: {
      'simple-import-sort/exports': 'error',
      'import-x/first': 'error',
      'import-x/newline-after-import': 'error',
      'import-x/no-duplicates': 'error',
    },
  },

  {
    files: ['**/*.ts'],
    rules: {
      // A leading underscore is how a name says it is unused on purpose.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
      // console.log is a debugging leftover; the levelled calls are intent.
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
    },
  },

  // The configs and the plain ESM scripts run in Node, outside the TypeScript program.
  {
    files: ['*.config.mjs', 'scripts/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Last, so it turns off every rule Prettier already decides.
  prettier,

  // A command's output is its whole job, and nothing else in the package may print.
  {
    files: ['src/cli.ts', 'recorder-test/run.ts', 'scripts/check-report.ts'],
    rules: { 'no-console': 'off' },
  },
];
