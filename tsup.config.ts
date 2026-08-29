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
    'adapters/electron/index': 'src/adapters/electron/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  // tsup/esbuild auto-externalizes `dependencies`/`peerDependencies` (the
  // Capacitor plugins here are all `peerDependencies`) but *not*
  // `devDependencies` — `node-llama-cpp` is a devDependency (TZ §3.1's
  // diagram: node-testing's own deps belong in the core package's
  // devDependencies, a consumer using that subpath installs it themselves),
  // and bundling it pulls in `@reflink/reflink`'s per-platform native
  // `.node` bindings, which esbuild can't resolve for platforms other than
  // the one actually running the build — breaks the build entirely, not
  // just a bloat concern. Must stay external regardless of which
  // dependency list it's in.
  external: ['node-llama-cpp'],
});
