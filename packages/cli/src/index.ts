#!/usr/bin/env node
import { cac } from 'cac';
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cli = cac('pulsesynth');

cli.command('dev', 'Start Studio + API in dev mode').action(() => {
  spawn('pnpm', ['run', 'dev'], { stdio: 'inherit', shell: true, cwd: resolve(__dirname, '../../..') });
});

cli.command('build', 'Build all packages').action(() => {
  spawn('pnpm', ['run', 'build'], { stdio: 'inherit', shell: true, cwd: resolve(__dirname, '../../..') });
});

cli.command('test', 'Run all tests').action(() => {
  spawn('pnpm', ['run', 'test'], { stdio: 'inherit', shell: true, cwd: resolve(__dirname, '../../..') });
});

cli.command('bench', 'Run DSP render benchmark').action(async () => {
  console.log('PulseSynth DSP Benchmark');
  console.log('========================');

  const sampleRate = 48000;
  const seconds = 2;
  const totalFrames = sampleRate * seconds;
  const quantumSize = 128;
  const iterations = Math.ceil(totalFrames / quantumSize);

  const outL = new Float32Array(quantumSize);
  const outR = new Float32Array(quantumSize);

  let phase = 0;
  const phaseInc = 440.0 / sampleRate;
  const gain = 0.45;

  const t0 = performance.now();
  for (let q = 0; q < iterations; q++) {
    for (let i = 0; i < quantumSize; i++) {
      const sample = Math.sin(phase * Math.PI * 2) * gain;
      outL[i] = sample;
      outR[i] = sample;
      phase += phaseInc;
      if (phase >= 1.0) phase -= 1.0;
    }
  }
  const elapsed = performance.now() - t0;

  const realtimeMs = (totalFrames / sampleRate) * 1000;
  const ratio = realtimeMs / elapsed;

  console.log(`Rendered ${totalFrames} frames (${seconds}s at ${sampleRate}Hz)`);
  console.log(`Time: ${elapsed.toFixed(2)} ms`);
  console.log(`Realtime budget: ${realtimeMs.toFixed(0)} ms`);
  console.log(`Headroom: ${ratio.toFixed(1)}x realtime`);
  console.log(`Per quantum (${quantumSize} frames): ${(elapsed / iterations).toFixed(4)} ms`);

  const voices = 16;
  const phases = new Float64Array(voices);
  for (let v = 0; v < voices; v++) phases[v] = v * 0.1;
  const incs = Array.from({ length: voices }, (_, i) => (220 + i * 50) / sampleRate);

  const t1 = performance.now();
  for (let q = 0; q < iterations; q++) {
    for (let i = 0; i < quantumSize; i++) {
      let mix = 0;
      for (let v = 0; v < voices; v++) {
        mix += Math.sin(phases[v] * Math.PI * 2) * 0.04;
        phases[v] += incs[v];
        if (phases[v] >= 1) phases[v] -= 1;
      }
      outL[i] = mix;
      outR[i] = mix;
    }
  }
  const elapsed2 = performance.now() - t1;
  console.log(`\n${voices}-voice polyphony: ${elapsed2.toFixed(2)} ms (${(realtimeMs / elapsed2).toFixed(1)}x realtime)`);
});

