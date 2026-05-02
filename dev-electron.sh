#!/usr/bin/env bash
# ── RealVerdict Electron dev launcher ────────────────────────────────────────
# Safe one-command startup: kills any leftover processes, starts Next.js,
# waits until port 3000 is ready, then launches Electron.
#
# Usage:  ./dev-electron.sh
#         npm run dev:electron   (alias in package.json)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

# ── 1. Kill any leftover dev processes ───────────────────────────────────────
echo "⏹  Stopping any running dev processes…"
pkill -f "electron \." 2>/dev/null || true
pkill -f "next dev"   2>/dev/null || true
# Give OS a moment to release ports
sleep 1

# ── 2. Start Next.js in the background ───────────────────────────────────────
echo "🚀  Starting Next.js…"
cd "$ROOT"
npm run dev &
NEXT_PID=$!

# Kill Next.js if this script is interrupted (Ctrl+C)
trap 'echo ""; echo "⏹  Shutting down…"; kill $NEXT_PID 2>/dev/null; pkill -f "electron \." 2>/dev/null; exit 0' INT TERM

# ── 3. Wait for port 3000 to be ready ────────────────────────────────────────
echo "⏳  Waiting for localhost:3000…"
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000 > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

# Extra half-second so Next.js has finished route compilation
sleep 0.5
echo "✅  Next.js ready"

# ── 4. Launch Electron ───────────────────────────────────────────────────────
echo "🖥   Launching Electron…"
cd "$ROOT/electron-app"
npm run dev

# When Electron exits, clean up Next.js too
kill $NEXT_PID 2>/dev/null || true
echo "✅  Done"
