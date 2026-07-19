#!/usr/bin/env bash
# E2E test: screen sharing from a machine without a camera must not show a black screen.
#
# Spins up the real Go SFU and the vite dev server, then runs
# e2e/no-camera-screenshare.html in headless Chrome. The page drives two real
# groupCallService instances through the production signaling path and passes only
# if the viewer actually decodes video frames of the share.
#
# Usage: bash client/e2e/run.sh   (or: npm run test:e2e from client/)
# Env:   SFU_PORT (default 18081), VITE_PORT (default 13999), CHROME_BIN (default google-chrome)

set -u

CLIENT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_DIR="$(cd "$CLIENT_DIR/.." && pwd)"
SFU_PORT="${SFU_PORT:-18081}"
VITE_PORT="${VITE_PORT:-13999}"
CHROME_BIN="${CHROME_BIN:-google-chrome}"
WORK_DIR="$(mktemp -d)"

SFU_PID=""
VITE_PID=""
CHROME_PID=""

cleanup() {
  [ -n "$CHROME_PID" ] && kill "$CHROME_PID" 2>/dev/null
  [ -n "$VITE_PID" ] && kill "$VITE_PID" 2>/dev/null
  [ -n "$SFU_PID" ] && kill "$SFU_PID" 2>/dev/null
  wait 2>/dev/null
}
trap cleanup EXIT

fail() {
  echo "FAIL: $1"
  echo "--- logs kept in $WORK_DIR"
  exit 1
}

# vite requires Node >= 20.19; fall back to the newest nvm-installed node if needed.
NODE_MAJOR="$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/')"
if [ "${NODE_MAJOR:-0}" -lt 20 ] && [ -d "$HOME/.nvm/versions/node" ]; then
  NEWEST_NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/v*/bin 2>/dev/null | sort -V | tail -1)"
  if [ -n "$NEWEST_NODE_BIN" ]; then
    export PATH="$NEWEST_NODE_BIN:$PATH"
    echo "==> using node $(node -v) from $NEWEST_NODE_BIN"
  fi
fi

echo "==> building SFU"
(cd "$ROOT_DIR/server" && go build -o "$WORK_DIR/sfu" ./cmd/sfu) || fail "go build failed"

echo "==> starting SFU on :$SFU_PORT"
# The SFU refuses to start without JWT_SECRET (VYC-25); the page signs its
# test tokens with the same value via WebCrypto.
JWT_SECRET="e2e-test-secret" SFU_PORT="$SFU_PORT" "$WORK_DIR/sfu" >"$WORK_DIR/sfu.log" 2>&1 &
SFU_PID=$!
for _ in $(seq 1 60); do
  curl -sf "http://localhost:$SFU_PORT/health" >/dev/null 2>&1 && break
  kill -0 "$SFU_PID" 2>/dev/null || fail "SFU exited early, see $WORK_DIR/sfu.log"
  sleep 0.5
done
curl -sf "http://localhost:$SFU_PORT/health" >/dev/null 2>&1 || fail "SFU did not become healthy"

echo "==> starting vite dev server on :$VITE_PORT"
(cd "$CLIENT_DIR" && VITE_SFU_URL="ws://localhost:$SFU_PORT" \
  ./node_modules/.bin/vite --port "$VITE_PORT" --strictPort >"$WORK_DIR/vite.log" 2>&1) &
VITE_PID=$!
PAGE_URL="http://localhost:$VITE_PORT/e2e/no-camera-screenshare.html"
for _ in $(seq 1 60); do
  curl -sf "$PAGE_URL" >/dev/null 2>&1 && break
  kill -0 "$VITE_PID" 2>/dev/null || fail "vite exited early, see $WORK_DIR/vite.log"
  sleep 0.5
done
curl -sf "$PAGE_URL" >/dev/null 2>&1 || fail "vite did not serve the test page"

# Запускает один сценарий: страница обязана напечатать "E2E_RESULT {json}".
# E2E_ONLY=<имя> — прогнать только один сценарий.
run_scenario() {
  local name="$1"
  local page_url="$2"
  local log_file="$WORK_DIR/chrome-$name.log"
  if [ -n "${E2E_ONLY:-}" ] && [ "$E2E_ONLY" != "$name" ]; then
    echo "==> skipping scenario $name (E2E_ONLY=$E2E_ONLY)"
    return 0
  fi

  echo "==> running headless Chrome: $name"
  "$CHROME_BIN" \
    --headless=new \
    --no-sandbox \
    --disable-gpu \
    --autoplay-policy=no-user-gesture-required \
    --enable-logging=stderr \
    --user-data-dir="$WORK_DIR/chrome-profile-$name" \
    "$page_url" >"$log_file" 2>&1 &
  CHROME_PID=$!

  # The page prints one "E2E_RESULT {json}" line; poll for it (page watchdog: 90s).
  local result=""
  for _ in $(seq 1 220); do
    result="$(grep -o 'E2E_RESULT .*' "$log_file" 2>/dev/null | head -1)"
    [ -n "$result" ] && break
    kill -0 "$CHROME_PID" 2>/dev/null || break
    sleep 0.5
  done

  kill "$CHROME_PID" 2>/dev/null
  CHROME_PID=""

  [ -n "$result" ] || fail "$name: no E2E_RESULT in chrome output, see $log_file"

  # Strip prefix and the console-log quoting artifacts around the JSON.
  local json="${result#E2E_RESULT }"
  json="${json%\", source:*}"
  echo "==> $name result: $json"

  if echo "$json" | grep -q '"pass":true'; then
    echo "PASS: $name"
  else
    echo "--- [E2E] progress lines ($name):"
    grep -o '\[E2E\].*' "$log_file" | head -40
    fail "$name failed (full logs in $WORK_DIR)"
  fi
}

run_scenario "no-camera-screenshare" "$PAGE_URL"
run_scenario "nc-toggle" "http://localhost:$VITE_PORT/e2e/nc-toggle.html"

echo "PASS"
exit 0
