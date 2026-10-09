#!/usr/bin/env bash
# One-line installer for macOS:  curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/install/get.sh | bash
# Downloads JobSquad to ~/JobSquad-kit and starts the guided setup.
set -euo pipefail
REPO="${JOBSQUAD_REPO:-celiksuakd/openclaw-job-agents}"
BRANCH="${JOBSQUAD_BRANCH:-main}"
DEST="${JOBSQUAD_KIT:-$HOME/JobSquad-kit}"
TMP="$(mktemp -d)"
echo "Downloading JobSquad…"
curl -fsSL "https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz" | tar -xz -C "$TMP"
rm -rf "$DEST"
mv "$TMP"/*-"$BRANCH" "$DEST"
rm -rf "$TMP"
exec "$DEST/install/install.sh" --wizard "$@" </dev/tty
