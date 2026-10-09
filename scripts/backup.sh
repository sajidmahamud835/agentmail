#!/usr/bin/env bash
set -Eeuo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
need_root
lock_operation
: "${RESTIC_REPOSITORY:?Set RESTIC_REPOSITORY (see docs/operations.md)}"
: "${RESTIC_PASSWORD_FILE:?Set RESTIC_PASSWORD_FILE outside the repository}"
restic snapshots >/dev/null
umask 077
stage="$ROOT/runtime/backup-stage"
mkdir -p "$stage"
# Rebuild the staging bundle so old SQLite WAL files cannot survive a new backup.
find "$stage" -mindepth 1 -delete
mkdir -p "$stage/config" "$stage/inbox"
running=$("${COMPOSE[@]}" ps --status running --services | grep -E '^(web|smtp|worker|inbox)$' || true)
resume() {
  if [[ -n $running ]]; then
    mapfile -t services <<< "$running"
    "${COMPOSE[@]}" start "${services[@]}"
  fi
}
trap resume EXIT
if [[ -n $running ]]; then
  mapfile -t services <<< "$running"
  "${COMPOSE[@]}" stop -t 60 "${services[@]}"
fi
# All writers are stopped. Credentials are expanded inside the container, not logged.
# shellcheck disable=SC2016
"${COMPOSE[@]}" exec -T database sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" mariadb-dump -uroot --all-databases --single-transaction --routines --events --triggers' > "$stage/database.sql"
cp .env "$stage/config/environment"
cp compose.yaml "$stage/config/compose.yaml"
cp -a runtime/postal "$stage/config/"
cp -a runtime/inbox-config "$stage/config/"
cp -a runtime/database-init "$stage/config/"
cp runtime/Caddyfile "$stage/config/Caddyfile"
cp -a runtime/inbox/. "$stage/inbox/"
git rev-parse HEAD > "$stage/commit"
date -u +%FT%TZ > "$stage/created-at"
resume
trap - EXIT
# Restic encrypts before uploading. No automatic deletion of recovery points.
restic backup --tag agentmail "$stage"
restic check
touch runtime/last-backup-ok
printf 'Encrypted backup completed. Restore instructions: docs/operations.md\n'
