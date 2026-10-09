#!/usr/bin/env bash
# shellcheck shell=bash
set -Eeuo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
export ROOT
cd "$ROOT"
COMPOSE=(docker compose --project-directory "$ROOT" --env-file "$ROOT/.env" -f "$ROOT/compose.yaml")
NODE_IMAGE=node:22.23.3-bookworm-slim
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
need_root() { [[ $EUID -eq 0 ]] || fail 'Run with sudo.'; }
config() {
  docker run --rm --network none -v "$ROOT:/work" -w /work -e AGENTPOST_ROOT=/work "$NODE_IMAGE" node scripts/configure.mjs "$@"
}
lock_operation() {
  mkdir -p "$ROOT/runtime"
  exec 9>"$ROOT/runtime/operation.lock"
  flock -n 9 || fail 'Another maintenance operation is running.'
}
