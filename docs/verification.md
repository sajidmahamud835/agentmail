# Verification status

Initial implementation verification, 2026-10-09:

- Local Node tests pass: client request/error behavior; inbox credential isolation, signature rejection, deduplication, pagination, acknowledgement, storage persistence and retryable failures; configuration and credential preservation.
- JavaScript syntax, YAML parsing, ShellCheck and actionlint validation pass.
- The dependency audit reports no known vulnerabilities in the development dependency tree.
- The repository is private and runtime data/secrets are excluded from version control.

The Linux container integration check is implemented in `tests/integration.sh` and wired into CI. GitHub Actions returned `startup_failure` before allocating any jobs, including a manual dispatch. No runner logs were created. The current development machine has no Docker engine, so **the actual container startup, SMTP exchange and backup/restore integration have not yet been executed**.

Run the integration job successfully before deploying customer workloads. The check uses an isolated Postal database, a held outbound credential, a self-signed SMTP certificate and Caddy's private CA; it does not send test mail to external recipients. It exercises actual SMTP reception, signature delivery, credential-scoped polling and encrypted backup recovery on a disposable Ubuntu host.

Public DNS, public certificate issuance, provider port access, real-world inbox placement and a complete fresh-server installation additionally require a server and domain controlled by the operator. Those are not proven by unit tests or a container-only CI run.
