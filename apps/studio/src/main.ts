import { createEngine } from '@pulsesynth/engine';
import { DEFAULT_PATCH } from '@pulsesynth/shared';

const startButton = document.querySelector<HTMLButtonElement>('#startAudio')!;
const gain = document.querySelector<HTMLInputElement>('#masterGain')!;
const perf = document.querySelector<HTMLElement>('#perf')!;

const engine = await createEngine({ workletUrl: '/worklet/processor.js', crossOriginIsolatedMode: crossOriginIsolated ? 'sab' : 'port' });
engine.createSynth(DEFAULT_PATCH);

startButton.addEventListener('click', async () => {
  await engine.start();
  startButton.textContent = 'Audio Running';
});

gain.addEventListener('input', () => {
  engine.setParam('masterGain', Number(gain.value));
});

window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  const note = ({ a:60, w:61, s:62, e:63, d:64 } as Record<string, number>)[event.key];
  if (note) engine.noteOn(note, 0.9);
});
window.addEventListener('keyup', (event) => {
  const note = ({ a:60, w:61, s:62, e:63, d:64 } as Record<string, number>)[event.key];
  if (note) engine.noteOff(note);
});

setInterval(() => {
  const p = engine.getPerformance();
  perf.textContent = JSON.stringify(p, null, 2);
}, 500);
