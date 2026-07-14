# Emberwake 1.0.2 visual evidence

These 1280×720 after-state captures come from the repository's deterministic
browser harness on the exact pre-PR working tree. The menu comparison also embeds
the matching `9bb1ca2` baseline. They are review evidence, not substitutes for
validators or the still-pending 1.0.2 deployed-main smoke.

| Gate | Evidence | What is visible |
| --- | --- | --- |
| Menu clarity/color | [menu-clarity-comparison.jpg](menu-clarity-comparison.jpg) | Same fresh-save state and viewport before/after the restrained accent and plain-language pass. |
| Direct site reward | [living-vigil-reward.jpg](living-vigil-reward.jpg) | Ashen Archive interaction, direct XP receipt, Living Vigil HUD, and `EXC:0`. |
| Beacon completion | [living-vigil-beacon-clear.jpg](living-vigil-beacon-clear.jpg) | Full guardian-pack clear, bundle receipt, tracker progress, and `EXC:0`. |
| Battle Pass arithmetic | [battle-pass-waylight-included.jpg](battle-pass-waylight-included.jpg) | `+932 XP` reconciles to the visible additive buckets; `Waylight 84 included` is explicitly inside Deeds. |
| Mines transparency | [mines-transparent-quote.jpg](mines-transparent-quote.jpg) | Fixed stake, exact next-pick odds, current cashout/net/max loss, and honest `ABOUT 7% HOUSE EDGE` copy. |

Reproduction states:

- Battle Pass: `tools/artshot/harness.html?screen=menu&tab=battlepass&bpxp=4780&bpclaimthrough=8&bpreceipt=1`
- Mines: `tools/artshot/harness.html?screen=menu&tab=shop&mines=250&minessafe=3`
- Living Vigil: `vigilSite` and `vigilBeaconCleared` are in the CI matrix; the harness also exposes `vigilBeacon` for the live challenge state.
