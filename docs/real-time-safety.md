# Real-time safety rules

- No allocations in `AudioWorkletProcessor.process()` hot path.
- Event queue uses preallocated ring buffers.
- Patch/JSON parsing occurs on main thread only.
- WASM render writes to pre-reserved memory slices, copied into output channels.
- Perf posting is throttled (~4 Hz).
