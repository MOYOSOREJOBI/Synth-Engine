/// <reference lib="webworker" />
import type { EnginePerformance, Patch, SynthEvent, WorkletMessage } from '@pulsesynth/shared';

declare const registerProcessor: (name: string, ctor: unknown) => void;

type Exports = {
  memory: WebAssembly.Memory;
  init: (sampleRate: number, maxVoices: number) => void;
  set_params: (masterGain: number, attack: number, decay: number, sustain: number, release: number, cutoff: number) => void;
  note_on: (note: number, velocity: number) => void;
  note_off: (note: number) => void;
  all_notes_off: () => void;
  render: (leftPtr: number, rightPtr: number, frames: number) => number;
  get_perf_ptr: () => number;
};

class PulseSynthProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'masterGain', defaultValue: 0.42, automationRate: 'a-rate' as const },
      { name: 'cutoff', defaultValue: 2200, automationRate: 'a-rate' as const },
      { name: 'resonance', defaultValue: 0.5, automationRate: 'k-rate' as const },
      { name: 'envAttack', defaultValue: 0.01, automationRate: 'k-rate' as const },
      { name: 'envDecay', defaultValue: 0.2, automationRate: 'k-rate' as const },
      { name: 'envSustain', defaultValue: 0.75, automationRate: 'k-rate' as const },
      { name: 'envRelease', defaultValue: 0.35, automationRate: 'k-rate' as const }
    ];
  }

  private wasm?: Exports;
  private patch?: Patch;
  private ready = false;
  private perfWindow = new Float32Array(256);
  private perfIndex = 0;
  private renderedFrames = 0;
  private xruns = 0;
  private perfTick = 0;

  private queueType = new Uint8Array(2048);
  private queueA = new Float32Array(2048);
  private queueB = new Float32Array(2048);
  private qRead = 0;
  private qWrite = 0;

  private leftPtr = 0;
  private rightPtr = 0;
  private wasmView = new Float32Array(0);

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<WorkletMessage>) => {
      const data = event.data;
      if (data.type === 'init') {
        this.patch = data.payload.patch;
        void this.initWasm(data.payload.wasmUrl, data.payload.sampleRate, data.payload.maxVoices);
        return;
      }
      if (data.type === 'eventBatch') {
        for (let i = 0; i < data.events.length; i++) this.pushEvent(data.events[i]);
        return;
      }
      if (data.type === 'patch') {
        this.patch = data.patch;
      }
      if (data.type === 'perfRequest') this.port.postMessage({ type: 'perfResponse', perf: this.computePerf() });
    };
  }

  private async initWasm(url: string, sampleRateArg: number, maxVoices: number) {
    try {
      const mod = await WebAssembly.instantiateStreaming(fetch(url), {});
      this.wasm = mod.instance.exports as unknown as Exports;
      this.wasm.init(sampleRateArg, maxVoices);
      this.ensureBufferPointers(128);
      this.ready = true;
      this.port.postMessage({ type: 'ready' });
    } catch (error) {
      this.port.postMessage({ type: 'error', message: `wasm-init-failed:${String(error)}` });
    }
  }

  private ensureBufferPointers(frames: number) {
    if (!this.wasm) return;
    const needed = frames * 2 + 1024;
    this.wasmView = new Float32Array(this.wasm.memory.buffer);
    if (this.wasmView.length < needed) return;
    this.leftPtr = 0;
    this.rightPtr = frames * 4;
  }

  private pushEvent(evt: SynthEvent) {
    const next = (this.qWrite + 1) % this.queueType.length;
    if (next === this.qRead) return;
    if (evt.type === 'noteOn') {
      this.queueType[this.qWrite] = 1;
      this.queueA[this.qWrite] = evt.note;
      this.queueB[this.qWrite] = evt.velocity;
    } else if (evt.type === 'noteOff') {
      this.queueType[this.qWrite] = 2;
      this.queueA[this.qWrite] = evt.note;
      this.queueB[this.qWrite] = 0;
    } else if (evt.type === 'allNotesOff') {
      this.queueType[this.qWrite] = 3;
      this.queueA[this.qWrite] = 0;
      this.queueB[this.qWrite] = 0;
    }
    this.qWrite = next;
  }

  private flushEvents() {
    if (!this.wasm) return;
    while (this.qRead !== this.qWrite) {
      const t = this.queueType[this.qRead];
      if (t === 1) this.wasm.note_on(this.queueA[this.qRead], this.queueB[this.qRead]);
      else if (t === 2) this.wasm.note_off(this.queueA[this.qRead]);
      else if (t === 3) this.wasm.all_notes_off();
      this.qRead = (this.qRead + 1) % this.queueType.length;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][], params: Record<string, Float32Array>): boolean {
    const outL = outputs[0][0];
    const outR = outputs[0][1] ?? outL;
    if (!this.ready || !this.wasm) {
      outL.fill(0);
      outR.fill(0);
      return true;
    }
    if (outL.length * 4 !== this.rightPtr) this.ensureBufferPointers(outL.length);

    const start = currentTime;
    this.flushEvents();
    this.wasm.set_params(
      params.masterGain[0] ?? 0.4,
      params.envAttack[0] ?? 0.01,
      params.envDecay[0] ?? 0.2,
      params.envSustain[0] ?? 0.75,
      params.envRelease[0] ?? 0.35,
      params.cutoff[0] ?? 2200
    );
    this.wasm.render(this.leftPtr, this.rightPtr, outL.length);

    const baseL = this.leftPtr >> 2;
    const baseR = this.rightPtr >> 2;
    for (let i = 0; i < outL.length; i++) {
      outL[i] = this.wasmView[baseL + i] ?? 0;
      outR[i] = this.wasmView[baseR + i] ?? 0;
    }

    const elapsed = (currentTime - start) * 1000;
    this.perfWindow[this.perfIndex++ & 255] = elapsed;
    const quantumMs = (outL.length / sampleRate) * 1000;
    if (elapsed > quantumMs) this.xruns++;
    this.renderedFrames += outL.length;

    this.perfTick++;
    if ((this.perfTick & 31) === 0) this.port.postMessage({ type: 'perfResponse', perf: this.computePerf() });
    return true;
  }

  private computePerf(): EnginePerformance {
    const values: number[] = [];
    for (let i = 0; i < this.perfWindow.length; i++) {
      const v = this.perfWindow[i];
      if (v > 0) values.push(v);
    }
    values.sort((a, b) => a - b);
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const p95 = values.length ? values[Math.floor(values.length * 0.95)] : 0;
    return {
      cpuMsAvg: avg,
      cpuMsP95: p95,
      xruns: this.xruns,
      audioQuantumMs: (128 / sampleRate) * 1000,
      sampleRate,
      renderedFrames: this.renderedFrames,
      voices: 0
    };
  }
}

registerProcessor('pulse-synth-processor', PulseSynthProcessor);
