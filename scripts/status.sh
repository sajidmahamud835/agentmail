#!/usr/bin/env bash
set -Eeuo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
need_root
"${COMPOSE[@]}" ps
printf '\nStorage\n'
df -h "$ROOT"
printf '\nAgent inbox\n'
curl --max-time 5 -fsS http://127.0.0.1:8025/health
printf '\nSMTP certificate\n'
if [[ -f runtime/postal/smtp.cert ]]; then openssl x509 -in runtime/postal/smtp.cert -noout -enddate; fi
printf '\nBackup status\n'
if [[ -f runtime/last-backup-ok ]]; then stat -c '%y' runtime/last-backup-ok; else printf 'No successful backup recorded.\n'; fi