cli.command('render', 'Offline render patch to WAV')
  .option('--patch <file>', 'Patch JSON file (default: built-in default)')
  .option('--out <file>', 'Output WAV file', { default: 'render.wav' })
  .option('--seconds <n>', 'Duration in seconds', { default: 3 })
  .option('--sr <n>', 'Sample rate', { default: 48000 })
  .action((opts) => {
    const sr = Number(opts.sr);
    const secs = Number(opts.seconds);
    const outFile = opts.out as string;
    const totalFrames = sr * secs;

    let oscType = 1;
    let masterGain = 0.45;
    let attack = 0.01, decay = 0.2, sustain = 0.8, release = 0.4;
    let cutoff = 2200;

    if (opts.patch && existsSync(opts.patch)) {
      try {
        const patch = JSON.parse(readFileSync(opts.patch, 'utf-8'));
        const oscMap: Record<string, number> = { sine: 0, saw: 1, square: 2, triangle: 3 };
        oscType = oscMap[patch.oscType] ?? 1;
        masterGain = patch.masterGain ?? 0.45;
        attack = patch.env?.attack ?? 0.01;
        decay = patch.env?.decay ?? 0.2;
        sustain = patch.env?.sustain ?? 0.8;
        release = patch.env?.release ?? 0.4;
        cutoff = patch.filter?.cutoff ?? 2200;
      } catch (e) {
        console.error('Failed to parse patch file:', e);
      }
    }

    console.log(`Rendering ${secs}s at ${sr}Hz, osc=${oscType}, gain=${masterGain}`);

    const data = new Float32Array(totalFrames * 2);
    const notes = [60, 64, 67];
    const phases = notes.map(() => 0.0);
    const freqs = notes.map(n => 440 * Math.pow(2, (n - 69) / 12));

    const attackSamples = attack * sr;
    const decaySamples = decay * sr;
    const releaseSamples = release * sr;
    const noteOnDuration = (secs * 0.7) * sr;

    let filterState = 0;
    const filterCoeff = 1 - Math.exp(-2 * Math.PI * Math.min(cutoff, sr * 0.49) / sr);

    for (let i = 0; i < totalFrames; i++) {
      let env = 0;
      if (i < attackSamples) {
        env = i / attackSamples;
      } else if (i < attackSamples + decaySamples) {
        env = 1.0 - ((i - attackSamples) / decaySamples) * (1.0 - sustain);
      } else if (i < noteOnDuration) {
        env = sustain;
      } else {
        const releasePos = i - noteOnDuration;
        env = sustain * Math.max(0, 1.0 - releasePos / releaseSamples);
      }

      let mix = 0;
      for (let v = 0; v < notes.length; v++) {
        let sample: number;
        switch (oscType) {
          case 0: sample = Math.sin(phases[v] * Math.PI * 2); break;
          case 1: sample = 2 * phases[v] - 1; break;
          case 2: sample = phases[v] < 0.5 ? 1 : -1; break;
          case 3: sample = phases[v] < 0.5 ? 4 * phases[v] - 1 : 3 - 4 * phases[v]; break;
          default: sample = 0;
        }
        mix += sample * env * 0.3;
        phases[v] += freqs[v] / sr;
        if (phases[v] >= 1) phases[v] -= 1;
      }

      filterState += filterCoeff * (mix - filterState);
      mix = filterState;

      const out = mix * masterGain;
      data[i * 2] = out;
      data[i * 2 + 1] = out;
    }

    const wav = encodeWav(data, sr, 2);
    writeFileSync(outFile, wav);
    console.log(`Wrote ${outFile} (${(wav.byteLength / 1024).toFixed(0)} KB)`);
  });

cli.command('export-preset', 'Export default preset to JSON')
  .option('--name <name>', 'Preset name', { default: 'default' })
  .option('--out <file>', 'Output file', { default: 'preset.json' })
  .action((opts) => {
    const preset = {
      version: 2, name: opts.name,
      oscType: 'saw', masterGain: 0.45,
      filter: { cutoff: 2200, resonance: 0.5 },
      env: { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.4 },
      lfo: { rate: 2.5, depth: 0.15, target: 'cutoff' },
      metadata: { tags: ['preset'] },
      noiseAmount: 0.02,
    };
    writeFileSync(opts.out, JSON.stringify(preset, null, 2));
    console.log(`Exported preset to ${opts.out}`);
  });

cli.command('import-preset', 'Import a preset JSON and display')
  .option('--file <file>', 'Preset JSON file')
  .action((opts) => {
    if (!opts.file || !existsSync(opts.file)) {
      console.error('File not found:', opts.file);
      process.exit(1);
    }
    const data = JSON.parse(readFileSync(opts.file, 'utf-8'));
    console.log('Loaded preset:', JSON.stringify(data, null, 2));
  });

cli.help();
cli.parse();

function encodeWav(samples: Float32Array, sampleRate: number, channels: number): Buffer {
  const bytesPerSample = 2;
  const totalSamples = samples.length;
  const dataBytes = totalSamples * bytesPerSample;

  const pcm = Buffer.alloc(dataBytes);
  for (let i = 0; i < totalSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm.writeInt16LE(Math.round(s * 32767), i * bytesPerSample);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  header.writeUInt16LE(channels * bytesPerSample, 32);
  header.writeUInt16LE(bytesPerSample * 8, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);

  return Buffer.concat([header, pcm]);
}
