# Real-time safety

- Avoid allocations in `AudioWorkletProcessor.process()`.
- Reuse typed arrays and event queues.
- Keep deterministic message batching.
