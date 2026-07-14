# First Light audio-accessibility visual evidence

Captured at the same 1280×720 deterministic Settings state with reduced motion,
keyboard focus, 130% Combat HUD size, and High Contrast enabled.

- `accessibility-before.png` — deployed `main` before this candidate.
- `accessibility-after.png` — this branch with captions, caption detail, mono
  audio, and vibration controls added in the existing menu language.
- `accessibility-comparison.png` — source and candidate shown together at the
  same state for visual review.
- `gameplay-caption.png` — production gameplay HUD with the independent spoken
  caption lane. Harness receipt: `qa-voice`, `speech`, `EXC:0`.

The comparison is design evidence, not a delivery claim. Merge, CI, Pages, and
live smoke remain required before the bounded slice is called shipped.
