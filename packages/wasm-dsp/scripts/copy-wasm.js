import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const src = resolve(root, 'target/wasm32-unknown-unknown/release/pulsesynth_wasm_dsp.wasm');
const dest = resolve(root, 'dist/pulsesynth.wasm');

mkdirSync(dirname(dest), { recursive: true });

if (existsSync(src)) {
  copyFileSync(src, dest);
  console.log(`Copied WASM → ${dest}`);
} else {
  console.warn(`WASM file not found at ${src}. Run cargo build first.`);
  process.exit(1);
}
