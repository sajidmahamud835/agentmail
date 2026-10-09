#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
need_root
[[ ${1:-} == --locked ]] || lock_operation
hostname=$(config get MAIL_HOSTNAME)
cert=''
while IFS= read -r candidate; do
  if openssl x509 -in "$candidate" -noout -checkhost "$hostname" >/dev/null 2>&1 &&
     openssl x509 -in "$candidate" -noout -checkend 86400 >/dev/null 2>&1; then
    cert=$candidate
    break
  fi
done < <(find "$ROOT/runtime/caddy/data/caddy/certificates" -type f -name "$hostname.crt" 2>/dev/null)
[[ -n $cert && -f ${cert%.crt}.key ]] || fail 'No valid Caddy certificate found for SMTP.'
if cmp -s "$cert" runtime/postal/smtp.cert && cmp -s "${cert%.crt}.key" runtime/postal/smtp.key &&
   [[ $(config get SMTP_TLS_ENABLED) == true ]]; then exit 0; fi
install -o 999 -g 999 -m 0640 "$cert" runtime/postal/smtp.cert.new
install -o 999 -g 999 -m 0640 "${cert%.crt}.key" runtime/postal/smtp.key.new
mv runtime/postal/smtp.cert.new runtime/postal/smtp.cert
mv runtime/postal/smtp.key.new runtime/postal/smtp.key
config tls-enable
if "${COMPOSE[@]}" ps --status running --services | grep -qx smtp; then "${COMPOSE[@]}" restart smtp; fi
printf 'SMTP certificate synchronized.\n'
