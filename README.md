# PulseSynth

PulseSynth is a production-oriented browser synth monorepo using **TypeScript + AudioWorklet + Rust WebAssembly + Fastify API**.

## Monorepo

- `apps/studio` — Vite neuromorphic studio UI.
- `apps/api` — Fastify preset/auth/share service.
- `packages/shared` — zod contracts + protocol types.
- `packages/engine` — browser engine wrapper.
- `packages/worklet` — `AudioWorkletProcessor` runtime.
- `packages/wasm-dsp` — Rust DSP core compiled to wasm.
- `packages/cli` — `pulsesynth` commands.

## Dev

```bash
pnpm i
pnpm dev
```

Studio: `http://localhost:5173`  
API: `http://localhost:8787`

## Build

```bash
pnpm build
```

This builds worklet + wasm artifacts before Studio build and outputs optimized Vite assets.

## Test

```bash
pnpm test
cargo test --manifest-path packages/wasm-dsp/Cargo.toml
```

## CLI

```bash
pnpm --filter @pulsesynth/cli dev
pnpm --filter @pulsesynth/cli bench
pnpm --filter @pulsesynth/cli render -- --patch patch.json --out out.wav --seconds 5
pnpm --filter @pulsesynth/cli export-preset -- --name WarmPad --out warmpad.json
pnpm --filter @pulsesynth/cli import-preset -- --file warmpad.json
```

## Deploy

- `infra/deploy/vercel.json` and `infra/deploy/netlify.headers` include COOP/COEP for SAB mode.
- Studio runtime shows fallback mode when `crossOriginIsolated` is false.
- API Docker: `infra/docker/Dockerfile.api` and `infra/docker/compose.yaml`.

## Troubleshooting

- **SAB disabled**: ensure HTTPS + `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.
- **Registry/proxy issues**: configure `HTTPS_PROXY`, `.npmrc`, or mirror registry, then rerun `pnpm i`.
- **No sound**: click **Start Audio** first (user gesture requirement), then press keyboard keys.
