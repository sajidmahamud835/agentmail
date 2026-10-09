#!/usr/bin/env bash
set -Eeuo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
need_root
[[ $(uname -s) == Linux ]] || fail 'Use a dedicated Ubuntu 24.04 x86_64 server.'
[[ $(uname -m) == x86_64 ]] || fail 'This release is validated for x86_64 only.'
# shellcheck disable=SC1091
source /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 ]] || fail 'Installer supports Ubuntu 24.04 LTS.'
[[ -f .env ]] || fail 'Copy .env.example to .env and set the hostname, email and IPv4 address.'
[[ $ROOT =~ ^/[a-zA-Z0-9_./-]+$ ]] || fail 'Install in a path without spaces, such as /opt/agentpost.'
lock_operation
apt-get update
apt-get install -y ca-certificates curl openssl dnsutils netcat-openbsd restic jq
if ! command -v docker >/dev/null; then
  for package in docker.io podman-docker containerd runc; do
    if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed'; then
      fail "Conflicting package $package exists. Use a clean server or install Docker Engine manually."
    fi
  done
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
docker compose version >/dev/null || fail 'Docker Compose plugin is required.'
systemctl enable --now docker
docker info >/dev/null
if [[ ! -f runtime/initialized ]]; then
  for port in 25 80 443 3306 5000 8025 9090 9091 2019; do
    if ss -H -ltn "sport = :$port" | grep -q .; then fail "Port $port is occupied. Use a dedicated server."; fi
  done
fi
docker pull "$NODE_IMAGE"
config configure
hostname=$(config get MAIL_HOSTNAME)
ip=$(config get PUBLIC_IPV4)
[[ $hostname != *.example.com && $ip != 203.0.113.* ]] || fail 'Replace example configuration with real values.'
printf '\nChecking public DNS for %s...\n' "$hostname"
dig +short A "$hostname" | grep -Fxq "$ip" || fail 'Hostname A record must point to PUBLIC_IPV4 before installation.'
if [[ -n $(dig +short AAAA "$hostname") ]]; then fail 'Remove the hostname AAAA record for this IPv4-only deployment.'; fi
if ! nc -z -w 8 gmail-smtp-in.l.google.com 25; then
  fail 'Outbound SMTP connection failed. Confirm provider permits TCP port 25 and retry.'
fi
"${COMPOSE[@]}" config -q
"${COMPOSE[@]}" pull
"${COMPOSE[@]}" up -d --wait database
if [[ ! -f runtime/initialized ]]; then
  "${COMPOSE[@]}" run --rm runner postal initialize
  touch runtime/initialized
fi
"${COMPOSE[@]}" up -d web worker inbox caddy
printf '\nWaiting up to three minutes for HTTPS. Ports 80 and 443 must be reachable.\n'
ready=false
for ((attempt=0; attempt<36; attempt++)); do
  if curl --connect-timeout 3 --max-time 5 -fsS "https://$hostname/login" >/dev/null; then ready=true; break; fi
  sleep 5
done
[[ $ready == true ]] || fail 'HTTPS not ready. Inspect docker compose logs caddy web; fix DNS/firewall and rerun.'
bash scripts/sync-tls.sh --locked
"${COMPOSE[@]}" up -d smtp
bash scripts/install-timers.sh
printf '\nDashboard: https://%s\nCreate an administrator: sudo bash scripts/admin.sh\nDNS setup: docs/dns.md\n' "$hostname"
bash scripts/status.sh
