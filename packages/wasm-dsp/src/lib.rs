#[repr(C)]
pub struct PerfStats {
    pub cpu_ms_estimate: f32,
    pub xruns: u32,
    pub voice_count: u32,
}

static mut PERF: PerfStats = PerfStats { cpu_ms_estimate: 0.0, xruns: 0, voice_count: 0 };
static mut SAMPLE_RATE: f32 = 48000.0;

#[unsafe(no_mangle)]
pub extern "C" fn init(sample_rate: f32, max_voices: u32) {
    unsafe {
        SAMPLE_RATE = sample_rate;
        PERF.voice_count = max_voices;
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn render(out_l_ptr: *mut f32, out_r_ptr: *mut f32, frames: u32) -> u32 {
    let out_l = unsafe { std::slice::from_raw_parts_mut(out_l_ptr, frames as usize) };
    let out_r = unsafe { std::slice::from_raw_parts_mut(out_r_ptr, frames as usize) };
    for i in 0..frames as usize {
        let t = i as f32 / unsafe { SAMPLE_RATE };
        let sample = (t * 440.0 * core::f32::consts::TAU).sin() * 0.05;
        out_l[i] = sample;
        out_r[i] = sample;
    }
    unsafe { PERF.cpu_ms_estimate = 0.05; }
    frames
}

#[unsafe(no_mangle)]
pub extern "C" fn get_perf_ptr() -> *const PerfStats {
    &raw const PERF
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_writes_samples() {
        let mut l = [0.0f32; 128];
        let mut r = [0.0f32; 128];
        init(48000.0, 8);
        render(l.as_mut_ptr(), r.as_mut_ptr(), 128);
        assert!(l.iter().any(|x| *x != 0.0));
    }
}
