# First Light checkpoint — 2026-09-06

Status: **paused on `codex/first-light-lessons`; not merged or deployed.**

The user requested a stopping point, then a separate documentation-only Phaser
migration audit against latest main. Do not mix this branch's source changes into
that audit PR. Main at this checkpoint is `9ac5435` (PR #206).

## Implemented on this branch

- Twelve first-run lessons retain the original sequence and append successful
  Blink, Focus and Kindle use before the send-off. Early actions are retained;
  timeout is neutral deferral, never a success. Boss/lieutenant danger has priority.
- Actual auto-attacks, shard/coin pickups and committed upgrade/relic choices feed
  the director. Replay remains available; successful action totals are run-local.
- First-death debrief gives a fresh lethal source, one contextual tip, committed
  run coin and Pass XP receipts, and one 48-CSS-pixel Continue to Home action.
  The acknowledgment is durable; old saves are grandfathered; both keyboard and
  touch wait until the visible button is ready.
- Legacy lifetime coin accounting/economy remains unchanged. Banked receipts are
  separate, preserving caps, failed saves and once-only settlement.
- Mobile tutorial placement clears existing HUD controls. Touch ULT is now named
  KINDLE to match its teaching. Existing summary route now says RETURN HOME.
- The five historical House V2 reconciliation documents remain in this branch.
  Their July evidence is historical, not new-main acceptance.

## Verified locally

- Full pre-final-layout suite: 40/40 validators; 195/195 syntax files.
- Final targeted rerun: Onboarding 2,817; Run Debrief 239; First Light UI 12,076
  checks across 1,280 production-layout scenarios; UX 109 — all passed.
- Browser frames: new tutorial and crowd debrief at 667×375 CSS/DPR2 report EXC:0.
  Basic desktop debrief and phone fallback were inspected; source fixes after the
  first desktop frame require fresh full-matrix captures before release.
- `tools/artshot/first-light-scenarios.js` can stage Blink/Focus/Kindle instruction,
  success or deferral and real contact/crowd/projectile death via production calls.

## Resume / remaining release gates

1. Rerun all 41 validators and current syntax files after the final layout edits.
2. Capture instruction/success/deferral for all three verbs, desktop/667/844 phone,
   reduced-effects and safe-inset variants; review actual screenshots, not receipts
   alone. Include contact/crowd/projectile and unknown-cause debriefs and first-save,
   veteran, replay, acknowledgment/reload and complete tutorial-to-Run-Path flow.
3. Add these browser scenarios and retained images to hosted CI. Run the existing
   full browser matrix including `?dev=1`; do not relax existing acceptance gates.
4. Update the canonical ledger with this feature's own validation evidence; open
   a dedicated feature PR only when ready. Merge/deploy/public smoke are still open.

Local evidence is under ignored `__out/first-light-*.{png,html}`. Untracked
`artifacts/` belongs to the local workspace and must not be staged. No Phaser
dependency or migration implementation belongs in this checkpoint.
