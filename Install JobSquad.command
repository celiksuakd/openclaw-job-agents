#!/bin/bash
# Double-click this file in Finder to set up JobSquad on this Mac.
# (First time: right-click it → Open → Open, because it was downloaded from the internet.)
cd "$(dirname "$0")" || exit 1
clear
xattr -dr com.apple.quarantine . 2>/dev/null
./install/install.sh --wizard "$@"
status=$?
echo
if [ $status -eq 0 ]; then echo "You can close this window."; else echo "Setup didn't finish. Scroll up to see why, then double-click Install JobSquad again."; fi
read -n 1 -s -r -p "Press any key to close…"
