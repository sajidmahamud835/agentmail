#!/usr/bin/env bash
set -Eeuo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
need_root
problem=''
curl --max-time 5 -fsS http://127.0.0.1:5000/login >/dev/null || problem+=' dashboard'
for port in 8025 9090 9091; do
  curl --max-time 5 -fsS "http://127.0.0.1:$port/health" >/dev/null || problem+=" service-$port"
done
nc -z -w 3 127.0.0.1 25 || problem+=' smtp'
usage=$(df --output=pcent "$ROOT" | tail -1 | tr -dc '0-9')
[[ $usage -lt 85 ]] || problem+=' disk-above-85-percent'
openssl x509 -in runtime/postal/smtp.cert -checkend 604800 -noout >/dev/null 2>&1 || problem+=' smtp-certificate'
if [[ -f /etc/agentmail/backup.env ]]; then
  if [[ ! -f runtime/last-backup-ok ]] || [[ $(( $(date +%s) - $(stat -c %Y runtime/last-backup-ok) )) -gt 172800 ]]; then problem+=' backup-overdue'; fi
fi
if [[ -n $problem ]]; then
  logger -t agentmail "Health check failed:$problem"
  # Optional operator-owned executable (e.g. send an alert to an external monitor).
  if [[ -x /etc/agentmail/alert ]]; then /etc/agentmail/alert "$problem"; fi
  fail "Health check failed:$problem"
fi
logger -t agentmail 'Health check passed'
