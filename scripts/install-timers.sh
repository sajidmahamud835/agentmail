#!/usr/bin/env bash
set -Eeuo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
need_root
[[ $ROOT =~ ^/[a-zA-Z0-9_./-]+$ ]] || fail 'Installation path must not contain spaces.'
install -d -m 0700 /etc/agentpost
for task in tls health backup; do
  case $task in
    tls) script=sync-tls.sh; schedule='*-*-* 00,06,12,18:00:00' ;;
    health) script=health.sh; schedule='*:0/5' ;;
    backup) script=backup.sh; schedule='*-*-* 03:00:00' ;;
  esac
  cat > "/etc/systemd/system/agentpost-$task.service" <<EOF
[Unit]
Description=AgentPost $task
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$ROOT
EnvironmentFile=-/etc/agentpost/backup.env
ExecStart=/usr/bin/bash $ROOT/scripts/$script
UMask=0077
EOF
  cat > "/etc/systemd/system/agentpost-$task.timer" <<EOF
[Unit]
Description=AgentPost scheduled $task

[Timer]
OnCalendar=$schedule
Persistent=true
RandomizedDelaySec=60

[Install]
WantedBy=timers.target
EOF
done
systemctl daemon-reload
systemctl enable --now agentpost-tls.timer agentpost-health.timer
if [[ -f /etc/agentpost/backup.env ]]; then
  systemctl enable --now agentpost-backup.timer
else
  printf 'Daily backup is not enabled yet. Configure /etc/agentpost/backup.env, then rerun this script.\n'
fi
