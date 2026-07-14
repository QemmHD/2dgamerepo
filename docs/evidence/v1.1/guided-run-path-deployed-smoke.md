# Guided Run Path post-deploy smoke

This receipt records the 2026-07-14 post-deploy verification of
[PR #196](https://github.com/QemmHD/2dgamerepo/pull/196), squash-merged as main
[`5abd6fd`](https://github.com/QemmHD/2dgamerepo/commit/5abd6fd1e0c5e06652a244951cb282d973a23f3c),
on [the public GitHub Pages build](https://qemmhd.github.io/2dgamerepo/).

## Deployed receipts

- Desktop, 1280×720: the production HUD rendered a current Climax Run Path card with
  complete action/progress/reward text and reported `DONE EXC:0`.
- Live boss phone, exact 667×375: the production `stormwingAlpha` fight retained the
  complete `edge` guidance rail and reported `DONE EXC:0`.
- Developer Settings: the deployed `?dev=1` General pane retained all five developer
  controls, visible keyboard focus, and reported `DONE EXC:0`.
- Browser logs were empty after all three states.
- A later cache-busted HTTP check returned 200 for the deployed index,
  `RunObjectiveDirector.js`, and `Game.js`; both source modules contained their shipped
  Run Path integration seams.

PR CI
[`29363043049`](https://github.com/QemmHD/2dgamerepo/actions/runs/29363043049),
main CI
[`29363172352`](https://github.com/QemmHD/2dgamerepo/actions/runs/29363172352),
and Pages
[`29363172362`](https://github.com/QemmHD/2dgamerepo/actions/runs/29363172362)
also passed. These receipts prove the named deployed web states. They do not prove a
manual screen-reader pass, a physical phone/tablet pass, zoom convergence, the
unfinished first-death debrief, or full 1.1/1.3/2.0 completion.
