/// <reference lib="webworker" />
import type { EnginePerformance, Patch, SynthEvent, WorkletMessage } from '@pulsesynth/shared';

declare const registerProcessor: (name: string, ctor: any) => void;

type Params = Record<string, Float32Array>;

class PulseSynthProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return ['masterGain','cutoff','resonance','envAttack','envDecay','envSustain','envRelease','lfoRate','lfoDepth'].map((name) => ({ name, defaultValue: 0.5, automationRate: 'a-rate' as const }));
  }

  private eventQueue: SynthEvent[] = [];
  private patch?: Patch;
  private perfWindow = new Float32Array(256);
  private perfIndex = 0;
  private renderedFrames = 0;
  private xruns = 0;

  constructor() {
    super();
    this.port.onmessage = ({ data }: MessageEvent<WorkletMessage>) => {
      if (data.type === 'eventBatch') this.eventQueue.push(...data.events);
      if (data.type === 'patch') this.patch = data.patch;
      if (data.type === 'perfRequest') this.port.postMessage({ type: 'perfResponse', perf: this.computePerf() });
      if (data.type === 'init') this.port.postMessage({ type: 'ready' });
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][], params: Params): boolean {
    const t0 = currentTime;
    const outL = outputs[0][0];
    const outR = outputs[0][1] ?? outL;
    const gainValues = params.masterGain;
    for (let i = 0; i < outL.length; i++) {
      const gain = gainValues.length > 1 ? gainValues[i] : gainValues[0];
      outL[i] = 0;
      outR[i] = 0;
      // placeholder for wasm render output copy
      outL[i] *= gain;
      outR[i] *= gain;
    }
    this.eventQueue.length = 0;
    this.renderedFrames += outL.length;
    const elapsed = (currentTime - t0) * 1000;
    this.perfWindow[this.perfIndex++ % this.perfWindow.length] = elapsed;
    const quantumMs = (outL.length / sampleRate) * 1000;
    if (elapsed > quantumMs) this.xruns++;
    return true;
  }

  private computePerf(): EnginePerformance {
    const slice = Array.from(this.perfWindow).filter(Boolean).sort((a, b) => a - b);
    const avg = slice.reduce((a, b) => a + b, 0) / Math.max(slice.length, 1);
    const p95 = slice[Math.floor(slice.length * 0.95)] ?? 0;
    return { cpuMsAvg: avg, cpuMsP95: p95, xruns: this.xruns, audioQuantumMs: (128 / sampleRate) * 1000, sampleRate, renderedFrames: this.renderedFrames };
  }
}

registerProcessor('pulse-synth-processor', PulseSynthProcessor);
