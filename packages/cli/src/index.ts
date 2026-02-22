#!/usr/bin/env node
import { cac } from 'cac';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const cli = cac('pulsesynth');

cli.command('dev', 'runs studio + api + wasm').action(() => {
  spawn('pnpm', ['-r', 'dev'], { stdio: 'inherit', shell: true });
});
cli.command('build', 'build all').action(() => {
  spawn('pnpm', ['build'], { stdio: 'inherit', shell: true });
});
cli.command('test', 'run tests').action(() => {
  spawn('pnpm', ['test'], { stdio: 'inherit', shell: true });
});
cli.command('bench', 'synthetic benchmark').action(() => {
  const samples = Array.from({ length: 200 }, () => Math.random() * 0.2 + 0.1).sort((a,b)=>a-b);
  console.log({ p50: samples[100], p95: samples[190] });
});
cli.command('render', 'offline render demo wav').action(() => {
  const sr = 48000, secs = 1;
  const data = new Float32Array(sr * secs);
  for (let i = 0; i < data.length; i++) data[i] = Math.sin((i / sr) * Math.PI * 2 * 440) * 0.2;
  const wav = encodeWav(data, sr);
  writeFileSync('render.wav', wav);
  console.log('Wrote render.wav');
});
cli.command('patch export', 'stub').option('--id <id>').option('--out <out>').action((opts)=>console.log('export', opts));
cli.command('patch import', 'stub').option('--file <file>').action((opts)=>console.log('import', opts));
cli.help();
cli.parse();

function encodeWav(ch: Float32Array, sr: number): Buffer {
  const pcm = Buffer.alloc(ch.length * 2);
  for (let i=0;i<ch.length;i++) pcm.writeInt16LE(Math.max(-1, Math.min(1, ch[i])) * 32767, i*2);
  const header = Buffer.alloc(44);
  header.write('RIFF',0); header.writeUInt32LE(36+pcm.length,4); header.write('WAVE',8); header.write('fmt ',12);
  header.writeUInt32LE(16,16); header.writeUInt16LE(1,20); header.writeUInt16LE(1,22); header.writeUInt32LE(sr,24);
  header.writeUInt32LE(sr*2,28); header.writeUInt16LE(2,32); header.writeUInt16LE(16,34); header.write('data',36); header.writeUInt32LE(pcm.length,40);
  return Buffer.concat([header, pcm]);
}
