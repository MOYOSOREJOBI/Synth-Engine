# PulseSynth

Production-ready monorepo for browser synthesis with AudioWorklet + WASM DSP + Studio UI + API + CLI.

## Quickstart

```bash
pnpm i
pnpm dev
```

## Architecture

UI -> @pulsesynth/engine -> AudioWorkletProcessor -> wasm-dsp

Modes:
- Port mode: default
- SAB mode: auto when crossOriginIsolated
