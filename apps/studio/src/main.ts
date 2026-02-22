import { createEngine, type Engine } from '@pulsesynth/engine';
import { DEFAULT_PATCH, KEYBOARD_MAP, type Patch } from '@pulsesynth/shared';
import * as api from './api-client';

// ── State ────────────────────────────────────────────────────────────
let engine: Engine | null = null;
let currentPatch: Patch = { ...DEFAULT_PATCH };
const activeNotes = new Set<number>();
const perfHistory: number[] = [];

// ── DOM refs ─────────────────────────────────────────────────────────
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ── Theme ────────────────────────────────────────────────────────────
const savedTheme = localStorage.getItem('pulsesynth_theme') ?? 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);
$('themeToggle').textContent = savedTheme === 'dark' ? 'Light' : 'Dark';

$('themeToggle').addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('pulsesynth_theme', next);
  $('themeToggle').textContent = next === 'dark' ? 'Light' : 'Dark';
});

// ── COOP/COEP status ─────────────────────────────────────────────────
$('coopStatus').textContent = crossOriginIsolated ? 'SharedArrayBuffer: available' : 'SharedArrayBuffer: unavailable';

// ── Tabs ─────────────────────────────────────────────────────────────
document.querySelectorAll<HTMLButtonElement>('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    const target = tab.dataset.tab;
    if (target) $(`tab-${target}`).classList.add('active');
  });
});

// ── Audio Engine ─────────────────────────────────────────────────────
async function initEngine(): Promise<void> {
  try {
    engine = await createEngine({
      workletUrl: '/worklet/processor.js',
      wasmUrl: '/wasm/pulsesynth.wasm',
    });
    engine.loadPatch(currentPatch);
    await engine.start();
    updateAudioStatus('running');
  } catch (err) {
    console.error('Engine init failed:', err);
    updateAudioStatus('error');
  }
}

function updateAudioStatus(state: string) {
  const dot = $('audioDot');
  const label = $('audioStatus');
  if (state === 'running') {
    dot.className = 'status-dot green';
    label.textContent = 'Audio: running';
    $('startAudio').textContent = 'Audio Running';
    ($('startAudio') as HTMLButtonElement).disabled = true;
  } else if (state === 'stopped') {
    dot.className = 'status-dot yellow';
    label.textContent = 'Audio: stopped';
    ($('startAudio') as HTMLButtonElement).disabled = false;
    $('startAudio').textContent = 'Start Audio';
  } else {
    dot.className = 'status-dot red';
    label.textContent = `Audio: ${state}`;
  }
}

$('startAudio').addEventListener('click', initEngine);
$('stopAudio').addEventListener('click', async () => {
  if (engine) {
    await engine.stop();
    updateAudioStatus('stopped');
  }
});

// ── Studio controls ──────────────────────────────────────────────────
function bindControl(id: string, paramPath: string) {
  const el = $(id) as HTMLInputElement;
  el.addEventListener('input', () => {
    const value = Number(el.value);
    if (engine) {
      engine.setParam(paramPath as import('@pulsesynth/shared').ParamPath, value);
    }
  });
}
bindControl('masterGain', 'masterGain');
bindControl('cutoff', 'cutoff');
bindControl('resonance', 'resonance');
bindControl('envAttack', 'envAttack');
bindControl('envDecay', 'envDecay');
bindControl('envSustain', 'envSustain');
bindControl('envRelease', 'envRelease');

$('oscType').addEventListener('change', () => {
  const val = ($('oscType') as HTMLSelectElement).value;
  const map: Record<string, number> = { sine: 0, saw: 1, square: 2, triangle: 3 };
  if (engine) engine.setParam('oscType', map[val] ?? 0);
});

// ── Keyboard (computer keys) ────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const note = KEYBOARD_MAP[e.key.toLowerCase()];
  if (note !== undefined && !activeNotes.has(note)) {
    activeNotes.add(note);
    engine?.noteOn(note, 0.8);
    highlightKey(note, true);
  }
});

