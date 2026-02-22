import { createEngine } from '@pulsesynth/engine';
import { DEFAULT_PATCH, migratePatch, type Patch } from '@pulsesynth/shared';

const apiBase = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:8787';
const tokenKey = 'pulse_token';
const patchKey = 'pulse_local_patches';

const audioState = document.querySelector('#audioState')!;
const apiState = document.querySelector('#apiState')!;
const isoState = document.querySelector('#isoState')!;
const perfNode = document.querySelector<HTMLPreElement>('#perf')!;
const scope = document.querySelector<HTMLCanvasElement>('#scope')!;
const perfChart = document.querySelector<HTMLCanvasElement>('#perfChart')!;

isoState.textContent = `Isolation: ${crossOriginIsolated ? 'SAB-ready' : 'port mode'}`;

const engine = await createEngine({ wasmUrl: '/wasm/pulsesynth_wasm_dsp.wasm', workletUrl: '/worklet/processor.js' });
engine.setPatch(DEFAULT_PATCH);

const analyser = engine.context.createAnalyser();
analyser.fftSize = 1024;
engine.node.connect(analyser);
const waveform = new Uint8Array(analyser.fftSize);

const keyMap: Record<string, number> = { a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66, g: 67, y: 68, h: 69, u: 70, j: 71 };
const currentPatch: Patch = structuredClone(DEFAULT_PATCH);
const perfHistory: number[] = [];

function setTab(tab: string) {
  for (const node of Array.from(document.querySelectorAll('section[id^="tab-"]'))) node.classList.add('hidden');
  document.querySelector(`#tab-${tab}`)?.classList.remove('hidden');
}

for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-tab]'))) {
  btn.onclick = () => setTab(btn.dataset.tab!);
}

(document.querySelector('#themeToggle') as HTMLButtonElement).onclick = () => {
  const root = document.documentElement;
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  localStorage.setItem('pulse_theme', next);
};
document.documentElement.dataset.theme = localStorage.getItem('pulse_theme') ?? 'light';

(document.querySelector('#startAudio') as HTMLButtonElement).onclick = async () => {
  await engine.start();
  audioState.textContent = 'Audio: running';
};
(document.querySelector('#stopAudio') as HTMLButtonElement).onclick = async () => {
  await engine.stop();
  audioState.textContent = 'Audio: stopped';
};

const bindParam = (id: string, path: any, writePatch?: (v: number) => void) => {
  const el = document.querySelector<HTMLInputElement>(`#${id}`)!;
  el.addEventListener('input', () => {
    const v = Number(el.value);
    engine.setParam(path, v);
    if (writePatch) writePatch(v);
  });
};
bindParam('masterGain', 'masterGain', (v) => (currentPatch.masterGain = v));
bindParam('cutoff', 'cutoff', (v) => (currentPatch.filter.cutoff = v));
bindParam('envAttack', 'envAttack', (v) => (currentPatch.env.attack = v));
bindParam('envDecay', 'envDecay', (v) => (currentPatch.env.decay = v));
bindParam('envSustain', 'envSustain', (v) => (currentPatch.env.sustain = v));
bindParam('envRelease', 'envRelease', (v) => (currentPatch.env.release = v));

for (const [key, note] of Object.entries(keyMap)) {
  const b = document.createElement('button');
  b.textContent = key.toUpperCase();
  b.onmousedown = () => engine.noteOn(note, 0.9);
  b.onmouseup = () => engine.noteOff(note);
  document.querySelector('#keys')!.appendChild(b);
}
window.addEventListener('keydown', (e) => { if (!e.repeat && keyMap[e.key]) engine.noteOn(keyMap[e.key], 0.9); });
window.addEventListener('keyup', (e) => { if (keyMap[e.key]) engine.noteOff(keyMap[e.key]); });

