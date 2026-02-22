# PulseSynth API

## Engine

- `createEngine({ wasmUrl, workletUrl, polyphony, patch })`
- `start() / stop()`
- `noteOn(note, velocity)` / `noteOff(note)` / `allNotesOff()`
- `setParam(path, value, time?, ramp?)`
- `setPatch(patch)`
- `onPerformance(cb)` / `getPerformance()`
- `destroy()`

## Backend

- `POST /v1/auth/signup`
- `POST /v1/auth/login`
- `GET /v1/me`
- `POST /v1/patches`
- `GET /v1/patches`
- `GET /v1/patches/:id`
- `PATCH /v1/patches/:id`
- `POST /v1/patches/:id/share`
- `DELETE /v1/patches/:id`
