/**
 * Runs on `npm install`/`pnpm install` (prepare lifecycle). Builds dist/
 * when missing; no-ops otherwise. dist/ is gitignored (build output), so a
 * git-dependency install (e.g. `github:owner/local-ai#<ref>`) has nothing
 * to import from until this runs — npm/pnpm invoke `prepare` specifically
 * for git dependencies to cover exactly this case. Same pattern as
 * llama-cpp-pro's own scripts/prepare-js-dist.cjs.
 */
const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

const root = join(__dirname, '..');
const marker = join(root, 'dist', 'core', 'index.js');

if (existsSync(marker)) {
  process.exit(0);
}

const r = spawnSync('npm', ['run', 'build'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(r.status ?? 1);