function drawScope() {
  analyser.getByteTimeDomainData(waveform);
  const ctx = scope.getContext('2d')!;
  ctx.clearRect(0, 0, scope.width, scope.height);
  ctx.beginPath();
  for (let i = 0; i < waveform.length; i++) {
    const x = (i / waveform.length) * scope.width;
    const y = (waveform[i] / 255) * scope.height;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  requestAnimationFrame(drawScope);
}
requestAnimationFrame(drawScope);

engine.onPerformance((p) => {
  perfNode.textContent = JSON.stringify(p, null, 2);
  perfHistory.push(p.cpuMsAvg);
  if (perfHistory.length > 60) perfHistory.shift();
  const ctx = perfChart.getContext('2d')!;
  ctx.clearRect(0, 0, perfChart.width, perfChart.height);
  ctx.beginPath();
  perfHistory.forEach((v, i) => {
    const x = (i / Math.max(perfHistory.length - 1, 1)) * perfChart.width;
    const y = perfChart.height - Math.min(1, v / 4) * perfChart.height;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
});
setInterval(() => engine.getPerformance(), 500);

const localPatches = document.querySelector('#localPatches')!;
function loadLocal(): Patch[] { return JSON.parse(localStorage.getItem(patchKey) ?? '[]'); }
function renderLocalList() {
  localPatches.innerHTML = '';
  loadLocal().forEach((patch, idx) => {
    const li = document.createElement('li');
    li.innerHTML = `<button data-load='${idx}'>Load</button> ${patch.name}`;
    li.querySelector('button')!.onclick = () => { const p = migratePatch(loadLocal()[idx]); Object.assign(currentPatch, p); engine.setPatch(p); };
    localPatches.appendChild(li);
  });
}
(document.querySelector('#saveLocal') as HTMLButtonElement).onclick = () => {
  currentPatch.name = (document.querySelector('#patchName') as HTMLInputElement).value || currentPatch.name;
  const all = loadLocal(); all.push(structuredClone(currentPatch)); localStorage.setItem(patchKey, JSON.stringify(all)); renderLocalList();
};
(document.querySelector('#resetPatch') as HTMLButtonElement).onclick = () => { Object.assign(currentPatch, structuredClone(DEFAULT_PATCH)); engine.setPatch(currentPatch); };
(document.querySelector('#exportPatch') as HTMLButtonElement).onclick = () => {
  const blob = new Blob([JSON.stringify(currentPatch, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${currentPatch.name}.json`; a.click();
};
(document.querySelector('#importPatch') as HTMLInputElement).onchange = async (ev) => {
  const file = (ev.target as HTMLInputElement).files?.[0]; if (!file) return;
  const text = await file.text(); const patch = migratePatch(JSON.parse(text)); Object.assign(currentPatch, patch); engine.setPatch(patch);
};
renderLocalList();

async function api(path: string, init: RequestInit = {}) {
  const token = localStorage.getItem(tokenKey);
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  const res = await fetch(`${apiBase}${path}`, { ...init, headers });
  if (res.status === 401) apiState.textContent = 'API: unauthorized';
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

(document.querySelector('#signup') as HTMLButtonElement).onclick = async () => {
  const email = (document.querySelector('#email') as HTMLInputElement).value;
  const password = (document.querySelector('#password') as HTMLInputElement).value;
  const r = await api('/v1/auth/signup', { method: 'POST', body: JSON.stringify({ email, password }) });
  localStorage.setItem(tokenKey, r.token); apiState.textContent = 'API: connected';
};
(document.querySelector('#login') as HTMLButtonElement).onclick = async () => {
  const email = (document.querySelector('#email') as HTMLInputElement).value;
  const password = (document.querySelector('#password') as HTMLInputElement).value;
  const r = await api('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  localStorage.setItem(tokenKey, r.token); apiState.textContent = 'API: connected';
};

const cloudList = document.querySelector('#cloudPatches')!;
async function refreshCloud() {
  try {
    const patches = await api('/v1/patches');
    cloudList.innerHTML = '';
    patches.forEach((p: any) => {
      const li = document.createElement('li');
      li.innerHTML = `${p.name} <button>Load</button> <button>Share</button>`;
      li.querySelectorAll('button')[0].onclick = async () => { const full = await api(`/v1/patches/${p.id}`); engine.setPatch(migratePatch(full.patch)); };
      li.querySelectorAll('button')[1].onclick = async () => { const r = await api(`/v1/patches/${p.id}/share`, { method: 'POST' }); navigator.clipboard.writeText(`${location.origin}/?patch=${r.id}`); };
      cloudList.appendChild(li);
    });
    apiState.textContent = 'API: connected';
  } catch { apiState.textContent = 'API: unavailable'; }
}
(document.querySelector('#refreshCloud') as HTMLButtonElement).onclick = refreshCloud;
(document.querySelector('#saveCloud') as HTMLButtonElement).onclick = async () => {
  await api('/v1/patches', { method: 'POST', body: JSON.stringify({ name: currentPatch.name, shared: false, patch: currentPatch }) });
  refreshCloud();
};
void refreshCloud();
