import { createServer } from 'node:http';
import { createHash, createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export const hashToken = token => createHash('sha256').update(token).digest('hex');
const send = (res, status, value) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(value));
};

export function validateInboxes(config) {
  if (!Array.isArray(config.inboxes)) throw new Error('inboxes must be an array');
  const ids = new Set();
  const addresses = new Set();
  for (const box of config.inboxes) {
    if (!/^[a-z][a-z0-9-]{0,47}$/.test(box.id) || ids.has(box.id)) throw new Error('Invalid or duplicate inbox id');
    if (!/^[a-f0-9]{64}$/.test(box.token_hash)) throw new Error('Invalid inbox token hash');
    if (!Array.isArray(box.addresses) || !box.addresses.length) throw new Error('Inbox needs an address');
    for (const address of box.addresses) {
      if (typeof address !== 'string' || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address) || addresses.has(address.toLowerCase())) {
        throw new Error('Invalid or duplicate address');
      }
      addresses.add(address.toLowerCase());
    }
    ids.add(box.id);
  }
  return config;
}

export function createInbox({ database, publicKey, getConfig, maxBytes = 24 * 1024 * 1024, onError = () => {} }) {
  if (database !== ':memory:') mkdirSync(dirname(database), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(database);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inbox TEXT NOT NULL, delivery_key TEXT NOT NULL UNIQUE,
      received_at TEXT NOT NULL, acknowledged_at TEXT, payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_inbox_id ON messages(inbox, id);`);
  const key = createPublicKey(publicKey);

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') {
      db.prepare('SELECT 1').get();
      validateInboxes(getConfig());
      return send(res, 200, { status: 'ok' });
    }
    // Private loopback endpoint: never exposed by Caddy. The signature is still required.
    if (req.method === 'POST' && url.pathname === '/postal/inbound') {
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'Use JSON encoding' });
      if (Number(req.headers['content-length']) > maxBytes) return send(res, 413, { error: 'Message too large' });
      const signature = req.headers['x-postal-signature-256'];
      if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) return send(res, 401, { error: 'Invalid signature' });
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > maxBytes) return send(res, 413, { error: 'Message too large' });
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks);
      if (!verify('RSA-SHA256', raw, key, Buffer.from(signature, 'base64'))) return send(res, 401, { error: 'Invalid signature' });
      let payload;
      try { payload = JSON.parse(raw); } catch { return send(res, 400, { error: 'Invalid JSON' }); }
      if (!payload || !Number.isSafeInteger(payload.id) || payload.id < 1 ||
          typeof payload.token !== 'string' || !payload.token || payload.token.length > 256 ||
          typeof payload.rcpt_to !== 'string' || payload.rcpt_to.length > 320 ||
          typeof payload.message_id !== 'string') return send(res, 400, { error: 'Expected a processed Postal message' });
      const box = validateInboxes(getConfig()).inboxes.find(item => item.addresses.some(address => address.toLowerCase() === payload.rcpt_to.toLowerCase()));
      if (!box) return send(res, 404, { error: 'No inbox for recipient' });
      // Postal IDs are scoped to a mail server; the delivery token disambiguates them.
      const deliveryKey = hashToken(JSON.stringify([box.id, payload.id, payload.token, payload.rcpt_to.toLowerCase()]));
      db.prepare('INSERT OR IGNORE INTO messages(inbox, delivery_key, received_at, payload) VALUES (?, ?, ?, ?)')
        .run(box.id, deliveryKey, new Date().toISOString(), raw.toString('utf8'));
      const record = db.prepare('SELECT id FROM messages WHERE delivery_key = ?').get(deliveryKey);
      return send(res, 200, { id: record.id });
    }
    if (!url.pathname.startsWith('/agent-api/v1/')) return send(res, 404, { error: 'Not found' });
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ') || auth.length > 512) return send(res, 401, { error: 'Unauthorized' });
    const candidate = Buffer.from(hashToken(auth.slice(7)), 'hex');
    const box = validateInboxes(getConfig()).inboxes.find(item => timingSafeEqual(Buffer.from(item.token_hash, 'hex'), candidate));
    if (!box) return send(res, 401, { error: 'Unauthorized' });
    const path = url.pathname.slice('/agent-api/v1'.length);
    if (req.method === 'GET' && path === '/messages') {
      const afterValue = url.searchParams.get('after') ?? '0';
      const limitValue = url.searchParams.get('limit') ?? '25';
      if (!/^\d+$/.test(afterValue) || !/^\d+$/.test(limitValue)) return send(res, 400, { error: 'Invalid pagination' });
      const after = Number(afterValue), limit = Number(limitValue);
      if (!Number.isSafeInteger(after) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return send(res, 400, { error: 'Invalid pagination' });
      const unacked = url.searchParams.get('unacked');
      if (unacked !== null && unacked !== 'true' && unacked !== 'false') return send(res, 400, { error: 'Invalid unacked filter' });
      const rows = db.prepare(`SELECT id, received_at, acknowledged_at,
        json_extract(payload, '$.from') AS sender,
        json_extract(payload, '$.rcpt_to') AS recipient,
        json_extract(payload, '$.subject') AS subject
        FROM messages WHERE inbox = ? AND id > ? ${unacked === 'true' ? 'AND acknowledged_at IS NULL' : ''}
        ORDER BY id LIMIT ?`).all(box.id, after, limit + 1);
      const hasMore = rows.length > limit;
      const data = rows.slice(0, limit);
      return send(res, 200, { data, next_cursor: data.at(-1)?.id ?? after, has_more: hasMore });
    }
    const match = path.match(/^\/messages\/(\d+)(\/ack)?$/);
    if (match && Number.isSafeInteger(Number(match[1]))) {
      const record = db.prepare('SELECT * FROM messages WHERE inbox = ? AND id = ?').get(box.id, Number(match[1]));
      if (!record) return send(res, 404, { error: 'Not found' });
      if (req.method === 'GET' && !match[2]) {
        const payload = JSON.parse(record.payload);
        delete payload.token;
        return send(res, 200, { id: record.id, received_at: record.received_at, acknowledged_at: record.acknowledged_at, message: payload });
      }
      if (req.method === 'POST' && match[2]) {
        db.prepare('UPDATE messages SET acknowledged_at = COALESCE(acknowledged_at, ?) WHERE inbox = ? AND id = ?')
          .run(new Date().toISOString(), box.id, record.id);
        return send(res, 200, { id: record.id, acknowledged: true });
      }
    }
    return send(res, 404, { error: 'Not found' });
  }
  const server = createServer((req, res) => {
    handle(req, res).catch(error => {
      onError(error);
      if (!res.headersSent) send(res, 503, { error: 'Temporarily unavailable' });
      else res.destroy();
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return { server, db };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const configFile = process.env.INBOX_CONFIG || 'runtime/inbox-config/inboxes.json';
  const getConfig = () => JSON.parse(readFileSync(configFile, 'utf8'));
  validateInboxes(getConfig());
  const { server, db } = createInbox({
    database: process.env.INBOX_DATABASE || 'runtime/inbox/inbox.sqlite',
    publicKey: readFileSync(process.env.POSTAL_PUBLIC_KEY || 'runtime/inbox-config/signing.pub'),
    getConfig,
    onError: () => console.error('Inbox request failed; check storage and configuration.'),
  });
  server.listen(Number(process.env.INBOX_PORT || 8025), process.env.INBOX_BIND || '127.0.0.1', () => console.log('AgentMail inbox ready'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
}
