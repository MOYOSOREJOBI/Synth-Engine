import { describe, expect, it } from 'vitest';
import { migratePatch } from './index';

describe('patch migration', () => {
  it('migrates v1 to v2', () => {
    const migrated = migratePatch({ version: 1, name: 'x', oscType: 'sine', masterGain: 0.4, filter: { cutoff: 1000, resonance: 1 }, env: { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.4 }, lfo: { rate: 1, depth: 0.1, target: 'cutoff' }, metadata: { tags: [] } });
    expect(migrated.version).toBe(2);
  });
});
