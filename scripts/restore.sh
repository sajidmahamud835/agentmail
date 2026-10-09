#!/usr/bin/env bash
set -Eeuo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
need_root
[[ $# -eq 2 && $2 == --fresh-server ]] || fail 'Usage: restore.sh /absolute/path/to/backup-stage --fresh-server'
bundle=$(realpath -- "$1")
[[ -f $bundle/database.sql && -f $bundle/config/environment && -f $bundle/commit ]] || fail 'Incomplete backup bundle.'
[[ ! -e runtime/database && ! -e runtime/initialized && ! -e .env ]] || fail 'Restore only into a fresh checkout with no .env or database.'
lock_operation
[[ $(git rev-parse HEAD) == "$(cat "$bundle/commit")" ]] || fail 'Check out the commit recorded in the backup before restoring.'
install -m 600 "$bundle/config/environment" .env
# Recover the matching deployment configuration; database image changes require a migration.
cp "$bundle/config/compose.yaml" compose.yaml
mkdir -p runtime
cp -a "$bundle/config/postal" runtime/
cp -a "$bundle/config/inbox-config" runtime/
cp -a "$bundle/config/database-init" runtime/
cp -a "$bundle/inbox" runtime/inbox
docker pull "$NODE_IMAGE"
config configure
cp "$bundle/config/Caddyfile" runtime/Caddyfile
"${COMPOSE[@]}" up -d --wait database
# The password is expanded inside the database container.
# shellcheck disable=SC2016
"${COMPOSE[@]}" exec -T database sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" mariadb -uroot' < "$bundle/database.sql"
touch runtime/initialized
"${COMPOSE[@]}" up -d web worker inbox caddy smtp
bash scripts/install-timers.sh
printf 'Restore completed. Verify DNS, HTTPS, SMTP TLS and inboxes before resuming agents.\n'
