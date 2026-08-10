import { defineConfig } from 'tsup';

/**
 * Dual ESM/CJS build with three independent entry points (see TZ §3.1):
 * core is the platform-free package root; the two adapter subpaths are
 * published separately so a consumer only pulls in the Capacitor (or
 * Node-testing) dependency graph it actually needs.
 */
export default defineConfig({
  entry: {
    'core/index': 'src/core/index.ts',
    'adapters/capacitor/index': 'src/adapters/capacitor/index.ts',
    'adapters/node-testing/index': 'src/adapters/node-testing/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
});