window.addEventListener('keyup', (e) => {
  const note = KEYBOARD_MAP[e.key.toLowerCase()];
  if (note !== undefined) {
    activeNotes.delete(note);
    engine?.noteOff(note);
    highlightKey(note, false);
  }
});

// ── On-screen keyboard ──────────────────────────────────────────────
function buildKeyboard() {
  const container = $('keyboard');
  container.innerHTML = '';
  const startNote = 48;
  const endNote = 76;
  const isBlack = (n: number) => [1, 3, 6, 8, 10].includes(n % 12);
  const whiteWidth = 36;
  const blackWidth = 24;

  let whiteIndex = 0;
  // Place white keys
  for (let note = startNote; note <= endNote; note++) {
    if (!isBlack(note)) {
      const key = document.createElement('div');
      key.className = 'key key-white';
      key.dataset.note = String(note);
      key.style.left = `${whiteIndex * whiteWidth}px`;
      const shortcut = Object.entries(KEYBOARD_MAP).find(([, n]) => n === note);
      if (shortcut) key.textContent = shortcut[0].toUpperCase();
      container.appendChild(key);
      whiteIndex++;
    }
  }

  // Place black keys
  let wIdx = 0;
  for (let note = startNote; note <= endNote; note++) {
    if (!isBlack(note)) {
      wIdx++;
    } else {
      const key = document.createElement('div');
      key.className = 'key key-black';
      key.dataset.note = String(note);
      key.style.left = `${(wIdx - 1) * whiteWidth + whiteWidth - blackWidth / 2}px`;
      container.appendChild(key);
    }
  }

  container.style.width = `${whiteIndex * whiteWidth}px`;

  // Mouse/touch interaction
  let mouseDown = false;
  container.addEventListener('pointerdown', (e) => {
    const key = (e.target as HTMLElement).closest('.key') as HTMLElement | null;
    if (!key) return;
    mouseDown = true;
    const note = Number(key.dataset.note);
    activeNotes.add(note);
    engine?.noteOn(note, 0.8);
    highlightKey(note, true);
    key.setPointerCapture(e.pointerId);
  });

  container.addEventListener('pointerup', () => {
    mouseDown = false;
    for (const note of activeNotes) {
      engine?.noteOff(note);
      highlightKey(note, false);
    }
    activeNotes.clear();
  });

  container.addEventListener('pointerleave', () => {
    if (mouseDown) {
      for (const note of activeNotes) {
        engine?.noteOff(note);
        highlightKey(note, false);
      }
      activeNotes.clear();
      mouseDown = false;
    }
  });
}

function highlightKey(note: number, active: boolean) {
  const key = document.querySelector(`.key[data-note="${note}"]`);
  if (key) key.classList.toggle('active', active);
}

buildKeyboard();

// ── Oscilloscope ─────────────────────────────────────────────────────
const scopeCanvas = $('scope') as HTMLCanvasElement;
const scopeCtx = scopeCanvas.getContext('2d')!;
let lastScopeTime = 0;

function drawScope(time: number) {
  requestAnimationFrame(drawScope);
  if (time - lastScopeTime < 33) return; // ~30fps
  lastScopeTime = time;

  if (!engine) return;
  const analyser = engine.analyserNode;
  const bufLen = analyser.frequencyBinCount;
  const data = new Uint8Array(bufLen);
  analyser.getByteTimeDomainData(data);

  const w = scopeCanvas.width;
  const h = scopeCanvas.height;
  scopeCtx.fillStyle = '#0f172a';
  scopeCtx.fillRect(0, 0, w, h);
  scopeCtx.lineWidth = 2;
  scopeCtx.strokeStyle = '#818cf8';
  scopeCtx.beginPath();

  const sliceWidth = w / bufLen;
  let x = 0;
  for (let i = 0; i < bufLen; i++) {
    const v = data[i] / 128.0;
    const y = (v * h) / 2;
    if (i === 0) scopeCtx.moveTo(x, y);
    else scopeCtx.lineTo(x, y);
    x += sliceWidth;
  }
  scopeCtx.lineTo(w, h / 2);
  scopeCtx.stroke();
}

