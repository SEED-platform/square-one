#!/usr/bin/env bash
# Launch the Flask backend and the Angular frontend together for local development, with each
# server's log lines labeled/colored ([API] / [WEB]) so it's clear which process produced which
# line of output.
#
# Usage:
#   ./dev.sh
#
# Stops both servers on Ctrl+C (or if either one exits/crashes).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

# Only use color codes when stdout is an interactive terminal (avoids raw escape codes leaking
# into log files/CI output when make dev's output is redirected).
if [[ -t 1 ]]; then
    API_COLOR=$'\033[36m' # cyan
    WEB_COLOR=$'\033[35m' # magenta
    RESET_COLOR=$'\033[0m'
else
    API_COLOR=""
    WEB_COLOR=""
    RESET_COLOR=""
fi

# Prefix every line of stdin with a colored "[label] " tag, line-buffered so output shows up
# immediately instead of only once the pipe buffer fills.
label_output() {
    local label="$1" color="$2"
    sed -u "s/^/${color}[${label}]${RESET_COLOR} /"
}

cleanup() {
    echo
    echo "Stopping dev servers..."
    [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
    [[ -n "${WEB_PID:-}" ]] && kill "$WEB_PID" 2>/dev/null || true
    wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting Flask backend on http://localhost:5001 ..."
(
    cd flask_app
    poetry run python app.py 2>&1 | label_output "API" "$API_COLOR"
) &
API_PID=$!

echo "Starting Angular frontend on http://localhost:4201 ..."
(
    cd angular-app
    # Use the Node version pinned in .nvmrc if nvm is available, so the
    # correct Angular CLI-compatible runtime is used regardless of the shell's
    # default/active Node version.
    if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
        # shellcheck disable=SC1091
        source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
        nvm use --silent >/dev/null 2>&1 || true
    fi
    npm start 2>&1 | label_output "WEB" "$WEB_COLOR"
) &
WEB_PID=$!

wait "$API_PID" "$WEB_PID"
