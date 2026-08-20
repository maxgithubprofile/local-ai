import { describe, it, expect, vi, beforeEach } from 'vitest';

// @capacitor/filesystem's `Filesystem` singleton is mocked directly —
// CapacitorFsAdapter imports it by name, not via registerPlugin(), unlike
// the DeviceInfo plugin this same adapter also uses (see freeSpaceBytes()).
const mockGetUri = vi.fn((..._args: unknown[]): Promise<{ uri: string }> => Promise.resolve({ uri: 'file:///data/user/0/com.forta.chat/files/models/a.gguf' }));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Filesystem: {
    getUri: (...args: unknown[]) => mockGetUri(...args),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isPluginAvailable: () => false },
  registerPlugin: () => ({}),
}));

// vi.mock factories are hoisted above imports/local variables, so the mocked
// module is loaded dynamically after registering the mocks — matches
// capacitor-range-download.adapter.test.ts's own ordering in this repo.
const { CapacitorFsAdapter } = await import('../../../src/adapters/capacitor/capacitor-fs.adapter.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUri.mockImplementation((..._args: unknown[]) =>
    Promise.resolve({ uri: 'file:///data/user/0/com.forta.chat/files/models/a.gguf' }),
  );
});

describe('CapacitorFsAdapter.toAbsolutePath()', () => {
  it('resolves via Filesystem.getUri() with this adapter\'s path + directory, and strips the file:// prefix', async () => {
    const adapter = new CapacitorFsAdapter();

    const result = await adapter.toAbsolutePath('models/a.gguf');

    expect(result).toBe('/data/user/0/com.forta.chat/files/models/a.gguf');
    expect(mockGetUri).toHaveBeenCalledWith({ path: 'models/a.gguf', directory: 'DATA' });
  });

  it('returns the uri unchanged when it has no file:// prefix', async () => {
    mockGetUri.mockResolvedValue({ uri: '/data/user/0/com.forta.chat/files/models/a.gguf' });
    const adapter = new CapacitorFsAdapter();

    const result = await adapter.toAbsolutePath('models/a.gguf');

    expect(result).toBe('/data/user/0/com.forta.chat/files/models/a.gguf');
  });

  it('decodes percent-encoded characters — confirmed live on Android, 2026-08-20: a `:` in a session filename came back as %3A and broke saveSession/loadSession path matching', async () => {
    mockGetUri.mockResolvedValue({
      uri: 'file:///data/user/0/com.forta.chat/files/sessions/session-abc-qwen3-4b%3A1.bin',
    });
    const adapter = new CapacitorFsAdapter();

    const result = await adapter.toAbsolutePath('sessions/session-abc-qwen3-4b:1.bin');

    expect(result).toBe('/data/user/0/com.forta.chat/files/sessions/session-abc-qwen3-4b:1.bin');
  });
});
