# artshot — headless screenshot harness

Dev tooling for the higgsfield AI-art loop. **Not deployed** (GitHub Pages ships
`src/` only). It boots the real `Game.js` in headless Chromium, starts a run,
steps the sim to a chosen game-time, and renders one frame to a PNG so the
current in-game look can be captured, sent to Nano Banana 2 for an improved
redraw (image-to-image), and iterated on.

## Why it exists

- Capturing a *live* gameplay frame (swarm, lighting, real sprites/textures) is
  the honest "before" for the improve loop — not a mocked scene.
- The CDP/remote-debugging path hangs in this environment (socket-family error),
  so we drive the game via a tiny in-page harness + `--screenshot` instead.

## Usage

```sh
# 1) serve the repo ROOT with correct MIME types (ES modules + woff2)
python3 tools/artshot/serve.py 8099 .

# 2) screenshot a live gameplay frame (~35s in, real swarm)
CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
"$CHROME" --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
  --mute-audio --autoplay-policy=no-user-gesture-required \
  --no-first-run --no-default-browser-check --disable-extensions \
  --disable-background-networking --disable-component-update --disable-sync \
  --safebrowsing-disable-auto-update --disable-client-side-phishing-detection \
  --disable-features=Translate,BackgroundNetworking,OptimizationHints \
  --metrics-recording-only \
  --force-device-scale-factor=1 --window-size=1600,900 --virtual-time-budget=12000 \
  --user-data-dir="$(mktemp -d)" --screenshot=out.png \
  "http://127.0.0.1:8099/tools/artshot/harness.html?seconds=35"
```

## Query params

| param     | default | meaning                                                        |
|-----------|---------|----------------------------------------------------------------|
| `seconds` | `12`    | game-time to simulate before the shot (35 gives a real swarm)  |
| `badge`   | –       | `1` stamps an `EXC:<n>` exception-count badge top-left         |
| `screen`  | `run`   | `menu` shoots the main menu instead of a run                   |
| `tab`     | `play`  | menu tab when `screen=menu`                                     |
| `skipOnboarding` | `1` (forced) | the harness forces `1` (fresh profiles have `runs === 0`, which would arm the first-run hint pill over showcase shots); pass `0` to shoot the hints themselves |

## Notes

- **Audio is neutralized** in the harness (`window.AudioContext = undefined`): a
  live real-time `AudioContext` prevents `--virtual-time-budget` from
  fast-forwarding and the page hangs. `AudioSystem` no-ops cleanly without it.
- Stepping is **synchronous** (a tight `for` loop), not rAF-driven, so the
  virtual-time budget can't cut the run off mid-way. Paused overlays (level-up /
  chest / shrine) are auto-dismissed so the sim reaches a real swarm.
- The harness applies harness-only godmode (`player.damageTakenMul = 0`) so the
  hero survives the swarm long enough to render the frame. Nothing here ships.
- Always confirm `EXC: 0` (badge run) before shipping any art change.
