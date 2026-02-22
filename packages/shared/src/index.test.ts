import { describe, expect, it } from 'vitest';
import { migratePatch, PatchV2Schema, DEFAULT_PATCH, PARAM_IDS, OSC_TYPE_MAP, KEYBOARD_MAP } from './index';

describe('patch schemas', () => {
  it('validates default patch', () => {
    const result = PatchV2Schema.safeParse(DEFAULT_PATCH);
    expect(result.success).toBe(true);
  });

  it('rejects invalid patch', () => {
    const result = PatchV2Schema.safeParse({ version: 2, name: '' });
    expect(result.success).toBe(false);
  });
});

describe('patch migration', () => {
  it('migrates v1 to v2', () => {
    const v1 = {
      version: 1, name: 'test', oscType: 'sine', masterGain: 0.4,
      filter: { cutoff: 1000, resonance: 1 },
      env: { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.4 },
      lfo: { rate: 1, depth: 0.1, target: 'cutoff' },
      metadata: { tags: [] },
    };
    const migrated = migratePatch(v1);
    expect(migrated.version).toBe(2);
    expect(migrated.noiseAmount).toBe(0);
    expect(migrated.name).toBe('test');
  });

  it('passes through valid v2', () => {
    const migrated = migratePatch(DEFAULT_PATCH);
    expect(migrated.version).toBe(2);
    expect(migrated.name).toBe(DEFAULT_PATCH.name);
  });
});

describe('constants', () => {
  it('PARAM_IDS has expected entries', () => {
    expect(PARAM_IDS.masterGain).toBe(0);
    expect(PARAM_IDS.cutoff).toBe(1);
    expect(PARAM_IDS.oscType).toBe(8);
  });

  it('OSC_TYPE_MAP maps all types', () => {
    expect(OSC_TYPE_MAP.sine).toBe(0);
    expect(OSC_TYPE_MAP.saw).toBe(1);
    expect(OSC_TYPE_MAP.square).toBe(2);
    expect(OSC_TYPE_MAP.triangle).toBe(3);
  });

  it('KEYBOARD_MAP covers 2 octaves', () => {
    expect(KEYBOARD_MAP.z).toBe(48); // C3
    expect(KEYBOARD_MAP.q).toBe(60); // C4
    expect(Object.keys(KEYBOARD_MAP).length).toBeGreaterThan(20);
  });
});
