import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

/**
 * Flat config. `eslint-config-next` v16 ships native flat config arrays, so no
 * `FlatCompat` shim is needed — each subpath default-exports an array.
 */
const config = [
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // `_`-prefixed bindings are an intentional "declared but unused" marker,
      // used for required-but-ignored callback parameters.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
  },
  {
    // The service worker is plain JS in a worker global scope, and next-env.d.ts
    // is generated — neither is ours to lint.
    ignores: ['.next/**', 'node_modules/**', 'public/sw.js', 'next-env.d.ts'],
  },
];

export default config;
