import { DEFAULT_PATCH, migratePatch, type EnginePerformance, type ParamPath, type Patch, type Ramp, type SynthEvent, type WorkletResponse } from '@pulsesynth/shared';

export type EngineOptions = {
  audioContext?: AudioContext;
  polyphony?: number;
  latencyHint?: AudioContextLatencyCategory;
  wasmUrl?: string;
  workletUrl?: string;
  crossOriginIsolatedMode?: 'auto'|'sab'|'port';
};

export type SynthInstance = { id: string; patch: Patch };

export async function createEngine(options: EngineOptions = {}) {
  const ctx = options.audioContext ?? new AudioContext({ latencyHint: options.latencyHint ?? 'interactive' });
  const workletUrl = options.workletUrl ?? '/worklet/processor.js';
  await ctx.audioWorklet.addModule(workletUrl);
  const node = new AudioWorkletNode(ctx, 'pulse-synth-processor', { outputChannelCount: [2], numberOfInputs: 0, numberOfOutputs: 1 });
  const perf: EnginePerformance = { cpuMsAvg: 0, cpuMsP95: 0, xruns: 0, audioQuantumMs: 128 / ctx.sampleRate * 1000, sampleRate: ctx.sampleRate, renderedFrames: 0 };
  let patch = DEFAULT_PATCH;
  node.port.onmessage = ({ data }: MessageEvent<WorkletResponse>) => {
    if (data.type === 'perfResponse') Object.assign(perf, data.perf);
  };

  node.connect(ctx.destination);
  node.port.postMessage({ type: 'init', wasmUrl: options.wasmUrl, sampleRate: ctx.sampleRate, maxVoices: options.polyphony ?? 8 });

  const enqueue = (events: SynthEvent[]) => node.port.postMessage({ type: 'eventBatch', events });

  return {
    async start() { if (ctx.state !== 'running') await ctx.resume(); },
    async stop() { if (ctx.state === 'running') await ctx.suspend(); },
    createSynth(p?: Patch): SynthInstance { patch = migratePatch(p ?? DEFAULT_PATCH); node.port.postMessage({ type: 'patch', patch }); return { id: crypto.randomUUID(), patch }; },
    loadPatch(p: Patch) { patch = migratePatch(p); node.port.postMessage({ type: 'patch', patch }); },
    exportPatch() { return patch; },
    noteOn(note: number, velocity: number, time = ctx.currentTime) { enqueue([{ type: 'noteOn', note, velocity, time }]); },
    noteOff(note: number, time = ctx.currentTime) { enqueue([{ type: 'noteOff', note, time }]); },
    allNotesOff(time = ctx.currentTime) { enqueue([{ type: 'allNotesOff', time }]); },
    setParam(path: ParamPath, value: number, time = ctx.currentTime, ramp: Ramp = 'step') { enqueue([{ type: 'param', path, value, time, ramp }]); },
    schedule(events: SynthEvent[], timeBase = 0) { enqueue(events.map((e) => ({ ...e, time: e.time + timeBase }))); },
    getPerformance() { node.port.postMessage({ type: 'perfRequest' }); return { ...perf }; },
    async destroy() { node.disconnect(); await ctx.close(); }
  };
}
