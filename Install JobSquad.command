#!/bin/bash
# Double-click this file in Finder to set up JobSquad on this Mac.
# If macOS says it "could not verify" this file: click Done, then System Settings → Privacy & Security
# → "Open Anyway". Or skip the warning entirely with the Terminal one-liner in docs/MAC-START-HERE.md.
cd "$(dirname "$0")" || exit 1
clear
xattr -dr com.apple.quarantine . 2>/dev/null
./install/install.sh --wizard "$@"
status=$?
echo
if [ $status -eq 0 ]; then echo "You can close this window."; else echo "Setup didn't finish. Scroll up to see why, then double-click Install JobSquad again."; fi
read -n 1 -s -r -p "Press any key to close…"
