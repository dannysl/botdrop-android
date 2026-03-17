#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  local path=$1
  local expected=$2
  grep -F -- "$expected" "$path" >/dev/null || fail "expected '$expected' in $path"
}

assert_workflow_bundles_openclaw() {
  local workflow_path=$1

  assert_contains "$workflow_path" "scripts/build-openclaw-bundle.sh"
  assert_contains "$workflow_path" "scripts/build-qqbot-plugin-bundle.sh"
  assert_contains "$workflow_path" "BOTDROP_BUNDLED_OPENCLAW_VERSION="
  assert_contains "$workflow_path" "BOTDROP_OPENCLAW_BUNDLE_TGZ="
  assert_contains "$workflow_path" "BOTDROP_QQBOT_PLUGIN_DIR="
}

assert_workflow_bundles_openclaw "$ROOT_DIR/.github/workflows/build-apk.yml"
assert_workflow_bundles_openclaw "$ROOT_DIR/.github/workflows/debug_build.yml"

echo "PASS: APK workflows build and export offline OpenClaw bundle inputs"
