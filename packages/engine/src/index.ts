import {
  DEFAULT_PATCH,
  migratePatch,
  type EnginePerformance,
  type ParamPath,
  type Patch,
  type Ramp,
  type SynthEvent,
  type WorkletResponse
} from '@pulsesynth/shared';

export type EngineOptions = {
  audioContext?: AudioContext;
  polyphony?: number;
  latencyHint?: AudioContextLatencyCategory;
  wasmUrl?: string;
  workletUrl?: string;
  patch?: Patch;
  crossOriginIsolatedMode?: 'auto' | 'sab' | 'port';
};

export type SynthEngine = Awaited<ReturnType<typeof createEngine>>;

export async function createEngine(options: EngineOptions = {}) {
  const ctx = options.audioContext ?? new AudioContext({ latencyHint: options.latencyHint ?? 'interactive' });
  const workletUrl = options.workletUrl ?? '/worklet/processor.js';
  const wasmUrl = options.wasmUrl ?? '/wasm/pulsesynth_wasm_dsp.wasm';

  await ctx.audioWorklet.addModule(workletUrl);
  const node = new AudioWorkletNode(ctx, 'pulse-synth-processor', {
    outputChannelCount: [2],
    numberOfInputs: 0,
    numberOfOutputs: 1,
    channelCount: 2,
    channelCountMode: 'explicit'
  });

  const perf: EnginePerformance = {
    cpuMsAvg: 0,
    cpuMsP95: 0,
    xruns: 0,
    audioQuantumMs: (128 / ctx.sampleRate) * 1000,
    sampleRate: ctx.sampleRate,
    renderedFrames: 0,
    voices: 0
  };

  let patch = migratePatch(options.patch ?? DEFAULT_PATCH);
  const perfListeners = new Set<(p: EnginePerformance) => void>();

  node.port.onmessage = ({ data }: MessageEvent<WorkletResponse>) => {
    if (data.type === 'perfResponse') {
      Object.assign(perf, data.perf);
      perfListeners.forEach((fn) => fn({ ...perf }));
    }
    if (data.type === 'error') console.error('[PulseSynth][worklet]', data.message);
  };

  node.connect(ctx.destination);
  node.port.postMessage({
    type: 'init',
    payload: { wasmUrl, sampleRate: ctx.sampleRate, maxVoices: options.polyphony ?? 8, patch }
  });

  const enqueue = (events: SynthEvent[]) => node.port.postMessage({ type: 'eventBatch', events });
  const scheduleParam = (path: ParamPath, value: number, time: number, ramp: Ramp) => {
    const p = node.parameters.get(path);
    if (!p) return;
    if (ramp === 'linear') p.linearRampToValueAtTime(value, time);
    else if (ramp === 'exp') p.exponentialRampToValueAtTime(Math.max(0.0001, value), time);
    else p.setValueAtTime(value, time);
  };

  return {
    context: ctx,
    node,
    async start() {
      if (ctx.state !== 'running') await ctx.resume();
    },
    async stop() {
      if (ctx.state === 'running') await ctx.suspend();
    },
    setPatch(nextPatch: Patch) {
      patch = migratePatch(nextPatch);
      node.port.postMessage({ type: 'patch', patch });
    },
    exportPatch() {
      return patch;
    },
    noteOn(note: number, velocity: number, time = ctx.currentTime) {
      enqueue([{ type: 'noteOn', note, velocity, time }]);
    },
    noteOff(note: number, time = ctx.currentTime) {
      enqueue([{ type: 'noteOff', note, time }]);
    },
    allNotesOff(time = ctx.currentTime) {
      enqueue([{ type: 'allNotesOff', time }]);
    },
    setParam(path: ParamPath, value: number, time = ctx.currentTime, ramp: Ramp = 'step') {
      scheduleParam(path, value, time, ramp);
      enqueue([{ type: 'param', path, value, time, ramp }]);
    },
    schedule(events: SynthEvent[], timeBase = 0) {
      enqueue(events.map((event) => ({ ...event, time: event.time + timeBase })));
    },
    getPerformance() {
      node.port.postMessage({ type: 'perfRequest' });
      return { ...perf };
    },
    onPerformance(fn: (p: EnginePerformance) => void) {
      perfListeners.add(fn);
      return () => perfListeners.delete(fn);
    },
    async destroy() {
      node.disconnect();
      await ctx.close();
    }
  };
}
