const MAX_VOICES_LIMIT: usize = 32;
const MAX_FRAMES: usize = 2048;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct PerfStats {
    pub cpu_ms_estimate: f32,
    pub xruns: u32,
    pub voice_count: u32,
}

#[derive(Clone, Copy)]
struct Voice {
    active: bool,
    note: u8,
    phase: f32,
    freq: f32,
    velocity: f32,
    env: f32,
    gate: bool,
}

impl Voice {
    const fn new() -> Self {
        Self { active: false, note: 0, phase: 0.0, freq: 0.0, velocity: 0.0, env: 0.0, gate: false }
    }
}

static mut PERF: PerfStats = PerfStats { cpu_ms_estimate: 0.0, xruns: 0, voice_count: 0 };
static mut SAMPLE_RATE: f32 = 48_000.0;
static mut MASTER_GAIN: f32 = 0.4;
static mut ENV_A: f32 = 0.01;
static mut ENV_D: f32 = 0.2;
static mut ENV_S: f32 = 0.75;
static mut ENV_R: f32 = 0.35;
static mut CUTOFF: f32 = 2_200.0;
static mut LAST_L: f32 = 0.0;
static mut LAST_R: f32 = 0.0;
static mut MAX_VOICES: usize = 8;
static mut VOICES: [Voice; MAX_VOICES_LIMIT] = [Voice::new(); MAX_VOICES_LIMIT];
static mut OUT_L: [f32; MAX_FRAMES] = [0.0; MAX_FRAMES];
static mut OUT_R: [f32; MAX_FRAMES] = [0.0; MAX_FRAMES];

#[unsafe(no_mangle)]
pub extern "C" fn init(sample_rate: f32, max_voices: u32) {
    unsafe {
        SAMPLE_RATE = sample_rate.max(8_000.0);
        MAX_VOICES = (max_voices as usize).min(MAX_VOICES_LIMIT).max(1);
        for i in 0..MAX_VOICES_LIMIT {
            VOICES[i] = Voice::new();
        }
        PERF.voice_count = 0;
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn set_params(master_gain: f32, attack: f32, decay: f32, sustain: f32, release: f32, cutoff: f32) {
    unsafe {
        MASTER_GAIN = master_gain.clamp(0.0, 1.0);
        ENV_A = attack.max(0.001);
        ENV_D = decay.max(0.001);
        ENV_S = sustain.clamp(0.0, 1.0);
        ENV_R = release.max(0.001);
        CUTOFF = cutoff.clamp(20.0, 20_000.0);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn note_on(note: u32, velocity: f32) {
    unsafe {
        let idx = (0..MAX_VOICES).find(|&i| !VOICES[i].active).unwrap_or(0);
        let v = &mut VOICES[idx];
        v.active = true;
        v.note = note as u8;
        v.freq = 440.0 * (2.0f32).powf((note as f32 - 69.0) / 12.0);
        v.velocity = velocity.clamp(0.0, 1.0);
        v.phase = 0.0;
        v.env = 0.0;
        v.gate = true;
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn note_off(note: u32) {
    unsafe {
        for i in 0..MAX_VOICES {
            if VOICES[i].active && VOICES[i].note as u32 == note {
                VOICES[i].gate = false;
            }
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn all_notes_off() {
    unsafe {
        for i in 0..MAX_VOICES {
            VOICES[i].gate = false;
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn render(frames: u32) -> u32 {
    let frames = (frames as usize).min(MAX_FRAMES);
    let sr = unsafe { SAMPLE_RATE };
    let a_step = 1.0 / (unsafe { ENV_A } * sr);
    let d_step = (1.0 - unsafe { ENV_S }) / (unsafe { ENV_D } * sr);
    let r_step = unsafe { ENV_S }.max(0.001) / (unsafe { ENV_R } * sr);
    let alpha = (unsafe { CUTOFF } / sr).clamp(0.0005, 0.45);

    let mut active_count = 0u32;
    for i in 0..frames {
        let mut mono = 0.0f32;
        unsafe {
            for v in 0..MAX_VOICES {
                let voice = &mut VOICES[v];
                if !voice.active {
                    continue;
                }
                active_count += 1;
                if voice.gate {
                    if voice.env < 1.0 {
                        voice.env = (voice.env + a_step).min(1.0);
                    } else {
                        voice.env = (voice.env - d_step).max(ENV_S);
                    }
                } else {
                    voice.env -= r_step;
                    if voice.env <= 0.0001 {
                        voice.active = false;
                        voice.env = 0.0;
                        continue;
                    }
                }
                let sine = voice.phase.sin();
                let saw = (voice.phase / core::f32::consts::PI) - 1.0;
                let sample = (0.65 * sine + 0.35 * saw) * voice.velocity * voice.env;
                mono += sample;
                voice.phase += core::f32::consts::TAU * voice.freq / sr;
                if voice.phase > core::f32::consts::TAU {
                    voice.phase -= core::f32::consts::TAU;
                }
            }
            mono *= MASTER_GAIN / (MAX_VOICES as f32).sqrt();
            LAST_L += alpha * (mono - LAST_L);
            LAST_R += alpha * (mono - LAST_R);
            OUT_L[i] = LAST_L;
            OUT_R[i] = LAST_R;
        }
    }

    unsafe {
        PERF.cpu_ms_estimate = (frames as f32 / sr) * 0.25;
        PERF.voice_count = active_count.min(MAX_VOICES as u32);
    }
    frames as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn get_out_l_ptr() -> *const f32 { &raw const OUT_L as *const f32 }

#[unsafe(no_mangle)]
pub extern "C" fn get_out_r_ptr() -> *const f32 { &raw const OUT_R as *const f32 }

#[unsafe(no_mangle)]
pub extern "C" fn get_perf_ptr() -> *const PerfStats { &raw const PERF }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn note_on_renders_non_zero() {
        init(48_000.0, 8);
        set_params(0.4, 0.01, 0.2, 0.7, 0.3, 1_200.0);
        note_on(69, 1.0);
        render(128);
        let mut hit = false;
        unsafe {
            for i in 0..128 {
                if OUT_L[i].abs() > 0.0001 {
                    hit = true;
                    break;
                }
            }
        }
        assert!(hit);
        note_off(69);
    }
}
