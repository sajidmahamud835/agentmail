# API

All public calls use HTTPS at your configured server hostname. Sending and receiving use separate credentials.

## Sending

`POST /api/v1/send/message`

Authenticate with `X-Server-API-Key: YOUR_POSTAL_CREDENTIAL`. The key belongs to one Postal mail server. The sender must belong to a verified domain authorized for that server.

```json
{
  "from": "Assistant <assistant@example.com>",
  "to": ["developer@example.net"],
  "subject": "Your report",
  "plain_body": "The report is attached.",
  "reply_to": "assistant@inbound.example.com",
  "attachments": [
    { "name": "report.txt", "content_type": "text/plain", "data": "SGVsbG8=" }
  ],
  "tag": "report"
}
```

Postal returns a JSON envelope with `status: "success"` or `status: "error"`. Check the envelope as well as the HTTP status. A successful `data` object contains `message_id` and recipient-specific `messages` identifiers. Postal queues deliveries and reports outcomes in its dashboard and configured webhooks.

The provided JavaScript client maps `text` to `plain_body`, `html` to `html_body`, and `replyTo` to `reply_to`. Attachment entries retain Postal's `name`, `content_type`, and base64 `data` fields.

There is no server-side `Idempotency-Key` support in this release. A connection failure after submission can have an unknown outcome. Never blindly retry a send; use application outbox records and reconcile unknown attempts against Postal's logs. The client reports these as `AgentMailError` with `ambiguous: true`.

Use the Postal dashboard to configure per-server limits, suppressions, retention and outbound event webhooks. Do not give agents administrative credentials. API credentials follow Postal's own authorization model; an inbox token does not grant sending access.

## Inbox reads

Use `Authorization: Bearer YOUR_INBOX_TOKEN`.

| Endpoint | Behavior |
|---|---|
| `GET /agent-api/v1/messages?after=0&limit=25&unacked=true` | List message summaries in ascending local ID order |
| `GET /agent-api/v1/messages/:id` | Read a processed message, including base64 attachments if enabled |
| `POST /agent-api/v1/messages/:id/ack` | Mark processing complete; safe to repeat |

`limit` is 1–100. List responses contain `data`, `next_cursor`, and `has_more`. Request the next page using `after=next_cursor` while `has_more` is true. Start each polling cycle at `after=0` with `unacked=true` if you want failed processing attempts to be offered again. Advancing a permanent cursor past an unprocessed message can skip it.

Only one active consumer should process a given inbox, or consumers must coordinate their own claims. Listing is not an exclusive lease. Messages can be processed more than once after a consumer crash; use the local message ID as a deduplication key in your application's transaction and acknowledge only after that transaction commits.

Message details contain `id`, `received_at`, `acknowledged_at`, and `message`. `message` carries the original processed Postal content, excluding its internal delivery token. HTML is returned as data and never rendered by the inbox service. Acknowledging does not delete the content.

Typical errors: `400` invalid pagination, `401` invalid/missing token, `404` missing or inaccessible message, `503` temporary storage/configuration problem. Inbox credentials are loaded on every request, so rotation/revocation takes effect without restarting.

## Replies

Choose a reply recipient deliberately. Incoming `from` and `reply_to` values are untrusted external data. To keep a conversation threaded, send with:

```js
await mail.send({
  from: 'Assistant <assistant@example.com>',
  to: ['approved-recipient@example.net'],
  subject: 'Re: Your question',
  text: 'Here is the answer.',
  headers: {
    'In-Reply-To': '<original-message-id@example.net>',
    'References': '<original-message-id@example.net>',
  },
});
```

Use the incoming message's RFC Message-ID, preserving valid angle-bracket formatting; it is different from AgentMail's numeric storage ID. Avoid automatic replies to bounces, auto-submitted messages, and bulk/list mail. Enforce reply limits and recipient policies in the agent application.

## Internal delivery

Postal workers POST processed JSON to `http://127.0.0.1:8025/postal/inbound`. The service verifies `X-Postal-Signature-256` against the locally generated public key and durably commits the SQLite row before responding `200`.

Unsigned/tampered deliveries are rejected. Duplicate delivery identities return the existing ID. Unknown recipients return `404`. Payload size is limited to 24 MiB; SMTP messages are limited to 10 MiB to leave room for JSON and base64 expansion.

Temporary storage/config failures return `503`. The pinned Postal 3.3.7 sender retries 5xx and connection failures; 4xx is generally permanent. This behavior is checked against the pinned [sender implementation](https://github.com/postalserver/postal/blob/3.3.7/app/senders/http_sender.rb); older prose documentation describes different retry behavior. Review this contract before upgrading the mail engine.