requestAnimationFrame(drawScope);

// ── Perf display ─────────────────────────────────────────────────────
const perfChartCanvas = $('perfChart') as HTMLCanvasElement;
const perfCtx = perfChartCanvas.getContext('2d')!;
const PERF_HISTORY_LEN = 120;

setInterval(() => {
  if (!engine) return;
  const p = engine.getPerformance();
  $('perfCpu').textContent = p.cpuMsAvg.toFixed(3);
  $('perfP95').textContent = p.cpuMsP95.toFixed(3);
  $('perfXruns').textContent = String(p.xruns);
  $('perfVoices').textContent = String(p.voiceCount);
  $('perfSr').textContent = String(p.sampleRate);
  $('perfFrames').textContent = (p.renderedFrames / 1000).toFixed(0) + 'k';
  $('perfXruns').style.color = p.xruns > 0 ? 'var(--red)' : 'var(--green)';

  perfHistory.push(p.cpuMsAvg);
  if (perfHistory.length > PERF_HISTORY_LEN) perfHistory.shift();
  drawPerfChart();
}, 250);

function drawPerfChart() {
  const w = perfChartCanvas.width;
  const h = perfChartCanvas.height;
  perfCtx.fillStyle = '#0f172a';
  perfCtx.fillRect(0, 0, w, h);

  if (perfHistory.length < 2) return;
  const maxMs = Math.max(...perfHistory, 0.1);
  const sliceW = w / (PERF_HISTORY_LEN - 1);

  perfCtx.lineWidth = 1.5;
  perfCtx.strokeStyle = '#22c55e';
  perfCtx.beginPath();
  for (let i = 0; i < perfHistory.length; i++) {
    const x = i * sliceW;
    const y = h - (perfHistory[i] / maxMs) * (h - 10) - 5;
    if (i === 0) perfCtx.moveTo(x, y);
    else perfCtx.lineTo(x, y);
  }
  perfCtx.stroke();

  if (engine) {
    const budget = engine.getPerformance().audioQuantumMs;
    const budgetY = h - (budget / maxMs) * (h - 10) - 5;
    perfCtx.strokeStyle = 'rgba(239,68,68,0.5)';
    perfCtx.setLineDash([4, 4]);
    perfCtx.beginPath();
    perfCtx.moveTo(0, budgetY);
    perfCtx.lineTo(w, budgetY);
    perfCtx.stroke();
    perfCtx.setLineDash([]);
  }
}

// ── Patch editor ─────────────────────────────────────────────────────
function patchFromForm(): Patch {
  return {
    version: 2,
    name: ($('patchName') as HTMLInputElement).value || 'Untitled',
    oscType: ($('patchOsc') as HTMLSelectElement).value as Patch['oscType'],
    masterGain: Number(($('patchGain') as HTMLInputElement).value),
    filter: {
      cutoff: Number(($('patchCutoff') as HTMLInputElement).value),
      resonance: Number(($('patchResonance') as HTMLInputElement).value),
    },
    env: {
      attack: Number(($('patchAttack') as HTMLInputElement).value),
      decay: Number(($('patchDecay') as HTMLInputElement).value),
      sustain: Number(($('patchSustain') as HTMLInputElement).value),
      release: Number(($('patchRelease') as HTMLInputElement).value),
    },
    lfo: { rate: 2.5, depth: 0.15, target: 'cutoff' },
    metadata: { tags: [] },
    noiseAmount: Number(($('patchNoise') as HTMLInputElement).value),
  };
}

