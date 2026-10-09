#!/usr/bin/env bash
set -Eeuo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/../scripts/common.sh"
need_root
[[ ${AGENTMAIL_CI:-} == true ]] || fail 'Only run with AGENTMAIL_CI=true on a disposable Linux CI host.'
[[ ! -e .env && ! -e runtime/database ]] || fail 'Integration test requires a clean checkout.'
cp .env.example .env
node scripts/configure.mjs
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj '/CN=mail.example.com' \
  -keyout runtime/postal/smtp.key -out runtime/postal/smtp.cert >/dev/null 2>&1
chown 999:999 runtime/postal/smtp.key runtime/postal/smtp.cert
chmod 640 runtime/postal/smtp.key runtime/postal/smtp.cert
node scripts/configure.mjs tls-enable
node scripts/configure.mjs inbox add assistant assistant@inbound.example.com > runtime/smoke-inbox.json
# Use Caddy's private CA in CI; never contact a public ACME issuer for example domains.
sed -i '/^mail.example.com {/a\  tls internal' runtime/Caddyfile
"${COMPOSE[@]}" config -q
"${COMPOSE[@]}" pull
"${COMPOSE[@]}" up -d --wait database
"${COMPOSE[@]}" run --rm runner postal initialize
touch runtime/initialized
install -o 999 -g 999 -m 640 tests/fixtures/postal.rb runtime/postal/smoke.rb
"${COMPOSE[@]}" run --rm -e AGENTMAIL_CI=true runner bundle exec rails runner /config/smoke.rb > runtime/smoke-postal.txt
"${COMPOSE[@]}" up -d --wait web worker inbox smtp caddy
for port in 9090 9091; do
  curl --retry 20 --retry-connrefused --retry-delay 1 -fsS "http://127.0.0.1:$port/health" >/dev/null
done
curl --retry 20 --retry-connrefused --retry-delay 1 --resolve mail.example.com:443:127.0.0.1 -kfsS https://mail.example.com/login >/dev/null
[[ $(curl --resolve mail.example.com:443:127.0.0.1 -ks -o /dev/null -w '%{http_code}' https://mail.example.com/postal/inbound) == 404 ]]
node tests/smoke.mjs

export RESTIC_REPOSITORY="$RUNNER_TEMP/agentmail-restic"
export RESTIC_PASSWORD_FILE="$RUNNER_TEMP/agentmail-restic-password"
openssl rand -hex 32 > "$RESTIC_PASSWORD_FILE"
chmod 600 "$RESTIC_PASSWORD_FILE"
restic init
bash scripts/backup.sh
"${COMPOSE[@]}" restart inbox
curl --retry 20 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:8025/health >/dev/null
restic restore latest --target "$RUNNER_TEMP/recovery"
bundle="$RUNNER_TEMP/recovery$ROOT/runtime/backup-stage"
[[ -s $bundle/database.sql && -s $bundle/inbox/inbox.sqlite ]]
"${COMPOSE[@]}" down

# Restore into a different, empty checkout, exercising the real recovery script.
fresh="$RUNNER_TEMP/agentmail-restored"
git clone --no-hardlinks "$ROOT" "$fresh"
git -C "$fresh" checkout "$(cat "$bundle/commit")"
bash "$fresh/scripts/restore.sh" "$bundle" --fresh-server
for ((attempt=0; attempt<30; attempt++)); do
  if curl -fsS http://127.0.0.1:8025/health >/dev/null; then break; fi
  sleep 2
done
token=$(jq -r .token runtime/smoke-inbox.json)
curl -fsS -H "Authorization: Bearer $token" 'http://127.0.0.1:8025/agent-api/v1/messages?unacked=false' | \
  jq -e '.data | length == 1' >/dev/null
curl -fsS -H "Authorization: Bearer $token" 'http://127.0.0.1:8025/agent-api/v1/messages/1' | \
  jq -e '.acknowledged_at != null and .message.subject == "Integration inbound"' >/dev/null
docker compose --project-directory "$fresh" --env-file "$fresh/.env" -f "$fresh/compose.yaml" down
printf 'Encrypted backup and fresh-checkout restore passed.\n'
