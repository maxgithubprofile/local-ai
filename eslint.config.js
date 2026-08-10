// @ts-check
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import jsdoc from 'eslint-plugin-jsdoc';

/**
 * Hexagonal-architecture guardrail (TZ §3): `src/core/**` must not import
 * Capacitor/platform packages or anything from `src/adapters/**`. This is
 * the tooling enforcement CLAUDE.md refers to as a hard rule, not a
 * convention — a PR that violates it fails `npm run lint`.
 */
const coreBoundaryRule = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          group: ['@capacitor/*', '@capacitor-community/*', '@capgo/*', '**/adapters/**'],
          message:
            'src/core/** is platform-free (TZ §3): depend only on src/core/ports/*, never on a concrete Capacitor/adapter package.',
        },
      ],
    },
  ],
};

export default [
  js.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'examples/**/dist/**'],
  },
  {
    files: ['**/*.ts'],
    plugins: {
      '@typescript-eslint': tseslint,
      jsdoc,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: 'module',
        ecmaVersion: 2022,
      },
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // TS itself (via `tsc --noEmit` / `pnpm typecheck`) is the source of truth
      // on undefined identifiers, including ambient lib globals like
      // `AbortSignal` — plain `no-undef` doesn't see TS's lib configuration and
      // produces false positives. Standard advice when using typescript-eslint.
      'no-undef': 'off',
      // Stub methods below intentionally `throw` before ever reaching a
      // `yield` — that's the whole point of a not-implemented placeholder
      // that still satisfies an `AsyncIterable`-returning signature.
      'require-yield': 'off',
    },
  },
  {
    // Public API surface: every exported class/interface/type alias under
    // core/client, core/ports, core/errors and core/types must carry a JSDoc
    // block (TZ §12 — "eslint-plugin-jsdoc проваливает сборку при пропуске").
    // Scoped to top-level declarations for now, not every individual member —
    // ROADMAP.md Phase 7.2 tightens this to full per-method coverage once the
    // stub bodies below become real implementations worth documenting in
    // detail; enforcing that today would just produce boilerplate on
    // `throw new Error('not implemented')` placeholders.
    files: ['src/core/client/**/*.ts', 'src/core/ports/**/*.ts', 'src/core/errors.ts', 'src/core/types.ts'],
    plugins: { jsdoc },
    rules: {
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          require: {
            ClassDeclaration: true,
          },
          contexts: ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration'],
        },
      ],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: coreBoundaryRule,
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
];
