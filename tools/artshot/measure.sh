#!/usr/bin/env bash
# ENGINE_PROFILER_REPORT data-collection driver (dev tooling — NOT deployed).
#
# Drives the REAL GameLoop timing path in harness.html (?measure=<sec>) across the
# 8 report scenarios and writes one JSON summary per scenario to __out/. Chrome is
# launched in NEW headless WITHOUT --virtual-time-budget so performance.now() is
# real wall-time (virtual time would zero the measurements). The harness PUTs its
# result to serve.py's /__save/<out>.json; we just poll for the file.
#
# Also grabs a debug-HUD screenshot per scenario (GFXTIER + profiler panel visible)
# via the existing screenshot path (that path CAN use --virtual-time-budget).
#
# Usage:  tools/artshot/measure.sh [PORT]
# Output: __out/*.json (metrics) + __out/*.png (debug-HUD frames)
#
# NOTE: absolute FPS here is WORST-CASE — headless --disable-gpu is software raster,
# which inflates fill-rate-bound work (the lighting full-screen composite) ~50-100x
# vs a real GPU. The honest signal is the RELATIVE bucket breakdown + update-vs-
# render split + how costs scale with the graphics tier, not the absolute FPS.
set -u
PORT="${1:-8140}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHROME="${CHROME:-$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -1)}"
CUD="$(mktemp -d)"
HARNESS="http://127.0.0.1:$PORT/tools/artshot/harness.html"
WARMUP="${WARMUP:-120}"
WINDOW="${WINDOW:-240}"

cd "$ROOT"
rm -rf __out; mkdir -p __out
python3 tools/artshot/serve.py "$PORT" . > "$CUD/serve.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null; rm -rf "$CUD"' EXIT
sleep 1

CFLAGS=(--headless=new --no-sandbox --disable-gpu --hide-scrollbars --mute-audio
  --autoplay-policy=no-user-gesture-required --disable-background-networking
  --disable-component-update)

# run_measure <out> <window-size> <dpr> <extra-query>
run_measure() {
  local out="$1" wsize="$2" dpr="$3" extra="$4"
  local url="$HARNESS?measure=1&warmup=$WARMUP&window=$WINDOW&out=$out&$extra"
  echo ">> measure $out  ($wsize dpr=$dpr)  $extra"
  "$CHROME" "${CFLAGS[@]}" --force-device-scale-factor="$dpr" --window-size="$wsize" \
    --user-data-dir="$CUD/$out" "$url" > "$CUD/$out.log" 2>&1 &
  local pid=$!
  local n=0
  until [ -f "__out/$out.json" ] || [ $n -ge 90 ]; do sleep 2; n=$((n+1)); done
  kill $pid 2>/dev/null
  if [ -f "__out/$out.json" ]; then
    echo "   ok ($((n*2))s): $(grep -E '"(fpsMedian|fpsAvg|renderMs|updateMs|exc)"' "__out/$out.json" | tr -d ' \n')"
  else
    echo "   FAIL (no json after $((n*2))s)"; tail -5 "$CUD/$out.log"
  fi
}

# screenshot <out> <window-size> <dpr> <extra-query>  (debug HUD, virtual-time ok)
run_shot() {
  local out="$1" wsize="$2" dpr="$3" extra="$4"
  local url="$HARNESS?seconds=45&badge=1&debughud=1&$extra"
  echo ">> shot    $out"
  "$CHROME" "${CFLAGS[@]}" --force-device-scale-factor="$dpr" --window-size="$wsize" \
    --virtual-time-budget=20000 --user-data-dir="$CUD/shot-$out" \
    --screenshot="__out/$out.png" "$url" > "$CUD/shot-$out.log" 2>&1
  [ -f "__out/$out.png" ] && echo "   ok" || echo "   FAIL"
}

echo "=== MEASUREMENTS ==="
# 1) Main menu idle
run_measure s1_menu           1600,900 1 "screen=menu"
# 2) Early normal run (~60s game-time)
run_measure s2_normal60       1600,900 1 "measure=60"
# 3) Dense enemy stress (~90s game-time + injected swarm)
run_measure s3_dense90        1600,900 1 "measure=90&dense=120"
# 4) Pickup-heavy (steady ~120 gems held on screen)
run_measure s4_pickups        1600,900 1 "measure=40&pickups=120"
# 5) Damage-number-heavy (steady ~120 numbers held)
run_measure s5_dmgnum         1600,900 1 "measure=40&dmgnum=120"
# 6) Boss warning + boss fight
run_measure s6_boss           1600,900 1 "measure=30&boss=1"
# 7) Tier 0/1/2/3 comparison — same dense load, forced governor tier
run_measure s7_tier0          1600,900 1 "measure=60&dense=80&gfxtier=0"
run_measure s7_tier1          1600,900 1 "measure=60&dense=80&gfxtier=1"
run_measure s7_tier2          1600,900 1 "measure=60&dense=80&gfxtier=2"
run_measure s7_tier3          1600,900 1 "measure=60&dense=80&gfxtier=3"
# 8) Mobile/touch viewport (portrait, DPR 3 like a modern phone)
run_measure s8_mobile         430,932  3 "measure=60"

echo "=== DEBUG-HUD SCREENSHOTS ==="
run_shot s2_normal60 1600,900 1 ""
run_shot s3_dense90  1600,900 1 "dense=120"
run_shot s6_boss     1600,900 1 "boss=1"
run_shot s7_tier0    1600,900 1 "dense=80&gfxtier=0"
run_shot s7_tier3    1600,900 1 "dense=80&gfxtier=3"
run_shot s8_mobile   430,932  3 ""

echo "=== DONE. Artifacts in __out/ ==="
ls -1 __out/
