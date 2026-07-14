# First Light audio-accessibility visual evidence

Captured at the same 1280×720 deterministic Settings state with reduced motion,
keyboard focus, 130% Combat HUD size, and High Contrast enabled.

## Snapshot identity

- Source: deployed `main` at `2183059370110629444da68fae65167ad9ff95bd`.
- Feature snapshot: commit `8fef031d2e078a716c19f21f4f1cb2cffc95ec76`.
- Browser/viewport: Codex in-app Browser, 1280×720 CSS pixels.
- Settings query: `tools/artshot/harness.html?seconds=0&screen=menu&tab=settings&settingspane=accessibility&uiscale=130&contrast=1&input=keyboard&focus=setUiScale%3A130%230&reduced=1`.
- Caption query: `tools/artshot/harness.html?seconds=5&captions=1&captiondetail=essential&caption=voice&reduced=1&badge=1`.

- `accessibility-before.png` — deployed `main` before the feature snapshot.
- `accessibility-after.png` — the shipped feature snapshot with captions, caption detail, mono
  audio, and vibration controls added in the existing menu language.
- `accessibility-comparison.png` — source and feature snapshot shown together at the
  same state for visual review.
- `gameplay-caption.png` — production gameplay HUD with the independent spoken
  caption lane. Harness receipt: `qa-voice`, `speech`, `EXC:0`.

The Settings captures reported `data-qa-ready="1"`, Accessibility pane, 130% HUD,
High Contrast `true`, retained keyboard focus, and `DONE EXC:0`. The final gameplay
capture reported `data-qa-caption-key="qa-voice"`, kind `speech`, exact text
`Only embers remain.`, and `DONE EXC:0 enemies:5 map:emberwood`.

The bounded slice shipped through [PR #190](https://github.com/QemmHD/2dgamerepo/pull/190)
as main `bed6ac5443e651a61ec90449673db4a967e9abef`. PR CI `29330155481`, main CI
`29330244561`, Pages `29330244572`, and deployed cold-boot Settings, exact gameplay
caption, and five-control `?dev=1` smoke passed. These captures prove the named web
states; they do not close the remaining physical-device, zoom, or assistive-technology
gates for A11-10/full 1.1.
