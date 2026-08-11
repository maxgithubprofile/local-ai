import { describe, expect, it } from 'vitest';
import { levelMeetsThreshold } from '../../../src/core/logging/log-levels.js';

describe('levelMeetsThreshold()', () => {
  it('is true when level is exactly the threshold', () => {
    expect(levelMeetsThreshold('warn', 'warn')).toBe(true);
  });

  it('is true when level is more severe than the threshold', () => {
    expect(levelMeetsThreshold('error', 'warn')).toBe(true);
    expect(levelMeetsThreshold('error', 'debug')).toBe(true);
  });

  it('is false when level is less severe than the threshold', () => {
    expect(levelMeetsThreshold('debug', 'info')).toBe(false);
    expect(levelMeetsThreshold('info', 'error')).toBe(false);
  });

  it('debug meets nothing but debug, error meets everything', () => {
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      expect(levelMeetsThreshold('error', level)).toBe(true);
    }
    expect(levelMeetsThreshold('debug', 'debug')).toBe(true);
    expect(levelMeetsThreshold('debug', 'info')).toBe(false);
  });
});
