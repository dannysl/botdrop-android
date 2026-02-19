#!/data/data/app.botdrop/files/usr/bin/bash
# fix-koffi.sh - Replace koffi native module with mock for Android/Termux
#
# koffi doesn't ship a prebuilt binary for android_arm64, causing openclaw
# gateway to crash on startup. This script replaces koffi's index.js with
# a minimal mock that satisfies the import without loading any native code.

set -euo pipefail

KOFFI_DIR="/data/data/app.botdrop/files/usr/lib/node_modules/openclaw/node_modules/koffi"
KOFFI_INDEX="${KOFFI_DIR}/index.js"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "${KOFFI_INDEX}" ]; then
    echo "ERROR: koffi index.js not found at ${KOFFI_INDEX}"
    exit 1
fi

# Backup original if not already backed up
if [ ! -f "${KOFFI_INDEX}.orig" ]; then
    cp "${KOFFI_INDEX}" "${KOFFI_INDEX}.orig"
    echo "Backed up original to ${KOFFI_INDEX}.orig"
fi

# Apply mock
cp "${SCRIPT_DIR}/koffi-mock.js" "${KOFFI_INDEX}"
echo "Applied koffi mock to ${KOFFI_INDEX}"
