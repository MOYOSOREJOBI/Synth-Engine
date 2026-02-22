"use strict";
/// <reference lib="webworker" />
// Param path → WASM param ID mapping (matches lib.rs)
const PARAM_IDS = {
    masterGain: 0, cutoff: 1, resonance: 2,
    envAttack: 3, envDecay: 4, envSustain: 5, envRelease: 6,
    noiseAmount: 7, oscType: 8,
};
const OSC_MAP = {
    sine: 0, saw: 1, square: 2, triangle: 3,
};
const PERF_WINDOW_SIZE = 256;
const PERF_REPORT_INTERVAL = 12; // ~4 Hz at 128 samples / 48kHz
class PulseSynthProcessor extends AudioWorkletProcessor {
    wasm = null;
    outputLView = null;
    outputRView = null;
    perfWindow = new Float32Array(PERF_WINDOW_SIZE);
    perfIndex = 0;
    renderedFrames = 0;
    xruns = 0;
    quantumCount = 0;
    constructor() {
        super();
        this.port.onmessage = (e) => {
            const data = e.data;
            switch (data.type) {
                case 'init':
                    this.initWasm(data.wasmBytes, data.sampleRate, data.maxVoices);
                    break;
                case 'eventBatch':
                    this.processEvents(data.events);
                    break;
                case 'patch':
                    this.applyPatch(data.patch);
                    break;
                case 'perfRequest':
                    this.port.postMessage({ type: 'perfResponse', perf: this.computePerf() });
                    break;
            }
        };
    }
    async initWasm(bytes, sr, maxVoices) {
        try {
            const result = await WebAssembly.instantiate(bytes);
            this.wasm = result.instance.exports;
            this.wasm.init(sr, maxVoices);
            // Cache output buffer views (memory won't grow)
            const lPtr = this.wasm.get_output_l_ptr();
            const rPtr = this.wasm.get_output_r_ptr();
            this.outputLView = new Float32Array(this.wasm.memory.buffer, lPtr, 128);
            this.outputRView = new Float32Array(this.wasm.memory.buffer, rPtr, 128);
            this.port.postMessage({ type: 'ready' });
        }
        catch (err) {
            this.port.postMessage({ type: 'error', message: String(err) });
        }
    }
    processEvents(events) {
        if (!this.wasm)
            return;
        for (const ev of events) {
            switch (ev.type) {
                case 'noteOn':
                    this.wasm.note_on(ev.note, ev.velocity);
                    break;
                case 'noteOff':
                    this.wasm.note_off(ev.note);
                    break;
                case 'allNotesOff':
                    this.wasm.all_notes_off();
                    break;
                case 'param': {
                    const path = ev.path;
                    const value = ev.value;
                    const paramId = PARAM_IDS[path];
                    if (paramId !== undefined) {
                        this.wasm.set_param(paramId, value);
                    }
                    break;
                }
            }
        }
    }
    applyPatch(patch) {
        if (!this.wasm)
            return;
        if (patch.oscType !== undefined) {
            this.wasm.set_param(PARAM_IDS.oscType, OSC_MAP[patch.oscType] ?? 0);
        }
        if (patch.masterGain !== undefined)
            this.wasm.set_param(PARAM_IDS.masterGain, patch.masterGain);
        if (patch.filter) {
            if (patch.filter.cutoff !== undefined)
                this.wasm.set_param(PARAM_IDS.cutoff, patch.filter.cutoff);
            if (patch.filter.resonance !== undefined)
                this.wasm.set_param(PARAM_IDS.resonance, patch.filter.resonance);
        }
        if (patch.env) {
            if (patch.env.attack !== undefined)
                this.wasm.set_param(PARAM_IDS.envAttack, patch.env.attack);
            if (patch.env.decay !== undefined)
                this.wasm.set_param(PARAM_IDS.envDecay, patch.env.decay);
            if (patch.env.sustain !== undefined)
                this.wasm.set_param(PARAM_IDS.envSustain, patch.env.sustain);
            if (patch.env.release !== undefined)
                this.wasm.set_param(PARAM_IDS.envRelease, patch.env.release);
        }
        if (patch.noiseAmount !== undefined)
            this.wasm.set_param(PARAM_IDS.noiseAmount, patch.noiseAmount);
    }
    process(_inputs, outputs, _params) {
        const outL = outputs[0]?.[0];
        const outR = outputs[0]?.[1] ?? outL;
        if (!outL)
            return true;
        const t0 = currentTime;
        if (this.wasm && this.outputLView && this.outputRView) {
            this.wasm.render(outL.length);
            outL.set(this.outputLView);
            outR.set(this.outputRView);
        }
        this.renderedFrames += outL.length;
        this.quantumCount++;
        const elapsed = (currentTime - t0) * 1000;
        this.perfWindow[this.perfIndex++ % PERF_WINDOW_SIZE] = elapsed;
        const quantumMs = (outL.length / sampleRate) * 1000;
        if (elapsed > quantumMs)
            this.xruns++;
        if (this.quantumCount % PERF_REPORT_INTERVAL === 0) {
            this.port.postMessage({ type: 'perfResponse', perf: this.computePerf() });
        }
        return true;
    }
    computePerf() {
        const len = Math.min(this.perfIndex, PERF_WINDOW_SIZE);
        if (len === 0) {
            return {
                cpuMsAvg: 0, cpuMsP95: 0, xruns: this.xruns,
                audioQuantumMs: (128 / sampleRate) * 1000,
                sampleRate, renderedFrames: this.renderedFrames, voiceCount: 0,
            };
        }
        let sum = 0;
        let max = 0;
        for (let i = 0; i < len; i++) {
            const v = this.perfWindow[i];
            sum += v;
            if (v > max)
                max = v;
        }
        return {
            cpuMsAvg: sum / len,
            cpuMsP95: max,
            xruns: this.xruns,
            audioQuantumMs: (128 / sampleRate) * 1000,
            sampleRate,
            renderedFrames: this.renderedFrames,
            voiceCount: 0,
        };
    }
}
registerProcessor('pulse-synth-processor', PulseSynthProcessor);
