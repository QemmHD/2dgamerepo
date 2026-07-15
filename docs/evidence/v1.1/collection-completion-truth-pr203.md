# Collection Completion Truth and protected-transaction candidate — PR #203

Status: **accepted feature candidate; not yet shipped**. This record must not be
rewritten as deployed evidence until PR #203 is merged, `main` CI and Pages pass, and
the cache-busted public build is smoked.

## Candidate identity

- Draft PR: [#203](https://github.com/QemmHD/2dgamerepo/pull/203)
- Current feature head: `35be07386d3c62443e4b799f8e5d52542b8fd04e`
- Final-head PR CI: [29386954424](https://github.com/QemmHD/2dgamerepo/actions/runs/29386954424)
- Final-head ten-frame artifact: [8331811265](https://github.com/QemmHD/2dgamerepo/actions/runs/29386954424/artifacts/8331811265)
- Final-head artifact ZIP SHA-256: `3d5015a12fb3f36704222281b5ce0f0020080c0cf9d0fa9613dee002345dc4db`
- Final-head artifact size: 4,379,285 bytes
- Accepted browser-visual head: `d0e471ba31d1b1768ee9876d9bada0a22091cd60`
- Accepted visual CI/artifact: [29386301430](https://github.com/QemmHD/2dgamerepo/actions/runs/29386301430) / [8331705612](https://github.com/QemmHD/2dgamerepo/actions/runs/29386301430/artifacts/8331705612)
- Accepted visual ZIP SHA-256 and size: `f2c782ae91d5ffa256b413bee1eae6fdcdaed9a49b550cb75ff3c21e04404dfd`, 4,376,904 bytes
- Review method: every PNG in both successful artifacts was opened at original
  resolution after its remote Chromium receipt gate passed. The hash-pinned files copied
  beside this record are the accepted visual set, so the evidence does not expire with
  the 30-day Actions artifact; the final-head set preserved the same required states.

## Bounded player contract

- Completion reports the authored **103 cosmetics**, **15 sets**, and category totals
  `fur 18 / cloak 20 / accessory 22 / aura 21 / trail 22` from the same catalog used by
  Collection, Boutique, cases, and live equipment.
- Fresh-profile truth is **13 owned**, **0 complete sets**, **85 with at least one known
  route**, and **18 random-only**. Source memberships are `starter 13`, `boutique 44`,
  `blueprint 2`, `case 61`, `achievement 19`, and `Vigil Path 10`; memberships overlap
  and therefore do not add to 103.
- `aura_gloam_moths` and `aura_requiem` are the only Mythic Blueprints. Each costs a
  fixed **72,000 earned coins**, equal to **80 Royal Cosmetic Case entry fees** at the
  unchanged 900-coin fee. These two named Mythics now have deterministic ceilings;
  Royal Cases remain random and unchanged.
- Blueprint purchase is an explicit two-press interaction. The first press arms a
  three-second confirmation and performs no debit, grant, claim, RNG call, or save. The
  second matching press resolves one whole-save transaction and publishes success only
  after its durable receipt.
- The Royal truth view keeps the authored economy visible: 59-item pool; item branch
  82%; coins 10.8%; Vigil XP 7.2%; Uncommon 40%, Rare 33%, Epic 18.5%, Legendary 7%,
  Mythic 1.5%; Royal Rare+ pity at 10 opens. Rare+ pity is explicitly **not** a Mythic
  guarantee. Before forging Requiem, its ordinary next-open target chance is 0.1537%
  from an eight-item Mythic selection pool.

## Persistence and transaction boundary

The save schema stays additive **v10**. `blueprintClaims` is a bounded, sanitized list;
old v0–v10 saves retain their prior data. The generic exclusive transaction builds a
detached draft, blocks storage/lifecycle escape hatches, performs one final authority
check/write, publishes an independently cloned commit candidate, and recursively freezes
the returned receipt. Failed or rejected mutations restore the exact prior root and
nested object identities.

Browser earned-coin and once-only flows now use that participant-exclusive, fail-closed
boundary:

- Mythic Blueprint purchases;
- coin-funded Case opening, pity/stat movement, RNG reward, unlock/duplicate conversion,
  and XP;
- Battle Pass single/claim-all rewards and Daily Road's free-case marker plus reward;
- permanent-upgrade and direct coin-cosmetic shop purchases;
- Mines stake plus hourly quota and once-only cash-out payout; terminal presentation
  changes only after durable success.

Duplicate taps cannot launch a second transaction or navigate into a run while one of
those secure menu writes is pending. Case reels, Mines boards/BANKED state, purchase
audio, and success copy appear only after durable success. Busy, stale, unavailable, or
failed writes remain retryable and do not present an uncommitted reward.

The boundary intentionally fails closed when the browser lacks the
[Web Locks API](https://www.w3.org/TR/web-locks/) or makes it unavailable. [WebKit's
Safari 17 notes](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/) state
that Safari Lockdown Mode can disable Web Locks, so the game reports secure saving as
unavailable instead of weakening an earned-coin or once-only write.

## Deterministic and browser proof

The final feature head passed **34/34 validators**, local syntax **183/183**, and the
complete remote Chromium matrix. The current numeric validator boundary is **201,775
checks**, including:

- Collection reachability 10,821; Completion truth 1,249; Completion flow 157;
  Blueprint purchase 291; attachment parity 7,332;
- Save transaction durability 340; Case transaction 93; Case exclusion 62; Case
  entitlement 59; Shop 70; Mines entry/cashout 137;
- progression 5,892; Guided Run Path 93,140; campaign 319; gambling 674 at the unchanged
  93% theoretical return;
- HUD 14,001/180; navigation 55,090; phone Settings 2,430; accessibility 310 plus 125
  save checks.

Remote Chromium used `tools/artshot/capture-harness.mjs` to wait for the game's own
`data-qa-ready` receipt through DevTools. This replaces virtual-time guessing: Web Lock
completion and the final PNG PUT must finish before the DOM is serialized. The full
four-biome/house/touch/focus/accessibility/status/menu/Mines matrix and all ten Completion
captures ended with the required `DONE EXC:0` final receipts.

## Durable visual receipts

| Receipt | Exact canvas | SHA-256 |
| --- | ---: | --- |
| [Overview desktop](completion-overview-desktop.png) | 1600×900 | `489E16FE11553E5E48A7415C62872EF8AF8AEA03C09EDB112275A49E9F296E00` |
| [Overview phone](completion-overview-phone.png) | 667×375 | `7826CD6EF5155C64FB39E0C0D7BADDE1DB89481E5E8936DF4ADF7FA792E445E9` |
| [Requiem desktop](completion-requiem-desktop.png) | 1600×900 | `2115BC25AEC961F61D7BA9964266DF151F03B1ADBFCE0F8E82DB34516F99464B` |
| [Requiem phone](completion-requiem-phone.png) | 667×375 | `0D35AEA97A124C300B8E97A68BBDD9423661AD581CC3991DE1F132F39A314FF0` |
| [Royal Case truth](completion-royal-case-truth.png) | 1600×900 | `AD701AA19C3D0E05519968F7E48CBCEE52CE23B5CCAF9147418C77BEE54E4B01` |
| [Requiem purchased](completion-requiem-purchased.png) | 667×375 | `4A915055799FF1E605264E62EC7E0223A90C796DB76E4EA7C23A7DE201E8226D` |
| [Overview compact](completion-overview-compact.png) | 480×270 | `016A95E8AF0518A767270F5BCE28612D3A001CF0797D105B319DE1817493A095` |
| [Sources compact](completion-sources-compact.png) | 480×270 | `55BAE3C0A4EA580ACB899C88CAF8ABA01908C2178A4F36661A6A18958BADCF9F` |
| [Requiem compact](completion-requiem-compact.png) | 480×270 | `6AF6FE0FCCFBCAF2D1690471E34240EB32630E593FCBD88FB246214C5E33FBB2` |
| [Case compact](completion-case-compact.png) | 480×270 | `8C28C42089564912116053DE76CB73646F381A96473BBA30E3622B4492013729` |

Manual review found the primary tabs, Back route, truth totals, price, wallet-after value,
case disclosures, and purchase action visible without overlap at all three tiers. The
667×375 post-purchase receipt deliberately truncates its long secondary receipt sentence,
while the authoritative 18/103, 1/15, 8,000-coin wallet, `OWNED`, and disabled equip-route
states remain visible. These are production-harness web receipts, not physical-device,
portrait, tablet, zoom, or assistive-technology acceptance.

## Unchanged scope and residual limitation

- No cosmetics, gear, maps, enemies, power, Battle Pass levels/reward values/XP formula,
  Case costs/odds/pity/unowned weighting, Mines stakes/board/math/quota, or 93% return
  changed. Cosmetics remain visual-only and all five `?dev=1` Settings controls remain.
- Ordinary synchronous writes use a compare-before-save stale-authority guard, not an
  atomic mutex; two simultaneous ordinary writers can still race. Earned-coin and
  once-only flows above no longer rely on that path; broader single-writer/
  transactional-storage work remains open.
- This candidate does **not** complete Collection Growth I, A11-13, full 1.1 or 1.6,
  full 1.2/Fair Forge, either 1.0→2.0/2.0→3.0 arc, 2.0, or 2.8. Merge, `main` CI,
  Pages, public source smoke, and deployed `?dev=1` retention are still required before
  this bounded slice may be called fully shipped.
