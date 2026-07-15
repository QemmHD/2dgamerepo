# Collection Growth I-B phone correction — deployed reconciliation

This post-merge receipt closes the deployment identity left intentionally open by the
[PR #201 phone-correction receipt](collection-growth-ib-pr201-phone-correction.md).
It does not broaden that receipt's product claim or rewrite the historical
[PR #200 Collection Growth I-B delivery](collection-growth-ib-deployed-smoke.md).

## Shipped identity

- Feature head: `1322d3af42dd9c53a369cbc04b5994295270abb1`.
- Evidence-complete PR head: `f0d3099e900bd130dd39c15885d23ea549110e65`.
- Merged [PR #201](https://github.com/QemmHD/2dgamerepo/pull/201) as main
  [`45f6216`](https://github.com/QemmHD/2dgamerepo/commit/45f62160cc2446d92e8c8bde220c491d5074fb77).
- Accepted feature PR CI:
  [`29377897747`](https://github.com/QemmHD/2dgamerepo/actions/runs/29377897747),
  artifact
  [`8328580576`](https://github.com/QemmHD/2dgamerepo/actions/runs/29377897747/artifacts/8328580576).
- Evidence-complete PR CI:
  [`29378248121`](https://github.com/QemmHD/2dgamerepo/actions/runs/29378248121).
- Main CI:
  [`29378392323`](https://github.com/QemmHD/2dgamerepo/actions/runs/29378392323),
  main artifact
  [`8328741615`](https://github.com/QemmHD/2dgamerepo/actions/runs/29378392323/artifacts/8328741615).
- Pages:
  [`29378392313`](https://github.com/QemmHD/2dgamerepo/actions/runs/29378392313).
- PR, main CI, and Pages all completed successfully at their exact expected SHA/event.

## Main visual artifact

Main CI produced the same five production-harness states and passed their strict
receipt assertions. The two calibrated phone captures are exactly 667x375; the three
desktop captures are exactly 1600x900. Pixel-gate results and SHA-256 values are:

| Main artifact frame | Pixel gate | SHA-256 |
| --- | --- | --- |
| `collection-fur-page2-desktop.png` | 1600x900; 92.59% visible; 33+ colors; luma 1-255 | `86446d4317c4fefde3bf7091ea89f20e14757e3be061a65c741b116a51cbe064` |
| `collection-fur-page2-phone.png` | 667x375; 93.99% visible; 33+ colors; luma 1-255 | `5f1826475cfb4fe617a9fc263439c2c251c3056f5ca7b733d1122c1f3797c496` |
| `character-hero-rites-phone.png` | 667x375; 93.98% visible; 33+ colors; luma 1-255 | `3b530893a47e7711768d02e6bc50ee367ae43cabe3497a5eea61f1174333a14e` |
| `boutique-stormglass.png` | 1600x900; 92.39% visible; 33+ colors; luma 1-255 | `14ed06fcf861c26e8f1f2dc133d1c8c9abb0ec10b04bc3064de217700b1b8fb5` |
| `boutique-gravebell.png` | 1600x900; 92.41% visible; 33+ colors; luma 1-255 | `e8ed34567eca9db9a14550d911a3884336591addc8274ea2828cc915cdc8528a` |

The main phone Collection and Hero Rites frames were compared at original resolution
against the accepted PR frames. Animation timing changed hashes, but layout, content,
safe-area geometry, visible `BACK` label, semantic state, and touch receipts matched.
No clipping, overlap, detached layer, false route, or staged-state contradiction was
found. The durable human-reviewable PR frames remain indexed in
[`README.md`](README.md).

## Deployed source smoke

At `2026-07-15T00:18:20Z`-`2026-07-15T00:18:21Z`, cache-busted requests against
<https://qemmhd.github.io/2dgamerepo/> returned HTTP 200 for the index and five shipped
source/harness seams. The index and harness were `text/html`; modules were
`application/javascript`; all expected markers were present:

- `src/systems/ResponsiveLayout.js` — `isPhoneLandscapeViewport`;
- `src/systems/SaveSystem.js` — `getDiscoveredRelics().includes(id)`;
- `src/systems/MenuRenderer.js` — `characterPhonePane`;
- `src/core/Game.js` — the shared `ResponsiveLayout.js` import;
- `tools/artshot/harness.html` — strict `characterpane` receipt input.

The production index retained its EMBERWAKE marker. `?dev=1` remains a session-only
entry to the existing gated Settings QA controls; it does not grant campaign,
collection, objective, or relic progress merely by opening the URL.

## Exact shipped boundary

Main `45f6216` ships syntax **170/170**, validators **25/25**, and **198,687**
integrated assertions: Collection **10,249**; attachments **7,332** across 162
frames/810 points; progression **5,865**; Run Path **93,139**; HUD **14,001** across
180 scenarios; gambling **644** with the unchanged 93% theoretical Mines return;
accessibility **310**; and UX **109**.

The shipped slice is the phone Collection/Hero Rites presentation and relic-authority
correction described in the PR receipt. It changes no schema, price, power, case odds,
pity, duplicate behavior, Mines stake/return, Battle Pass/achievement reward, or
developer-control contract. Physical-device, assistive-technology, 200% zoom,
portrait/tablet, Collection Completion Truth, complete Collection Growth I, full
1.1/1.6, 2.0, and 2.8 remain open.
