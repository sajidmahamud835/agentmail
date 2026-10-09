# Operations

Run commands from the repository directory as an administrator. Secrets and mail live under `.env` and `runtime/`; neither belongs in Git.

## Routine checks

```bash
sudo bash scripts/status.sh
sudo docker compose logs --tail=100 smtp worker inbox
sudo systemctl list-timers 'agentmail-*'
sudo journalctl -u agentmail-health.service --since today
```

Containers restart after crashes and reboots. Docker logs rotate at 10 MB with three retained files per service. Five-minute health checks test the dashboard, SMTP, worker, inbox, disk usage, certificate expiry, and backup age when configured. Docker's `unhealthy` status alone does not restart a process; inspect and repair a degraded service.

Install an executable `/etc/agentmail/alert` if you want failed health checks delivered to an external alert system. It receives a short problem string as its first argument. Keep it root-owned and avoid putting secrets into output. Also use an external uptime monitor for whole-server outages.

## Credentials and administrative email

Sending credentials are created/revoked in Postal. Inbox credentials use:

```bash
sudo bash scripts/inbox.sh add assistant assistant@inbound.example.com
sudo bash scripts/inbox.sh rotate assistant
sudo bash scripts/inbox.sh revoke assistant
```

Revoking removes inbox access and stops acceptance for its registered address. It does not erase stored mail. Disable its Postal route as well. Reusing the same inbox ID intentionally restores access to its existing history; choose a new ID for a different owner.

After creating a Postal SMTP credential for administrative email, set `ADMIN_SMTP_USERNAME`, `ADMIN_SMTP_PASSWORD`, and a verified `ADMIN_FROM_ADDRESS` in `.env`. Regenerate configuration and restart the web/worker services:

```bash
sudo docker run --rm --network none -v "$PWD:/work" -w /work \
  -e AGENTMAIL_ROOT=/work node:22.23.3-bookworm-slim node scripts/configure.mjs
sudo docker compose restart web worker
```

Until administrative SMTP is configured and tested, password-reset emails and mail-engine notices are not operational. Keep SSH access and the administrator password available. Do not change database passwords in `.env` alone: initialization SQL runs only on a fresh database; rotation also requires a coordinated database-user password change.

## SMTP certificates

Caddy obtains and renews HTTPS certificates. A timer checks every six hours for a renewed certificate, copies it with restricted ownership for Postal, and restarts SMTP if it changed. On first installation, SMTP starts only after a certificate exists. Use `sudo bash scripts/sync-tls.sh` to synchronize manually. Never expose Caddy's localhost admin port.

## Backups

AgentMail uses restic for authenticated encryption. Provision an off-server restic backend (SFTP, S3-compatible storage, or another supported repository) and keep its credentials and encryption password available independently of the mail server. Local-only backups do not protect against disk or server loss.

Create `/etc/agentmail/restic-password` with a long random password and mode `0600`. Create `/etc/agentmail/backup.env` with mode `0600`:

```dotenv
RESTIC_REPOSITORY=s3:https://storage.example.net/agentmail-backups
RESTIC_PASSWORD_FILE=/etc/agentmail/restic-password
AWS_ACCESS_KEY_ID=YOUR_STORAGE_ACCESS_KEY
AWS_SECRET_ACCESS_KEY=YOUR_STORAGE_SECRET_KEY
```

This file follows systemd `EnvironmentFile` syntax. Initialize the repository and test a backup using the same environment as the timer:

```bash
sudo systemd-run --wait --pipe --collect \
  -p EnvironmentFile=/etc/agentmail/backup.env /usr/bin/restic init
sudo bash scripts/install-timers.sh
sudo systemctl start agentmail-backup.service
sudo journalctl -u agentmail-backup.service --no-pager
```

Backups run daily at 03:00 server time. The script briefly stops mail writers, takes a complete MariaDB SQL dump and consistent inbox SQLite copy, and resumes services before uploading. This means a brief planned delivery/API interruption; sending applications should handle downtime and ambiguous send outcomes. SMTP peers normally retry temporary connection failures.

The encrypted bundle contains database contents, inbox messages, signing keys, deployment configuration, `.env`, and the Git commit. Caddy can reissue HTTPS certificates after recovery; the existing SMTP certificate is in the bundle. A restricted plaintext staging copy remains under `runtime/backup-stage`; account for it in disk sizing. Backup repository credentials/password are deliberately not included.

No recovery points are automatically removed. Configure restic retention after checking your recovery needs, and periodically run `restic check --read-data`. A successful metadata check alone does not prove every stored data block can be restored.

## Restore to a fresh server

1. Install Docker Engine/Compose, Git, restic, OpenSSL, and the script dependencies listed by the installer on Ubuntu 24.04. Do not run `install.sh` to initialize a new mail database first.
2. Restore the selected restic snapshot into a protected directory, for example `/root/recovery`. Use the backup environment with `systemd-run` as above, invoking `restic restore SNAPSHOT --target /root/recovery`.
3. Locate its `backup-stage` directory under the original absolute path. Read its `commit` file.
4. Clone this repository and check out that exact commit. Leave the checkout without `.env` or `runtime/database`.
5. Run:

```bash
sudo bash scripts/restore.sh \
  /root/recovery/opt/agentmail/runtime/backup-stage --fresh-server
```

6. Restore backup credentials separately, point A/PTR records to the replacement server if needed, and check DNS, HTTPS, SMTP STARTTLS, inbox history, send credentials, and a real send/reply exchange.
7. Test a new backup before reactivating normal agent workloads.

The restore script refuses an initialized destination. It never overwrites a live database. Restoring a point-in-time backup loses data created after that snapshot; do not run two copies of the same mail identity concurrently.

## Updates

Fetch and review a release/commit. Configure the backup environment for the update process, then run:

```bash
git fetch origin
sudo systemd-run --wait --pipe --collect \
  -p EnvironmentFile=/etc/agentmail/backup.env \
  /usr/bin/bash /opt/agentmail/scripts/update.sh REVIEWED_COMMIT
```

The script backs up first, stops writers, checks out the target, pulls pinned images, runs Postal migrations and starts services. It does not automatically pull arbitrary upstream changes. A failed migration leaves services stopped for investigation. Reverting Git is not a database downgrade: recover the pre-update snapshot on a fresh instance if a migration must be undone. Review MariaDB major-version changes separately; the helper is intended for compatible application releases.

## Retention and capacity

Configure Postal message/raw-message retention through its dashboard. Agent inbox messages currently remain until you perform a planned data migration; acknowledgements are not deletion. This avoids losing agent work or duplicate-delivery tombstones silently, but requires disk monitoring. There is no attachment malware scanner enabled by default: do not execute incoming files. Add scanning and a tested deletion policy before accepting large or high-volume untrusted workloads.

## Common failures

| Symptom | Check |
|---|---|
| HTTPS setup fails | DNS A/AAAA, provider firewall, ports 80/443, Caddy logs |
| Outgoing mail delayed | Provider port 25, IP reputation, recipient response in Postal |
| Inbound mail missing | Receiving MX, explicit Postal route, inbox address registration, worker logs |
| HTTP endpoint rejected | JSON processed format; same signing key/public key; loopback destination allowlist |
| Dashboard password reset missing | Administrative SMTP credential and verified from address |
| Backup not running | Backup environment, restic initialization, timer and journal |
| Disk warning | Inbox payloads, Postal retention, database size, plaintext backup staging |
