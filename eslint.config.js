import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/**', 'dist-smoke/**', 'node_modules/**', '.wrangler/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    // Worker runtime code: no DOM, but the Workers global scope.
    files: ['src/server/**/*.ts', 'src/worker.ts', 'src/ingest.ts', 'functions/**/*.ts'],
    languageOptions: {
      globals: { ...globals.worker, ...globals.node },
    },
  },
  {
    files: ['scripts/**/*.{mjs,js}', '*.config.{ts,js}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['**/*.test.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // The Cloudflare test module is augmented with the environment type, and
    // an empty interface is the documented way to do that.
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
)