function patchToForm(p: Patch) {
  ($('patchName') as HTMLInputElement).value = p.name;
  ($('patchOsc') as HTMLSelectElement).value = p.oscType;
  ($('patchGain') as HTMLInputElement).value = String(p.masterGain);
  ($('patchNoise') as HTMLInputElement).value = String(p.noiseAmount);
  ($('patchCutoff') as HTMLInputElement).value = String(p.filter.cutoff);
  ($('patchResonance') as HTMLInputElement).value = String(p.filter.resonance);
  ($('patchAttack') as HTMLInputElement).value = String(p.env.attack);
  ($('patchDecay') as HTMLInputElement).value = String(p.env.decay);
  ($('patchSustain') as HTMLInputElement).value = String(p.env.sustain);
  ($('patchRelease') as HTMLInputElement).value = String(p.env.release);
  // Sync studio controls
  ($('masterGain') as HTMLInputElement).value = String(p.masterGain);
  ($('oscType') as HTMLSelectElement).value = p.oscType;
  ($('cutoff') as HTMLInputElement).value = String(p.filter.cutoff);
  ($('resonance') as HTMLInputElement).value = String(p.filter.resonance);
  ($('envAttack') as HTMLInputElement).value = String(p.env.attack);
  ($('envDecay') as HTMLInputElement).value = String(p.env.decay);
  ($('envSustain') as HTMLInputElement).value = String(p.env.sustain);
  ($('envRelease') as HTMLInputElement).value = String(p.env.release);
}

$('applyPatch').addEventListener('click', () => {
  currentPatch = patchFromForm();
  engine?.loadPatch(currentPatch);
  $('patchJson').textContent = JSON.stringify(currentPatch, null, 2);
});

$('resetPatch').addEventListener('click', () => {
  currentPatch = { ...DEFAULT_PATCH };
  patchToForm(currentPatch);
  engine?.loadPatch(currentPatch);
  $('patchJson').textContent = JSON.stringify(currentPatch, null, 2);
});

// ── Presets (localStorage) ───────────────────────────────────────────
function getPresets(): Array<{ name: string; patch: Patch }> {
  try { return JSON.parse(localStorage.getItem('pulsesynth_presets') ?? '[]'); }
  catch { return []; }
}

function savePresets(presets: Array<{ name: string; patch: Patch }>) {
  localStorage.setItem('pulsesynth_presets', JSON.stringify(presets));
}

