import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const src = resolve('dist/processor.js');
const target = resolve('../../apps/studio/public/worklet/processor.js');
mkdirSync(resolve('../../apps/studio/public/worklet'), { recursive: true });
copyFileSync(src, target);
console.log('Copied worklet processor to studio/public/worklet/processor.js');
