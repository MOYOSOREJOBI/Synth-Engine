#![allow(static_mut_refs)]

use core::f32::consts::PI;
use core::f64::consts::PI as PI64;

const MAX_VOICES: usize = 16;
const QUANTUM: usize = 128;
const TAU64: f64 = PI64 * 2.0;
const TAU32: f32 = PI * 2.0;

// ── Performance stats ────────────────────────────────────────────────
#[repr(C)]
pub struct PerfStats {
    pub cpu_ms_estimate: f32,
    pub xruns: u32,
    pub voice_count: u32,
}

// ── Envelope stages ──────────────────────────────────────────────────
#[derive(Clone, Copy, PartialEq)]
#[repr(u8)]
enum EnvStage {
    Off = 0,
    Attack = 1,
    Decay = 2,
    Sustain = 3,
    Release = 4,
}

// ── Voice ────────────────────────────────────────────────────────────
#[derive(Clone, Copy)]
struct Voice {
    active: bool,
    note: u8,
    velocity: f32,
    phase: f64,
    phase_inc: f64,
    env_stage: EnvStage,
    env_level: f32,
}

impl Voice {
    const fn new() -> Self {
        Voice {
            active: false,
            note: 0,
            velocity: 0.0,
            phase: 0.0,
            phase_inc: 0.0,
            env_stage: EnvStage::Off,
            env_level: 0.0,
        }
    }
}

// ── Parameter smoother ───────────────────────────────────────────────
#[derive(Clone, Copy)]
struct SmoothedParam {
    current: f32,
    target: f32,
    coeff: f32,
}

impl SmoothedParam {
    const fn new(value: f32) -> Self {
        SmoothedParam {
            current: value,
            target: value,
            coeff: 0.005,
        }
    }

    fn set_target(&mut self, target: f32) {
        self.target = target;
    }

    fn tick(&mut self) -> f32 {
        self.current += self.coeff * (self.target - self.current);
        self.current
    }

    fn init_coeff(&mut self, sr: f32) {
        self.coeff = 1.0 - libm::expf(-1.0 / (0.005 * sr));
    }

    fn snap(&mut self, value: f32) {
        self.current = value;
        self.target = value;
    }
}

// ── Simple deterministic PRNG (no alloc) ─────────────────────────────
struct Rng {
    state: u32,
}

impl Rng {
    const fn new() -> Self {
        Rng { state: 123456789 }
    }

    fn next_f32(&mut self) -> f32 {
        self.state = self.state.wrapping_mul(1664525).wrapping_add(1013904223);
        (self.state as f32 / 4294967295.0) * 2.0 - 1.0
    }
}

// ── Synth state (all static, no heap) ────────────────────────────────
struct SynthState {
    sample_rate: f32,
    inv_sample_rate: f64,
    voices: [Voice; MAX_VOICES],
    osc_type: u32,
    master_gain: SmoothedParam,
    filter_cutoff: SmoothedParam,
    filter_resonance: SmoothedParam,
    env_attack: f32,
    env_decay: f32,
    env_sustain: f32,
    env_release: f32,
    noise_amount: f32,
    filter_z1_l: f32,
    filter_z1_r: f32,
    rng: Rng,
    active_voice_count: u32,
}

impl SynthState {
    const fn new() -> Self {
        SynthState {
            sample_rate: 48000.0,
            inv_sample_rate: 1.0 / 48000.0,
            voices: [Voice::new(); MAX_VOICES],
            osc_type: 0,
            master_gain: SmoothedParam::new(0.45),
            filter_cutoff: SmoothedParam::new(2200.0),
            filter_resonance: SmoothedParam::new(0.5),
            env_attack: 0.01,
            env_decay: 0.2,
            env_sustain: 0.8,
            env_release: 0.4,
            noise_amount: 0.02,
            filter_z1_l: 0.0,
            filter_z1_r: 0.0,
            rng: Rng::new(),
            active_voice_count: 0,
        }
    }

