# AgentMail

Email infrastructure for private AI agents and developers. Run a mail API, delivery dashboard, SMTP receiver, and agent inboxes on one server.

AgentMail packages [Postal](https://github.com/postalserver/postal) with a small authenticated inbox service and operational tooling. Postal supplies the administration dashboard and mail delivery engine. AgentMail adds per-inbox access tokens, durable polling, and deployment scripts.

## What works in this release

- Send HTML, text, attachments, and threaded replies through Postal's HTTP API.
- Manage domains, credentials, incoming/outgoing logs, queues, and webhooks in Postal's dashboard.
- Receive mail into isolated agent inboxes through signed internal HTTP delivery.
- Poll messages and acknowledge completed work using a scoped bearer token.
- Preserve received messages and deduplicate delivery retries in SQLite.
- Deploy with Docker Compose on a dedicated Ubuntu 24.04 x86_64 server.
- Obtain HTTPS certificates automatically and synchronize them to SMTP STARTTLS.
- Create encrypted restic backups and restore onto a fresh server.

The current UI is Postal's dashboard. Agent inboxes are API-only. There is no public signup, billing, campaign editor, IMAP, custom conversation UI, or automatic agent execution.

## Server requirements

- Dedicated Ubuntu 24.04 LTS x86_64 machine with root/SSH access.
- Suggested starting resources: 4 vCPU, 8 GB RAM, 80+ GB SSD; capacity depends on volume and retention.
- Static public IPv4 with configurable PTR (reverse DNS).
- Inbound TCP 25, 80, 443; outbound TCP 25, 443 and DNS resolution.
- A hostname whose DNS A record points directly to the server. Disable CDN proxying. This release uses IPv4; do not publish AAAA records for its mail hostname.

Check your provider's email policy and port-25 availability before provisioning. A running server does not guarantee inbox placement. Start with low volume and verify SPF, DKIM and DMARC alignment.

## Deploy

Clone the repository into `/opt/agentmail`:

```bash
sudo git clone https://github.com/sajidmahamud835/agentmail.git /opt/agentmail
cd /opt/agentmail
sudo cp .env.example .env
sudo nano .env
sudo bash scripts/install.sh
sudo bash scripts/admin.sh
```

Set `MAIL_HOSTNAME`, `ACME_EMAIL`, `PUBLIC_IPV4`, and `ADMIN_FROM_ADDRESS`. Leave generated secrets blank on the first run. The installer preserves them on subsequent runs. Use a fresh server: the installer checks for port conflicts and does not remove existing services or change your SSH/firewall rules.

Open `https://YOUR_MAIL_HOSTNAME`, sign in, create an organization and a mail server, and add a sending domain. Follow [DNS setup](docs/dns.md), then create an API credential in the dashboard. Keep separate mail servers and credentials for workloads that need isolation.

The installation uses pinned container tags and Docker's official Ubuntu repository. Re-running setup does not reset mail data or credentials. DNS, PTR, administrator creation, and off-server backup credentials require operator configuration.

## Send a message

Copy `src/client.mjs` into your application, or import it from a checkout. No runtime npm dependencies are needed.

```js
import { AgentMail } from './src/client.mjs';

const mail = new AgentMail({
  url: 'https://mail.example.com',
  sendKey: process.env.AGENTMAIL_SEND_KEY,
});

const result = await mail.send({
  from: 'Assistant <assistant@example.com>',
  to: ['developer@example.net'],
  subject: 'Task complete',
  text: 'The requested report is ready.',
  replyTo: 'assistant@inbound.example.com',
});
console.log(result.message_id);
```

Sending returns queue identifiers, not proof of delivery. This API does not provide server-side idempotency. The client never automatically retries a send: after a timeout, inspect the mail logs before retrying. Use an application outbox for business-level duplicate prevention.

## Give an agent an inbox

```bash
sudo bash scripts/inbox.sh add assistant assistant@inbound.example.com
```

Save the displayed token in your agent's secret store. Only the token hash is saved on the mail server.

In the Postal dashboard:

1. Add and verify the receiving domain, with its MX pointing to this server.
2. Create an HTTP endpoint: `http://127.0.0.1:8025/postal/inbound`.
3. Select **JSON encoding**, **processed/Hash format**, and include attachments if required.
4. Add an explicit `assistant` receiving route to that endpoint. Keep catch-all routing off initially.

The endpoint is internal to the server. The inbox service verifies Postal's RSA-SHA256 signature before storing the original processed payload. Caddy blocks public access to `/postal/*`.

```js
const inbox = new AgentMail({
  url: 'https://mail.example.com',
  inboxKey: process.env.AGENTMAIL_INBOX_KEY,
});

const page = await inbox.messages({ unacked: true });
for (const summary of page.data) {
  const email = await inbox.message(summary.id);
  await yourApplication.persistAndProcess(email); // your durable handler
  await inbox.acknowledge(email.id);
}
```

Read [the API guide](docs/api.md) for pagination, attachments, replies, and retry semantics. Inbox acknowledgement does not delete mail. AgentMail does not run tools, execute attachments, or follow instructions from incoming messages.

## Operate

```bash
sudo bash scripts/status.sh
sudo bash scripts/inbox.sh rotate assistant
sudo bash scripts/inbox.sh revoke assistant
sudo docker compose logs --tail=100 web worker smtp inbox
```

Daily backups become active after you configure an off-server restic repository. See [operations and disaster recovery](docs/operations.md). Health checks log failures to the system journal; connect the optional alert hook to your external monitor. A single server cannot monitor its own total outage.

## Develop

Node 22.14+ is required locally. Production runs the pinned Node image in Compose.

```bash
npm ci
npm test
npm run check
```

CI tests inbox authorization, signature rejection, duplicate deliveries, crash persistence, failure responses, configuration generation, and the client contract. A Linux integration job initializes the actual mail stack, exercises SMTP receiving and API sending, and checks backup/restore. These checks do not measure real-world inbox placement.

See [verification status](docs/verification.md), [architecture](docs/architecture.md), [contributing](CONTRIBUTING.md), and [security](SECURITY.md).

## License

AgentMail-authored code is MIT licensed. Postal, Caddy, MariaDB, Node.js, and restic retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
