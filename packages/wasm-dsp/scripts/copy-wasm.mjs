import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const src = resolve('target/wasm32-unknown-unknown/release/pulsesynth_wasm_dsp.wasm');
const localDist = resolve('dist/pulsesynth_wasm_dsp.wasm');
const studioDist = resolve('../../apps/studio/public/wasm/pulsesynth_wasm_dsp.wasm');
mkdirSync(resolve('dist'), { recursive: true });
mkdirSync(resolve('../../apps/studio/public/wasm'), { recursive: true });
copyFileSync(src, localDist);
copyFileSync(src, studioDist);
console.log('Copied wasm artifact to dist and studio/public/wasm');
