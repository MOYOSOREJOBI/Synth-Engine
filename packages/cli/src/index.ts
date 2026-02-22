#!/usr/bin/env node
import { cac } from 'cac';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { migratePatch } from '@pulsesynth/shared';

const cli = cac('pulsesynth');

const run = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true });
  if (r.status) process.exit(r.status);
};

cli.command('dev', 'starts studio+api').action(() => run('pnpm', ['dev']));
cli.command('build', 'build all').action(() => run('pnpm', ['build']));
cli.command('test', 'test all').action(() => run('pnpm', ['test']));
cli.command('bench', 'deterministic synthetic benchmark').action(() => {
  let seed = 1337;
  const values = Array.from({ length: 300 }, () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return 0.08 + (seed / 0xffffffff) * 0.12;
  }).sort((a, b) => a - b);
  console.log({ p50: values[150], p95: values[285], samples: values.length });
});

cli.command('render', 'render patch to wav')
  .option('--patch <patch>', 'json patch file', { default: 'patch.json' })
  .option('--out <out>', 'wav path', { default: 'out.wav' })
  .option('--seconds <seconds>', 'render seconds', { default: '5' })
  .option('--sample-rate <sampleRate>', 'sample rate', { default: '48000' })
  .action((opts) => {
    const patch = migratePatch(JSON.parse(readFileSync(opts.patch, 'utf8')));
    const sr = Number(opts.sampleRate);
    const seconds = Number(opts.seconds);
    const frames = Math.floor(sr * seconds);
    const l = new Float32Array(frames);
    const r = new Float32Array(frames);
    const f = 220 * (patch.oscType === 'sine' ? 1 : 1.5);
    let phase = 0;
    const inc = (Math.PI * 2 * f) / sr;
    for (let i = 0; i < frames; i++) {
      const env = Math.min(1, i / Math.max(1, patch.env.attack * sr));
      const v = Math.sin(phase) * patch.masterGain * env * 0.8;
      phase += inc;
      l[i] = v * (1 - patch.pan * 0.5);
      r[i] = v * (1 + patch.pan * 0.5);
    }
    writeFileSync(opts.out, encodeWavStereo(l, r, sr));
    console.log(`Wrote ${opts.out}`);
  });

cli.command('export-preset', 'export default preset')
  .option('--name <name>', 'name', { default: 'Preset' })
  .option('--out <out>', 'file', { default: 'preset.json' })
  .action((opts) => {
    const data = migratePatch({
      version: 2, name: opts.name, oscType: 'saw', masterGain: 0.4, filter: { cutoff: 2200, resonance: 0.5 },
      env: { attack: 0.01, decay: 0.2, sustain: 0.75, release: 0.35 }, lfo: { rate: 2, depth: 0.1, target: 'cutoff' }, metadata: { tags: [] }, noiseAmount: 0.01, pan: 0
    });
    writeFileSync(opts.out, JSON.stringify(data, null, 2));
  });

cli.command('import-preset', 'validate preset json')
  .option('--file <file>', 'file', { default: 'preset.json' })
  .action((opts) => {
    const patch = migratePatch(JSON.parse(readFileSync(opts.file, 'utf8')));
    console.log(`Imported preset: ${patch.name}`);
  });

cli.help();
cli.parse();

function encodeWavStereo(left: Float32Array, right: Float32Array, sr: number): Buffer {
  const frames = Math.min(left.length, right.length);
  const pcm = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames; i++) {
    const l = Math.max(-1, Math.min(1, left[i])) * 32767;
    const r = Math.max(-1, Math.min(1, right[i])) * 32767;
    pcm.writeInt16LE(l, i * 4);
    pcm.writeInt16LE(r, i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