function renderPresetList() {
  const list = $('presetList');
  list.innerHTML = '';
  const presets = getPresets();
  for (const [i, preset] of presets.entries()) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${preset.name}</span><span>
      <button class="btn-sm load-preset" data-idx="${i}">Load</button>
      <button class="btn-sm del-preset" data-idx="${i}">Del</button>
    </span>`;
    list.appendChild(li);
  }
  list.querySelectorAll('.load-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number((btn as HTMLElement).dataset.idx);
      const preset = presets[idx];
      if (preset) {
        currentPatch = preset.patch;
        patchToForm(currentPatch);
        engine?.loadPatch(currentPatch);
      }
    });
  });
  list.querySelectorAll('.del-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number((btn as HTMLElement).dataset.idx);
      presets.splice(idx, 1);
      savePresets(presets);
      renderPresetList();
    });
  });
}

$('savePreset').addEventListener('click', () => {
  const presets = getPresets();
  const patch = patchFromForm();
  presets.push({ name: patch.name, patch });
  savePresets(presets);
  renderPresetList();
});

$('exportPatch').addEventListener('click', () => {
  const patch = patchFromForm();
  const blob = new Blob([JSON.stringify(patch, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${patch.name.replace(/\s+/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

$('importPatch').addEventListener('click', () => ($('importFile') as HTMLInputElement).click());
$('importFile').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const patch = JSON.parse(text);
    currentPatch = patch;
    patchToForm(currentPatch);
    engine?.loadPatch(currentPatch);
  } catch (err) {
    console.error('Import failed:', err);
  }
});

renderPresetList();
$('patchJson').textContent = JSON.stringify(currentPatch, null, 2);

// ── Cloud ────────────────────────────────────────────────────────────
function updateAuthUI() {
  const loggedIn = api.isLoggedIn();
  $('authForms').style.display = loggedIn ? 'none' : 'block';
  $('authLoggedIn').style.display = loggedIn ? 'block' : 'none';
}

$('loginBtn').addEventListener('click', async () => {
  const email = ($('authEmail') as HTMLInputElement).value;
  const pass = ($('authPassword') as HTMLInputElement).value;
  const result = await api.login(email, pass);
  if (result.ok) {
    updateAuthUI();
    refreshCloudPatches();
  } else {
    $('authError').textContent = result.error ?? 'Login failed';
    $('authError').style.display = 'block';
  }
});

$('signupBtn').addEventListener('click', async () => {
  const email = ($('authEmail') as HTMLInputElement).value;
  const pass = ($('authPassword') as HTMLInputElement).value;
  if (pass.length < 8) {
    $('authError').textContent = 'Password must be at least 8 characters';
    $('authError').style.display = 'block';
    return;
  }
  const result = await api.signup(email, pass);
  if (result.ok) {
    updateAuthUI();
    refreshCloudPatches();
  } else {
    $('authError').textContent = result.error ?? 'Signup failed';
    $('authError').style.display = 'block';
  }
});

$('logoutBtn').addEventListener('click', () => {
  api.logout();
  updateAuthUI();
  $('cloudPatchList').innerHTML = '';
});

$('cloudSave').addEventListener('click', async () => {
  const patch = patchFromForm();
  const result = await api.savePatch(patch.name, patch);
  const msg = $('cloudMsg');
  msg.style.display = 'block';
  msg.textContent = result.ok ? `Saved! (ID: ${result.id})` : 'Save failed — are you logged in?';
  if (result.ok) refreshCloudPatches();
});

$('cloudRefresh').addEventListener('click', refreshCloudPatches);

async function refreshCloudPatches() {
  const patches = await api.listPatches();
  const list = $('cloudPatchList');
  list.innerHTML = '';
  for (const p of patches) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${p.name}${p.shared ? ' (shared)' : ''}</span><span>
      <button class="btn-sm cloud-load" data-id="${p.id}">Load</button>
      <button class="btn-sm cloud-share" data-id="${p.id}">Share</button>
      <button class="btn-sm cloud-del" data-id="${p.id}">Del</button>
    </span>`;
    list.appendChild(li);
  }
  list.querySelectorAll('.cloud-load').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number((btn as HTMLElement).dataset.id);
      const result = await api.loadPatch(id);
      if (result.ok && result.patch) {
        currentPatch = result.patch as Patch;
        patchToForm(currentPatch);
        engine?.loadPatch(currentPatch);
      }
    });
  });
  list.querySelectorAll('.cloud-share').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number((btn as HTMLElement).dataset.id);
      const ok = await api.sharePatch(id);
      if (ok) {
        const url = `${window.location.origin}?patch=${id}`;
        await navigator.clipboard.writeText(url).catch(() => {});
        const msg = $('cloudMsg');
        msg.style.display = 'block';
        msg.textContent = `Share link copied: ${url}`;
        refreshCloudPatches();
      }
    });
  });
  list.querySelectorAll('.cloud-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number((btn as HTMLElement).dataset.id);
      await api.deletePatch(id);
      refreshCloudPatches();
    });
  });
}

updateAuthUI();

// ── API health check ─────────────────────────────────────────────────
async function checkApiHealth() {
  const ok = await api.healthCheck();
  $('apiDot').className = `status-dot ${ok ? 'green' : 'red'}`;
  $('apiStatus').textContent = ok ? 'API: online' : 'API: offline';
}
checkApiHealth();
setInterval(checkApiHealth, 30000);

// ── URL patch loading ────────────────────────────────────────────────
const urlPatchId = new URLSearchParams(window.location.search).get('patch');
if (urlPatchId) {
  api.loadPatch(Number(urlPatchId)).then(result => {
    if (result.ok && result.patch) {
      currentPatch = result.patch as Patch;
      patchToForm(currentPatch);
      engine?.loadPatch(currentPatch);
    }
  });
}
