import { defineConfig } from 'vitest/config';

/**
 * `test/device-e2e` is intentionally NOT included anywhere here — it requires
 * a real device/emulator and must never block `npm test` (TZ §13.5). Point
 * this config's `--dir` at `test/unit`, `test/integration`, or `test/contract`
 * explicitly (see package.json scripts) rather than relying on a single glob
 * that could accidentally pick device-e2e specs up later.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'test/device-e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/core/**'],
    },
  },
});