    fn init(&mut self, sample_rate: f32, _max_voices: u32) {
        self.sample_rate = sample_rate;
        self.inv_sample_rate = 1.0 / sample_rate as f64;
        self.master_gain.init_coeff(sample_rate);
        self.filter_cutoff.init_coeff(sample_rate);
        self.filter_resonance.init_coeff(sample_rate);
        for v in self.voices.iter_mut() {
            *v = Voice::new();
        }
        self.filter_z1_l = 0.0;
        self.filter_z1_r = 0.0;
    }
}

// ── Global state ─────────────────────────────────────────────────────
static mut SYNTH: SynthState = SynthState::new();
static mut OUTPUT_L: [f32; QUANTUM] = [0.0; QUANTUM];
static mut OUTPUT_R: [f32; QUANTUM] = [0.0; QUANTUM];
static mut PERF: PerfStats = PerfStats {
    cpu_ms_estimate: 0.0,
    xruns: 0,
    voice_count: 0,
};

// ── Helper functions ─────────────────────────────────────────────────
fn note_to_freq(note: u8) -> f64 {
    440.0 * libm::pow(2.0, (note as f64 - 69.0) / 12.0)
}

fn oscillator(phase: f64, osc_type: u32) -> f32 {
    match osc_type {
        0 => libm::sin(phase * TAU64) as f32,
        1 => (2.0 * phase - 1.0) as f32,
        2 => {
            if phase < 0.5 {
                1.0
            } else {
                -1.0
            }
        }
        3 => {
            let p = phase as f32;
            if p < 0.5 {
                4.0 * p - 1.0
            } else {
                3.0 - 4.0 * p
            }
        }
        _ => 0.0,
    }
}

fn process_envelope(
    voice: &mut Voice,
    attack: f32,
    decay: f32,
    sustain: f32,
    release: f32,
    sr: f32,
) -> f32 {
    match voice.env_stage {
        EnvStage::Attack => {
            let rate = 1.0 / (attack * sr).max(1.0);
            voice.env_level += rate;
            if voice.env_level >= 1.0 {
                voice.env_level = 1.0;
                voice.env_stage = EnvStage::Decay;
            }
            voice.env_level
        }
        EnvStage::Decay => {
            let rate = 1.0 / (decay * sr).max(1.0);
            voice.env_level -= rate;
            if voice.env_level <= sustain {
                voice.env_level = sustain;
                voice.env_stage = EnvStage::Sustain;
            }
            voice.env_level
        }
        EnvStage::Sustain => sustain,
        EnvStage::Release => {
            let rate = 1.0 / (release * sr).max(1.0);
            voice.env_level -= rate;
            if voice.env_level <= 0.001 {
                voice.env_level = 0.0;
                voice.env_stage = EnvStage::Off;
            }
            voice.env_level
        }
        EnvStage::Off => 0.0,
    }
}

fn lpf_1pole(input: f32, state: &mut f32, cutoff: f32, sr: f32) -> f32 {
    let freq = if cutoff > sr * 0.49 {
        sr * 0.49
    } else if cutoff < 20.0 {
        20.0
    } else {
        cutoff
    };
    let coeff = 1.0 - libm::expf(-TAU32 * freq / sr);
    *state += coeff * (input - *state);
    *state
}

// ── Exported WASM API ────────────────────────────────────────────────

