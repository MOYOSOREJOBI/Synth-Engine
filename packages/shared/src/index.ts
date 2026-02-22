import { z } from 'zod';

export const PatchV1Schema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  oscType: z.enum(['sine','saw','square','triangle']).default('saw'),
  masterGain: z.number().min(0).max(1).default(0.5),
  filter: z.object({ cutoff: z.number().min(20).max(20000), resonance: z.number().min(0.1).max(20) }),
  env: z.object({ attack: z.number().min(0.001).max(5), decay: z.number().min(0.001).max(5), sustain: z.number().min(0).max(1), release: z.number().min(0.001).max(8) }),
  lfo: z.object({ rate: z.number().min(0.01).max(30), depth: z.number().min(0).max(1), target: z.enum(['cutoff','pitch','amp']) }),
  metadata: z.object({ author: z.string().optional(), tags: z.array(z.string()).default([]) }).default({ tags: [] })
});

export const PatchV2Schema = PatchV1Schema.extend({ version: z.literal(2), noiseAmount: z.number().min(0).max(1).default(0) });
export type Patch = z.infer<typeof PatchV2Schema>;

export function migratePatch(input: unknown): Patch {
  const v2 = PatchV2Schema.safeParse(input);
  if (v2.success) return v2.data;
  const v1 = PatchV1Schema.parse(input);
  return { ...v1, version: 2, noiseAmount: 0 };
}

export type ParamPath = 'masterGain' | 'cutoff' | 'resonance' | 'envAttack' | 'envDecay' | 'envSustain' | 'envRelease' | 'lfoRate' | 'lfoDepth';
export type Ramp = 'linear'|'exp'|'step';

export type SynthEvent =
  | { type: 'noteOn'; note: number; velocity: number; time: number }
  | { type: 'noteOff'; note: number; time: number }
  | { type: 'allNotesOff'; time: number }
  | { type: 'param'; path: ParamPath; value: number; time: number; ramp: Ramp };

export type WorkletMessage =
  | { type: 'init'; wasmUrl?: string; sampleRate: number; maxVoices: number }
  | { type: 'eventBatch'; events: SynthEvent[] }
  | { type: 'patch'; patch: Patch }
  | { type: 'perfRequest' };

export type WorkletResponse =
  | { type: 'ready' }
  | { type: 'perfResponse'; perf: EnginePerformance };

export type EnginePerformance = {
  cpuMsAvg: number;
  cpuMsP95: number;
  xruns: number;
  audioQuantumMs: number;
  sampleRate: number;
  renderedFrames: number;
};

export const DEFAULT_PATCH: Patch = {
  version: 2,
  name: 'Warm Starter',
  oscType: 'saw',
  masterGain: 0.45,
  filter: { cutoff: 2200, resonance: 0.5 },
  env: { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.4 },
  lfo: { rate: 2.5, depth: 0.15, target: 'cutoff' },
  metadata: { tags: ['default'] },
  noiseAmount: 0.02
};
