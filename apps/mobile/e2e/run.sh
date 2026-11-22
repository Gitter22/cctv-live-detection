#!/usr/bin/env bash
# Mobile E2E (Android emulator + Maestro), driven from WSL.
#
#   npm run e2e:mobile                   # app already installed on the emulator
#   npm run e2e:mobile -- path/to.apk    # install (or update) this APK first
#
# Needs: the compose stack up (server + edge profiles), a running Android emulator with a
# Google Play image, and Maestro on Windows (see docs/MOBILE.md "Automated tests").
# Maestro runs on the Windows side next to the emulator (WSL's NAT network can't reach the
# Windows adb server). Flows get test credentials by templating into a temp copy on the
# Windows drive, which is deleted at the end: passwords never appear on a command line.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
ADB="${ADB:-/mnt/d/Android/Sdk/platform-tools/adb.exe}"
MAESTRO_CMD="${MAESTRO_CMD:-D:\\Android\\maestro-run.cmd}"
WORK_WIN="${E2E_WORKDIR_WIN:-D:\\Android\\vigil-e2e}"
WORK="$(wslpath "$WORK_WIN")"
SERVER="${E2E_APP_SERVER:-http://10.0.2.2:5173}" # 10.0.2.2 = the PC, as seen from the emulator
APP_ID=dev.vigil.app
APK="${1:-}"

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
pass() { printf '\033[32mPASS\033[0m %s\n' "$*"; RESULTS+=("PASS  $*"); }
fail() { printf '\033[31mFAIL\033[0m %s\n' "$*"; RESULTS+=("FAIL  $*"); FAILED=1; }
RESULTS=()
FAILED=0

psql_q() { (cd "$ROOT" && docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At') <<<"$1"; }
inject() { (cd "$ROOT" && npm run -s e2e -w apps/server -- event "$@"); }

cleanup() { rm -rf "$WORK/flows"; }
trap cleanup EXIT

step "Emulator"
"$ADB" get-state >/dev/null 2>&1 || { echo "No emulator/device found by adb. Start the emulator first."; exit 1; }
echo "Android $("$ADB" shell getprop ro.build.version.release | tr -d '\r') on $("$ADB" shell getprop ro.product.model | tr -d '\r')"
if [[ -n "$APK" ]]; then
  step "Install $APK"
  "$ADB" install -r "$(wslpath -w "$(realpath "$APK")")" | tr -d '\r' | tail -1
fi
"$ADB" shell pm path "$APP_ID" >/dev/null 2>&1 || { echo "$APP_ID is not installed. Pass the APK path."; exit 1; }

step "Fresh fixtures"
(cd "$ROOT" && npm run -s e2e -w apps/server -- seed)
CREDS="$ROOT/data/e2e-credentials.json"
cred() { node -e "const c=require(process.argv[1]); console.log(process.argv[2].split('.').reduce((o,k)=>o[k],c))" "$CREDS" "$1"; }

# Template the flows into $WORK/flows/<run>/ with this run's values.
render() { # render <out-dir> KEY=VALUE...
  local out="$1"; shift
  mkdir -p "$out"
  python3 -I - "$ROOT/apps/mobile/e2e/flows" "$out" "$@" <<'PY'
import pathlib, sys
src, out, pairs = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3:]
values = dict(p.split('=', 1) for p in pairs)
for f in src.glob('*.yaml'):
    text = f.read_text()
    for k, v in values.items():
        text = text.replace('${' + k + '}', v)
    (out / f.name).write_text(text)
PY
}
mkdir -p "$WORK/screens"
maestro() { # maestro <run> <flow>; returns Maestro's exit code
  local log="$WORK/last-flow.log" rc=0
  (cd "$WORK/screens" && cmd.exe /c "$MAESTRO_CMD test --test-output-dir=${WORK_WIN}\\screens ${WORK_WIN}\\flows\\$1\\$2") >"$log" 2>&1 || rc=$?
  tr -d '\r' <"$log" | grep -vE '^\s*$' | tail -25 || true
  return "$rc"
}
run_flow() { # run_flow <run> <flow> <label>
  if maestro "$1" "$2"; then pass "$3"; else fail "$3"; fi
}

ORG="Acme Factory (E2E)"
TITLE="Person in gate · Main gate"
render "$WORK/flows/acme" SERVER="$SERVER" EMAIL="$(cred users.owner.email)" PASSWORD="$(cred users.owner.password)" \
  ORG_NAME="$ORG" SHOT="01-acme" ALERT_TITLE="$TITLE" CAMERA=gate-1 RULE="Person at the gate"

step "1. Sign in (owner of the demo org)"
run_flow acme 01-sign-in.yaml "sign in, notification permission, push registered"
OWNER_DEVICES=$(psql_q "select count(*) from push_devices d join users u on u.id=d.\"userId\" where u.email='$(cred users.owner.email)';")
[[ "$OWNER_DEVICES" == "1" ]] && pass "server has the emulator's push token for the owner" || fail "push token registered on the server (found $OWNER_DEVICES)"

step "2. Injected event -> alert in the list -> acknowledge, note, close"
inject gate-1 zone.enter gate
run_flow acme 02-alert-actions.yaml "alert appears in the app; ack, note, close"

step "3. Push notification while the app is in the background"
run_flow acme 03a-background.yaml "app sent to background"
inject gate-1 zone.enter gate
sleep 3
"$ADB" shell cmd statusbar expand-notifications
run_flow acme 03b-notification-tap.yaml "push arrives; tapping it opens the alert"

step "4. Live view on a site without an edge"
run_flow acme 04-live-offline.yaml "live view says the site is offline"

step "5. Sign out"
run_flow acme 05-sign-out.yaml "sign out returns to the sign-in screen"
OWNER_DEVICES=$(psql_q "select count(*) from push_devices d join users u on u.id=d.\"userId\" where u.email='$(cred users.owner.email)';")
[[ "$OWNER_DEVICES" == "0" ]] && pass "sign-out unregistered the push token" || fail "push token still registered after sign-out ($OWNER_DEVICES)"

if [[ "$(cred users.homeViewer.email 2>/dev/null || true)" == home-viewer@* ]]; then
  step "6. Real camera live view (home org viewer)"
  render "$WORK/flows/home" SERVER="$SERVER" EMAIL="$(cred users.homeViewer.email)" PASSWORD="$(cred users.homeViewer.password)" \
    ORG_NAME="Home" SHOT="06-home"
  run_flow home 01-sign-in.yaml "home viewer signs in"
  # Watch go2rtc for a WebRTC viewer while the flow plays the stream.
  PEAK="$WORK/webrtc-peak"; echo 0 >"$PEAK"
  ( set +e +o pipefail
    for _ in $(seq 1 40); do
      n=$( (curl -s http://localhost:1984/api/streams || true) | grep -o '"format_name":"webrtc[^"]*"' | wc -l || true)
      (( n > $(cat "$PEAK") )) && echo "$n" >"$PEAK"
      sleep 1
    done ) &
  POLLER=$!
  run_flow home 06-live-real.yaml "real camera live view opens"
  wait "$POLLER" 2>/dev/null || true
  [[ "$(cat "$PEAK")" -ge 1 ]] && pass "go2rtc served WebRTC to the app" || fail "no WebRTC viewer seen on go2rtc"
  run_flow home 05-sign-out.yaml "home viewer signs out"
fi

step "Results"
printf '%s\n' "${RESULTS[@]}"
echo "Screenshots: $WORK_WIN\\screens"
exit "$FAILED"
