import { describe, expect, it } from 'vitest';
import { SupportChecker } from '../../../src/core/support/support-checker.js';
import { FakePlatformSupportAdapter } from '../../../src/adapters/node-testing/fake-platform-support.adapter.js';

describe('SupportChecker', () => {
  it('reports every capability available on a fully-equipped native build', async () => {
    const platform = new FakePlatformSupportAdapter({
      platform: 'android',
      isNative: true,
      availablePlugins: ['LlamaCpp', 'CapacitorSQLite', 'CapacitorDownloader', 'DeviceInfo'],
    });
    const report = await new SupportChecker(platform).check();

    expect(report.platform).toBe('android');
    expect(report.isNative).toBe(true);
    expect(report.capabilities).toEqual({
      inference: true,
      sql: true,
      vectorSearch: true,
      download: true,
      deviceInfo: true,
    });
    expect(report.missingPlugins).toEqual([]);
    expect(report.reasons).toEqual([]);
  });

  it('reports inference/download/deviceInfo unavailable on web even if plugins are somehow "available"', async () => {
    const platform = new FakePlatformSupportAdapter({
      platform: 'web',
      isNative: false,
      availablePlugins: ['LlamaCpp', 'CapacitorSQLite', 'CapacitorDownloader', 'DeviceInfo'],
    });
    const report = await new SupportChecker(platform).check();

    expect(report.capabilities.inference).toBe(false);
    expect(report.capabilities.download).toBe(false);
    expect(report.capabilities.deviceInfo).toBe(false);
    // sql/vectorSearch stay true on web — CapacitorSQLite declares web support (ADR 0002/0005).
    expect(report.capabilities.sql).toBe(true);
    expect(report.capabilities.vectorSearch).toBe(true);
    expect(report.reasons.some((r) => r.includes("platform 'web' does not support LlamaCpp"))).toBe(true);
  });

  it('reports inference unavailable natively when the LlamaCpp plugin is missing, with a distinct reason', async () => {
    const platform = new FakePlatformSupportAdapter({
      platform: 'ios',
      isNative: true,
      availablePlugins: ['CapacitorSQLite', 'CapacitorDownloader', 'DeviceInfo'],
    });
    const report = await new SupportChecker(platform).check();

    expect(report.capabilities.inference).toBe(false);
    expect(report.missingPlugins).toContainEqual({ capability: 'inference', pluginName: 'LlamaCpp', required: true });
    expect(report.reasons.some((r) => r.includes('required plugin LlamaCpp is not available'))).toBe(true);
  });

  it('missing deviceInfo does not affect any other capability (soft dependency, TZ §4.5)', async () => {
    const platform = new FakePlatformSupportAdapter({
      platform: 'android',
      isNative: true,
      availablePlugins: ['LlamaCpp', 'CapacitorSQLite', 'CapacitorDownloader'],
    });
    const report = await new SupportChecker(platform).check();

    expect(report.capabilities.deviceInfo).toBe(false);
    expect(report.capabilities.inference).toBe(true);
    expect(report.capabilities.sql).toBe(true);
    expect(report.capabilities.download).toBe(true);
    expect(report.missingPlugins).toEqual([{ capability: 'deviceInfo', pluginName: 'DeviceInfo', required: false }]);
  });

  it('normalizes an unrecognized platform string to "unknown"', async () => {
    const platform = new FakePlatformSupportAdapter({ platform: 'linux-gtk', isNative: false, availablePlugins: [] });
    const report = await new SupportChecker(platform).check();
    expect(report.platform).toBe('unknown');
  });

  it('recognizes "electron" as a real, non-degraded platform (TZ v6 §6.1, docs/decisions.md #4)', async () => {
    const platform = new FakePlatformSupportAdapter({
      platform: 'electron',
      isNative: true,
      availablePlugins: ['LlamaCpp', 'CapacitorSQLite', 'CapacitorDownloader'],
    });
    const report = await new SupportChecker(platform).check();
    expect(report.platform).toBe('electron');
    expect(report.capabilities.inference).toBe(true);
    expect(report.capabilities.sql).toBe(true);
    expect(report.capabilities.download).toBe(true);
  });
});
