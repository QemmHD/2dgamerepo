# First Light audio-accessibility visual evidence

Captured at the same 1280×720 deterministic Settings state with reduced motion,
keyboard focus, 130% Combat HUD size, and High Contrast enabled.

## Snapshot identity

- Source: deployed `main` at `2183059370110629444da68fae65167ad9ff95bd`.
- Candidate: feature commit `8fef031d2e078a716c19f21f4f1cb2cffc95ec76`.
- Browser/viewport: Codex in-app Browser, 1280×720 CSS pixels.
- Settings query: `tools/artshot/harness.html?seconds=0&screen=menu&tab=settings&settingspane=accessibility&uiscale=130&contrast=1&input=keyboard&focus=setUiScale%3A130%230&reduced=1`.
- Caption query: `tools/artshot/harness.html?seconds=5&captions=1&captiondetail=essential&caption=voice&reduced=1&badge=1`.

- `accessibility-before.png` — deployed `main` before this candidate.
- `accessibility-after.png` — this branch with captions, caption detail, mono
  audio, and vibration controls added in the existing menu language.
- `accessibility-comparison.png` — source and candidate shown together at the
  same state for visual review.
- `gameplay-caption.png` — production gameplay HUD with the independent spoken
  caption lane. Harness receipt: `qa-voice`, `speech`, `EXC:0`.

The Settings captures reported `data-qa-ready="1"`, Accessibility pane, 130% HUD,
High Contrast `true`, retained keyboard focus, and `DONE EXC:0`. The final gameplay
capture reported `data-qa-caption-key="qa-voice"`, kind `speech`, exact text
`Only embers remain.`, and `DONE EXC:0 enemies:5 map:emberwood`.

The comparison is design evidence, not a delivery claim. Merge, CI, Pages, and
live smoke remain required before the bounded slice is called shipped.
