# Migration PR1 semantic baselines

Audited main: `244fcd94d88f3ac1d25ae7e8a19acbab5c059cfc` (merged audit PR #207).
These records are the first baseline, not proof of parity with an older engine.
Production source is unchanged in this PR. Each JSON stores the shared fixture,
seed, exact tick clock, separate Node/browser receipts, viewport, screenshot
status, and limitations. Test-only configuration never enters a player save.

| Fixture | Ticks / scheduled seconds | Active game time | Observed result |
| --- | --- | --- | --- |
| normal-desktop | 600 / 10 | 10.000000000000076 | Pyra, Emberwood, Normal, Cinderbolt; 3 kills |
| combat-pack | 360 / 6 | 3.433333333333326 | Actual weapon/collision kills 2; real death and isolated settlement |
| boss-entry | 10320 / 172 | 171.23333333336174 | First fixed-roster boss Stormwing Alpha; warning tick 9646, spawn tick 9826 |
| touch-actions | 360 / 6 | 5.999999999999984 | Actual movement, 1 Blink, 1 between-tick Kindle quick-tap release |

Each fixture ran three times in fresh Node processes and three times in fresh
Chrome pages. Same-environment semantic receipts matched. Every Node fixture also
ran with seed `207002` instead of `207001`; enemy/HP/XP/kill state differed, not
merely the seed label. Node and browser are deliberately stored and checked as
separate environments. All final captures reported zero exceptions/rejections.

The boss fixture uses explicit test-only invulnerability and first legal modal
choices. It preserves the director's actual 160-second warning gate, spawn
pipeline, phase-1 attacks, and provenance; no assignment to `game.time` or fake
boss construction. The touch fixture starts with enough Kindle charge to fire;
its later hold is unready and does **not** prove charged hold/focus/refund behavior.
The combat fixture reaches terminal settlement: zero eligible Battle Pass XP and
zero objective payout are observed. That is not positive-reward durability proof.

## Reproduce

From the repository root, with Node and Python available:

```sh
node tools/validate-migration-baseline.js
python -m http.server 8110 --bind 127.0.0.1
```

In another terminal, repeat the following capture for each scenario ID and each
repeat `1`, `2`, `3`, always using a **new** profile directory. Set `CHROME` to
the local Chrome executable. Use `844,390` for touch-actions, otherwise `1280,720`.

```sh
node tools/artshot/capture-harness.mjs --chrome="$CHROME" \
  --profile=__out/migration/normal-desktop-profile1 \
  --dom=__out/migration/normal-desktop-1.html \
  --screenshot=__out/migration/normal-desktop-1.png \
  --viewport=1280,720 --timeout=60000 \
  --url="http://127.0.0.1:8110/tools/artshot/migration-baseline.html?scenario=normal-desktop"
node tools/artshot/verify-migration-captures.mjs __out/migration
```

The Node validator compares all four committed Node baselines, then repeated
same-seed and changed-seed runs. The browser checker rejects failed/missing
receipts and checks three repeats against the committed browser baselines.
Do not regenerate evidence to conceal a failure: inspect the field-level diff,
explain any intended contract change, and review the updated baseline explicitly.

Screenshots were produced and visually inspected at the paths in the JSON files.
They are local ignored artifacts, **not** deterministic golden images. The
committed evidence is semantic JSON. Real asset loading is attempted in browser;
loader fallback, decode differences, fonts, GPU output and audio remain outside
this semantic guarantee. Keep the existing asset/hero/visual validators.

New baseline captures support landscape only. The untouched legacy harness was
also checked at 390x844 portrait and 844x390 landscape; real-device input latency,
trusted touch events, and OS rotation are not emulated by this adapter.

Recorded locally with Node 26.3.0 and Chrome on Windows. CI runs the permanent
Node fixture validator and all previous gates; browser baseline captures above
are documented local verification, not an added CI screenshot-golden gate.
