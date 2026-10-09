#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
need_root
"${COMPOSE[@]}" run --rm runner postal make-user
