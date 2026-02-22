import {
  DEFAULT_PATCH, migratePatch, OSC_TYPE_MAP,
  type EnginePerformance, type ParamPath, type Patch,
  type Ramp, type SynthEvent, type WorkletResponse,
} from '@pulsesynth/shared';

export type EngineOptions = {
  audioContext?: AudioContext;
  polyphony?: number;
  latencyHint?: AudioContextLatencyCategory;
  wasmUrl?: string;
  wasmBytes?: ArrayBuffer;
  workletUrl?: string;
};

export type Engine = Awaited<ReturnType<typeof createEngine>>;

export async function createEngine(options: EngineOptions = {}) {
  const ctx = options.audioContext ??
    new AudioContext({ latencyHint: options.latencyHint ?? 'interactive' });

  // Fetch WASM bytes
  let wasmBytes = options.wasmBytes;
  if (!wasmBytes) {
    const url = options.wasmUrl ?? '/wasm/pulsesynth.wasm';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch WASM: ${res.status} ${res.statusText}`);
    wasmBytes = await res.arrayBuffer();
  }

  // Load worklet module
  const workletUrl = options.workletUrl ?? '/worklet/processor.js';
  await ctx.audioWorklet.addModule(workletUrl);

  // Create worklet node
  const node = new AudioWorkletNode(ctx, 'pulse-synth-processor', {
    outputChannelCount: [2],
    numberOfInputs: 0,
    numberOfOutputs: 1,
  });

  // AnalyserNode for oscilloscope
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;

  node.connect(analyser);
  analyser.connect(ctx.destination);

  // Track performance from worklet
  const perf: EnginePerformance = {
    cpuMsAvg: 0, cpuMsP95: 0, xruns: 0,
    audioQuantumMs: (128 / ctx.sampleRate) * 1000,
    sampleRate: ctx.sampleRate, renderedFrames: 0, voiceCount: 0,
  };

  // Wait for worklet to initialize WASM
  const readyPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Worklet init timeout')), 10000);
    node.port.onmessage = ({ data }: MessageEvent<WorkletResponse | { type: 'error'; message: string }>) => {
      if (data.type === 'ready') {
        clearTimeout(timeout);
        resolve();
      } else if (data.type === 'error') {
        clearTimeout(timeout);
        reject(new Error((data as { message: string }).message));
      } else if (data.type === 'perfResponse') {
        Object.assign(perf, data.perf);
      }
    };
  });

  // Send WASM bytes to worklet (transfer ownership for zero-copy)
  node.port.postMessage(
    { type: 'init', wasmBytes, sampleRate: ctx.sampleRate, maxVoices: options.polyphony ?? 8 },
    [wasmBytes]
  );

  await readyPromise;

  // Set up permanent perf handler
  node.port.onmessage = ({ data }: MessageEvent<WorkletResponse>) => {
    if (data.type === 'perfResponse') Object.assign(perf, data.perf);
  };

  let patch = DEFAULT_PATCH;

  const enqueue = (events: SynthEvent[]) => {
    node.port.postMessage({ type: 'eventBatch', events });
  };

  return {
    get audioContext() { return ctx; },
    get analyserNode() { return analyser; },
    get state() { return ctx.state; },

    async start() {
      if (ctx.state !== 'running') await ctx.resume();
    },

    async stop() {
      if (ctx.state === 'running') await ctx.suspend();
    },

    loadPatch(p: Patch | unknown) {
      patch = migratePatch(p);
      node.port.postMessage({ type: 'patch', patch });
    },

    exportPatch(): Patch {
      return { ...patch };
    },

    noteOn(note: number, velocity: number) {
      enqueue([{ type: 'noteOn', note, velocity, time: ctx.currentTime }]);
    },

    noteOff(note: number) {
      enqueue([{ type: 'noteOff', note, time: ctx.currentTime }]);
    },

    allNotesOff() {
      enqueue([{ type: 'allNotesOff', time: ctx.currentTime }]);
    },

    setParam(path: ParamPath, value: number, _time?: number, _ramp: Ramp = 'step') {
      const numValue = path === 'oscType' ? (OSC_TYPE_MAP[String(value)] ?? value) : value;
      enqueue([{ type: 'param', path, value: numValue, time: ctx.currentTime, ramp: _ramp }]);
    },

    schedule(events: SynthEvent[]) {
      enqueue(events);
    },

    getPerformance(): EnginePerformance {
      return { ...perf };
    },

    async destroy() {
      node.disconnect();
      analyser.disconnect();
      await ctx.close();
    },
  };
}
