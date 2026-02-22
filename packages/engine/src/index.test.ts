import { describe, expect, it } from 'vitest';
import { createEngine } from './index';
import { DEFAULT_PATCH } from '@pulsesynth/shared';

describe('engine module', () => {
  it('exports createEngine function', () => {
    expect(typeof createEngine).toBe('function');
  });

  it('DEFAULT_PATCH is valid', () => {
    expect(DEFAULT_PATCH.version).toBe(2);
    expect(DEFAULT_PATCH.oscType).toBe('saw');
  });
});
