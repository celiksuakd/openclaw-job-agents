#!/usr/bin/env bash
# JobSquad installer for macOS / Linux. All options are passed to setup.mjs (run with --help).
set -euo pipefail
KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pick_node() {
  for n in "${JOBSQUAD_NODE:-}" "$(command -v node 2>/dev/null || true)" "$HOME/.openclaw/tools/node/bin/node" "$HOME/.openclaw/tools/cli-node/bin/node"; do
    [ -n "$n" ] && [ -x "$n" ] || continue
    if "$n" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' 2>/dev/null; then
      echo "$n"; return 0
    fi
  done
  return 1
}

NODE="$(pick_node)" || {
  echo "No Node 22.13+ found. Install OpenClaw first (it brings Node):"
  echo "  curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install.sh | bash"
  echo "  openclaw onboard --install-daemon"
  exit 1
}
exec "$NODE" "$KIT/install/setup.mjs" "$@"