#[unsafe(no_mangle)]
pub extern "C" fn init(sample_rate: f32, max_voices: u32) {
    unsafe {
        SYNTH.init(sample_rate, max_voices);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn note_on(note: u32, velocity: f32) {
    unsafe {
        let note = note as u8;
        let synth = &mut SYNTH;

        let mut target: Option<usize> = None;

        // Re-use voice already playing this note
        for (i, voice) in synth.voices.iter().enumerate() {
            if voice.note == note && voice.env_stage != EnvStage::Off {
                target = Some(i);
                break;
            }
        }

        // Find a free voice
        if target.is_none() {
            for (i, voice) in synth.voices.iter().enumerate() {
                if voice.env_stage == EnvStage::Off {
                    target = Some(i);
                    break;
                }
            }
        }

        // Steal the voice with lowest envelope level
        if target.is_none() {
            let mut min_level = f32::MAX;
            let mut min_idx = 0;
            for (i, voice) in synth.voices.iter().enumerate() {
                if voice.env_level < min_level {
                    min_level = voice.env_level;
                    min_idx = i;
                }
            }
            target = Some(min_idx);
        }

        if let Some(idx) = target {
            let freq = note_to_freq(note);
            let voice = &mut synth.voices[idx];
            voice.active = true;
            voice.note = note;
            voice.velocity = velocity;
            voice.phase = 0.0;
            voice.phase_inc = freq * synth.inv_sample_rate;
            voice.env_stage = EnvStage::Attack;
            voice.env_level = 0.0;
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn note_off(note: u32) {
    unsafe {
        let note = note as u8;
        for voice in SYNTH.voices.iter_mut() {
            if voice.note == note && voice.active {
                voice.active = false;
                if voice.env_stage != EnvStage::Off {
                    voice.env_stage = EnvStage::Release;
                }
                break;
            }
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn all_notes_off() {
    unsafe {
        for voice in SYNTH.voices.iter_mut() {
            if voice.env_stage != EnvStage::Off {
                voice.active = false;
                voice.env_stage = EnvStage::Release;
            }
        }
    }
}

/// Param IDs: 0=masterGain 1=filterCutoff 2=filterResonance
/// 3=envAttack 4=envDecay 5=envSustain 6=envRelease
/// 7=noiseAmount 8=oscType
#[unsafe(no_mangle)]
pub extern "C" fn set_param(param_id: u32, value: f32) {
    unsafe {
        match param_id {
            0 => SYNTH.master_gain.set_target(value),
            1 => SYNTH.filter_cutoff.set_target(value),
            2 => SYNTH.filter_resonance.set_target(value),
            3 => SYNTH.env_attack = value.max(0.001),
            4 => SYNTH.env_decay = value.max(0.001),
            5 => SYNTH.env_sustain = value.max(0.0).min(1.0),
            6 => SYNTH.env_release = value.max(0.001),
            7 => SYNTH.noise_amount = value.max(0.0).min(1.0),
            8 => SYNTH.osc_type = (value as u32).min(3),
            _ => {}
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn render(frames: u32) -> u32 {
    let frames = (frames as usize).min(QUANTUM);
    unsafe {
        let synth = &mut SYNTH;
        let sr = synth.sample_rate;
        let mut active_count: u32 = 0;

        for i in 0..frames {
            let gain = synth.master_gain.tick();
            let cutoff = synth.filter_cutoff.tick();
            let _resonance = synth.filter_resonance.tick();

            let mut mix_l: f32 = 0.0;
            let mut mix_r: f32 = 0.0;

            for voice in synth.voices.iter_mut() {
                if voice.env_stage == EnvStage::Off {
                    continue;
                }

                let env = process_envelope(
                    voice,
                    synth.env_attack,
                    synth.env_decay,
                    synth.env_sustain,
                    synth.env_release,
                    sr,
                );

                if voice.env_stage == EnvStage::Off {
                    continue;
                }

                let osc = oscillator(voice.phase, synth.osc_type);
                voice.phase += voice.phase_inc;
                if voice.phase >= 1.0 {
                    voice.phase -= 1.0;
                }

                let sample = osc * env * voice.velocity;
                mix_l += sample;
                mix_r += sample;
            }

            // Noise
            if synth.noise_amount > 0.001 {
                let noise = synth.rng.next_f32() * synth.noise_amount;
                mix_l += noise;
                mix_r += noise;
            }

            // 1-pole lowpass filter
            mix_l = lpf_1pole(mix_l, &mut synth.filter_z1_l, cutoff, sr);
            mix_r = lpf_1pole(mix_r, &mut synth.filter_z1_r, cutoff, sr);

            // Master gain
            OUTPUT_L[i] = mix_l * gain;
            OUTPUT_R[i] = mix_r * gain;
        }

        for voice in synth.voices.iter() {
            if voice.env_stage != EnvStage::Off {
                active_count += 1;
            }
        }
        PERF.voice_count = active_count;
    }
    frames as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn get_output_l_ptr() -> *const f32 {
    unsafe { OUTPUT_L.as_ptr() }  // must stay unsafe: shared ref to static mut
}

#[unsafe(no_mangle)]
pub extern "C" fn get_output_r_ptr() -> *const f32 {
    unsafe { OUTPUT_R.as_ptr() }  // must stay unsafe: shared ref to static mut
}

#[unsafe(no_mangle)]
pub extern "C" fn get_perf_ptr() -> *const PerfStats {
    &raw const PERF
}

// ── Tests ────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;

    fn reset() {
        unsafe {
            SYNTH = SynthState::new();
            OUTPUT_L = [0.0; QUANTUM];
            OUTPUT_R = [0.0; QUANTUM];
        }
    }

    #[test]
    fn render_silence_without_notes() {
        reset();
        init(48000.0, 8);
        set_param(7, 0.0); // no noise
        render(128);
        unsafe {
            for s in OUTPUT_L.iter() {
                assert!(s.abs() < 0.001, "Expected silence, got {}", s);
            }
        }
    }

    #[test]
    fn render_produces_sound_on_note_on() {
        reset();
        init(48000.0, 8);
        set_param(7, 0.0);
        note_on(69, 0.9);
        for _ in 0..4 {
            render(128);
        }
        unsafe {
            let max = OUTPUT_L.iter().fold(0.0f32, |a, &b| a.max(b.abs()));
            assert!(max > 0.01, "Expected audible output, peak was {}", max);
        }
    }

    #[test]
    fn note_off_triggers_release() {
        reset();
        init(48000.0, 8);
        set_param(7, 0.0);
        note_on(60, 0.8);
        for _ in 0..10 {
            render(128);
        }
        note_off(60);
        for _ in 0..200 {
            render(128);
        }
        unsafe {
            let max = OUTPUT_L.iter().fold(0.0f32, |a, &b| a.max(b.abs()));
            assert!(max < 0.01, "Expected silence after release, peak was {}", max);
        }
    }

    #[test]
    fn polyphony_works() {
        reset();
        init(48000.0, 8);
        set_param(7, 0.0);
        note_on(60, 0.5);
        note_on(64, 0.5);
        note_on(67, 0.5);
        for _ in 0..4 {
            render(128);
        }
        unsafe {
            assert_eq!(PERF.voice_count, 3);
        }
    }

    #[test]
    fn set_osc_type_works() {
        reset();
        init(48000.0, 8);
        set_param(8, 1.0); // saw
        set_param(7, 0.0);
        note_on(69, 0.9);
        for _ in 0..4 {
            render(128);
        }
        unsafe {
            let max = OUTPUT_L.iter().fold(0.0f32, |a, &b| a.max(b.abs()));
            assert!(max > 0.01, "Saw wave should produce output");
        }
    }

    #[test]
    fn all_notes_off_works() {
        reset();
        init(48000.0, 8);
        set_param(7, 0.0);
        note_on(60, 0.8);
        note_on(64, 0.8);
        for _ in 0..4 {
            render(128);
        }
        all_notes_off();
        for _ in 0..200 {
            render(128);
        }
        unsafe {
            let max = OUTPUT_L.iter().fold(0.0f32, |a, &b| a.max(b.abs()));
            assert!(max < 0.01, "Expected silence after all_notes_off");
        }
    }

    #[test]
    fn output_pointers_valid() {
        reset();
        init(48000.0, 8);
        let l_ptr = get_output_l_ptr();
        let r_ptr = get_output_r_ptr();
        assert!(!l_ptr.is_null());
        assert!(!r_ptr.is_null());
        assert_ne!(l_ptr, r_ptr);
    }
}
