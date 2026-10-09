# DNS and first delivery

Examples use `mail.example.com` for the server, `example.com` for sending, and `inbound.example.com` for agent mail. Replace all example values.

## Infrastructure records

| Name | Type | Value |
|---|---|---|
| `mail.example.com` | A | Server public IPv4 |
| `spf.mail.example.com` | TXT | `v=spf1 ip4:YOUR_PUBLIC_IPV4 -all` |
| `rp.mail.example.com` | MX | `10 mail.example.com` |
| `rp.mail.example.com` | TXT | `v=spf1 ip4:YOUR_PUBLIC_IPV4 -all` |
| `routes.mail.example.com` | MX | `10 mail.example.com` |
| `inbound.example.com` | MX | `10 mail.example.com` |

Set the IP's PTR to `mail.example.com` through your server provider. The A record must point back to that IP. Keep the hostname DNS-only, without an HTTP CDN proxy. Do not configure `track.mail.example.com` or enable link/open tracking in this release; the tracking hostname is reserved in Postal configuration but is not served by this deployment.

## Sending-domain records

Add the sending domain in the dashboard and copy the exact records Postal displays:

- Ownership verification TXT record.
- DKIM public key record.
- SPF authorization (usually including `spf.mail.example.com`). Merge with any existing SPF record; do not create a second SPF record for the same name.
- Custom return-path record displayed by Postal.

Add DMARC at `_dmarc.example.com`. Begin by monitoring alignment, for example `v=DMARC1; p=none`, and tighten policy after confirming every legitimate sender. Add `rua` only if you have an appropriate report mailbox. `p=none` observes failures; it does not enforce rejection.

Do not replace the apex domain's existing MX if another provider handles your normal mail. Give agents a receiving subdomain instead. An MX record routes the entire domain, not just one address.

## First-run checklist

1. Confirm external reachability of ports 25, 80 and 443. An installer probe cannot prove inbound connectivity from the internet.
2. Confirm forward and reverse DNS match.
3. Verify the domain in Postal and create a sending API credential.
4. Send a low-volume test to accounts you control at several mailbox providers.
5. Inspect the received headers for SPF, DKIM and DMARC passes, including alignment.
6. Configure an explicit receiving route and reply to the message.
7. Fetch the reply with the agent inbox token.
8. Check SMTP STARTTLS externally:

```bash
openssl s_client -starttls smtp -connect mail.example.com:25 \
  -servername mail.example.com -verify_return_error </dev/null
```

If direct outbound SMTP is blocked, ask the provider to enable it or plan a separate relay configuration. The default installer stops when its outbound-port test fails; it does not silently switch to a third-party delivery service.

References: [Postal DNS](https://docs.postalserver.io/getting-started/dns-configuration/), [Gmail sender guidance](https://support.google.com/mail/answer/81126).
