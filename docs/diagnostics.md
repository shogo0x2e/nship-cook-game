# Cookgame diagnostics

The public experience initializes `@sentry/browser` only on the exact origin
`https://cookgame.shogo0x2e.com`. The local review and legacy entries never upload.
The committed DSN in `src/diagnostics-config.json` is the public ingestion key;
no admin password or API token belongs in this repository.

## Collected events

- Unhandled application errors/rejections, CPU Lite initialization/inference,
  camera startup (permission denial is distinguished), and artwork load errors.
- Possible tracking instability: a five-second window with at least12 samples,
  at least8 valid samples, and repeated large angle jumps or validity toggles.
  A single motion/miss and ordinary slow3fps updates do not qualify.
- Tracking acquired and then absent for5seconds; no result for5seconds while
  active; sustained median inference above250ms with enough valid observations.
- Background tabs, portrait blocking and manual pause reset observation windows.
  Initial failure to frame the body is not labelled a device error.

These warnings identify symptoms, not their cause. Camera placement, occlusion,
ordinary motion and device compatibility can all affect tracking. The thresholds
are conservative starting values validated with synthetic sequences; real
household results can inform later changes.

Only counts, window duration, inference/cadence percentiles and image dimensions
are exported. One previous set of angles stays in memory for comparison and is
never serialized. Each warning is emitted once per mounted game and duplicate
code/error-kind events are limited to once per document, at most12 events total.
This is diagnostic sampling, not a count of every failed frame or a failure-rate
denominator.

## Context and privacy

Events include the runtime `/api/version` revision, screen name, CPU/Lite tags,
the existing anonymous browser UUID, and the six-character experience ID.
`?demo=1` events use Sentry's `demo` environment; regular events use `production`.
Browser/OS versions, viewport size, touch support, CPU count and approximate
memory are attached when available. The browser's client hints may supply the
hardware model; a model cannot be guaranteed on every browser. No fingerprinting
library or additional persistent identifier is introduced.

Default SDK integrations are disabled. Replay, profiling, tracing, sessions,
console/DOM/network breadcrumbs and client reports are not enabled. Automatic
PII/body/header/cookie/query collection is explicitly disabled. `beforeSend`
rebuilds each event from an allowlist: exception messages become fixed categories,
stack frames retain only local application filenames/function/line/column,
and URL queries, free text and all unapproved fields are dropped. Camera frames,
audio, face images, landmark arrays, survey answers/comments and private response
keys are never passed to telemetry. Existing Sentry server-side IP/sensitive-field
scrubbing provides a second layer. Diagnostic failure never blocks the game.

Source maps are not uploaded by this integration. Fixed event categories,
release revision and application stack locations provide the initial diagnosis;
automatic source-map symbolication would need a separately scoped CI credential.

## Verification

`npm test` covers aggregate detection and hostile extra-data scrubbing.
`tests/diagnostics-e2e.mjs` routes the public hostname to a temporary local
application server and intercepts Sentry ingestion. It verifies the actual SDK
envelopes, repeated synthetic arm jumps through the game callback, permission
failure, anonymous context, disabled local upload and continued play when the
diagnostics endpoint fails. It never visits or writes to the live game.

The normal CI E2E suite includes this isolated test. Real Sentry acceptance is
verified separately with a synthetic envelope and a read of that exact event ID;
it does not submit a household questionnaire or assert real-device compatibility.
