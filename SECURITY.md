# Security

Report vulnerabilities privately to the repository owner through the repository's available private reporting channel. Do not include real tokens, private keys, or message contents in issues or pull requests.

Use a dedicated server. Expose only the documented mail/web ports and restricted SSH. Keep the OS, Docker and pinned service versions maintained. Store sending and inbox credentials separately and rotate them when an agent is retired or compromised.

The operator owns access control for Postal administration and the host. Bearer inbox tokens are scoped to one configured inbox, but all mail is visible to the host administrator. Messages and keys are not application-encrypted at rest; use host/disk protections and encrypted off-server backups.

The internal receiver verifies RSA-SHA256 signatures and is not proxied publicly. It never renders incoming HTML or executes attachments. No malware scanner or agent sandbox is bundled. Email text, links, sender identity claims and attachments are untrusted input; application authorization must not be inferred from email instructions alone.

Avoid giving an agent unrestricted sending authority. Use a dedicated Postal mail server, configured send limits, a narrow verified domain, application recipient restrictions, and an external monitor where appropriate.
