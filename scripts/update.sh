#!/usr/bin/env bash
set -Eeuo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
need_root
[[ $# -eq 1 ]] || fail 'Usage: update.sh <reviewed-git-tag-or-commit>'
[[ -z $(git status --porcelain) ]] || fail 'Commit or remove local source changes before updating.'
target=$(git rev-parse --verify "$1^{commit}")
# Back up the current source revision and database before changing either.
bash scripts/backup.sh
lock_operation
previous=$(git rev-parse HEAD)
printf '%s\n' "$previous" > runtime/pre-update-commit
"${COMPOSE[@]}" stop -t 60 web worker smtp inbox
git checkout --detach "$target"
printf 'Updating %s -> %s\n' "$previous" "$target"
config configure
"${COMPOSE[@]}" pull
"${COMPOSE[@]}" up -d --wait database
"${COMPOSE[@]}" run --rm runner postal upgrade
"${COMPOSE[@]}" up -d
bash scripts/status.sh
printf 'Update complete. Database downgrades require restoring the pre-update backup.\n'
