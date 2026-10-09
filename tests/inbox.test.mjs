import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInbox, hashToken, validateInboxes } from '../src/inbox.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicPem = publicKey.export({ format: 'pem', type: 'spki' });
const config = () => ({ inboxes: [
  { id: 'one', addresses: ['one@example.com'], token_hash: hashToken('one-secret') },
  { id: 'two', addresses: ['two@example.com'], token_hash: hashToken('two-secret') },
] });
const payload = (changes = {}) => ({ id: 1, token: 'postal-delivery-token', rcpt_to: 'one@example.com', from: 'Sender <sender@example.net>', message_id: 'message@example.net', subject: 'An email', plain_body: 'Hello', attachments: [{ filename: 'note.txt', content_type: 'text/plain', data: 'SGVsbG8=' }], ...changes });

async function start(t, options = {}) {
  const instance = createInbox({ database: ':memory:', publicKey: publicPem, getConfig: config, ...options });
  await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
  instance.url = `http://127.0.0.1:${instance.server.address().port}`;
  instance.close = () => new Promise(resolve => instance.server.close(() => { instance.db.close(); resolve(); }));
  if (t) t.after(instance.close);
  return instance;
}
async function deliver(instance, data, { signature = true, raw = JSON.stringify(data), headers = {} } = {}) {
  return fetch(instance.url + '/postal/inbound', { method: 'POST', headers: {
    'content-type': 'application/json',
    ...(signature ? { 'x-postal-signature-256': sign('RSA-SHA256', Buffer.from(raw), privateKey).toString('base64') } : {}), ...headers,
  }, body: raw });
}
const auth = token => ({ headers: { authorization: `Bearer ${token}` } });

test('signed delivery persists once, returns attachments, and isolates inboxes', async t => {
  const app = await start(t);
  const first = await deliver(app, payload());
  assert.equal(first.status, 200);
  const { id } = await first.json();
  assert.deepEqual(await (await deliver(app, payload())).json(), { id });
  const page = await (await fetch(app.url + '/agent-api/v1/messages', auth('one-secret'))).json();
  assert.equal(page.data.length, 1);
  assert.equal(page.data[0].recipient, 'one@example.com');
  const response = await fetch(app.url + `/agent-api/v1/messages/${id}`, auth('one-secret'));
  const record = await response.json();
  assert.equal(record.message.attachments[0].data, 'SGVsbG8=');
  assert.equal(record.message.token, undefined);
  assert.equal((await fetch(app.url + `/agent-api/v1/messages/${id}`, auth('two-secret'))).status, 404);
  assert.equal((await fetch(app.url + `/agent-api/v1/messages/${id}/ack`, { ...auth('two-secret'), method: 'POST' })).status, 404);
  assert.equal((await (await fetch(app.url + '/agent-api/v1/messages', auth('two-secret'))).json()).data.length, 0);
  assert.equal((await fetch(app.url + '/agent-api/v1/messages')).status, 401);
  assert.equal((await fetch(app.url + '/agent-api/v1/messages', auth('bad'))).status, 401);
});

test('tampered and unsigned requests cannot write; invalid and oversized requests fail', async t => {
  const app = await start(t, { maxBytes: 1024 });
  assert.equal((await deliver(app, payload(), { signature: false })).status, 401);
  assert.equal((await deliver(app, payload(), { headers: { 'x-postal-signature-256': 'AAAA' } })).status, 401);
  assert.equal((await deliver(app, payload(), { raw: '{invalid' })).status, 400);
  assert.equal((await deliver(app, payload({ id: '1' }))).status, 400);
  assert.equal((await deliver(app, payload({ rcpt_to: 'unknown@example.com' }))).status, 404);
  assert.equal((await deliver(app, payload({ plain_body: 'x'.repeat(2048) }))).status, 413);
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM messages').get().n, 0);
});

test('same Postal id from a different mail server does not collide', async t => {
  const app = await start(t);
  await deliver(app, payload());
  await deliver(app, payload({ token: 'different-server-token' }));
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM messages').get().n, 2);
});

test('acknowledgement is idempotent, pagination ordered, and credentials rotate immediately', async t => {
  const boxes = config();
  const app = await start(t, { getConfig: () => boxes });
  for (let id = 1; id <= 3; id++) await deliver(app, payload({ id }));
  const page = await (await fetch(app.url + '/agent-api/v1/messages?limit=2', auth('one-secret'))).json();
  assert.equal(page.has_more, true);
  assert.equal(page.next_cursor, 2);
  const tail = await (await fetch(app.url + '/agent-api/v1/messages?after=2', auth('one-secret'))).json();
  assert.equal(tail.data.length, 1);
  for (let i = 0; i < 2; i++) assert.equal((await fetch(app.url + '/agent-api/v1/messages/1/ack', { ...auth('one-secret'), method: 'POST' })).status, 200);
  const unacked = await (await fetch(app.url + '/agent-api/v1/messages?unacked=true', auth('one-secret'))).json();
  assert.deepEqual(unacked.data.map(row => row.id), [2, 3]);
  assert.equal((await fetch(app.url + '/agent-api/v1/messages?after=-1', auth('one-secret'))).status, 400);
  assert.equal((await fetch(app.url + '/agent-api/v1/messages?limit=101', auth('one-secret'))).status, 400);
  boxes.inboxes[0].token_hash = hashToken('new-secret');
  assert.equal((await fetch(app.url + '/agent-api/v1/messages', auth('one-secret'))).status, 401);
  assert.equal((await fetch(app.url + '/agent-api/v1/messages', auth('new-secret'))).status, 200);
});

test('messages and acknowledgements survive process storage reopen', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'agentpost-inbox-'));
  const database = join(folder, 'inbox.sqlite');
  let app = await start(null, { database });
  try {
    await deliver(app, payload());
    await fetch(app.url + '/agent-api/v1/messages/1/ack', { ...auth('one-secret'), method: 'POST' });
    await app.close();
    app = await start(null, { database });
    const record = await (await fetch(app.url + '/agent-api/v1/messages/1', auth('one-secret'))).json();
    assert.equal(record.message.subject, 'An email');
    assert.ok(record.acknowledged_at);
    assert.equal((await (await deliver(app, payload())).json()).id, 1);
  } finally { await app.close(); rmSync(folder, { recursive: true }); }
});

test('storage failure returns retryable 503 without acknowledging delivery', async t => {
  const app = await start(t);
  app.db.exec('PRAGMA query_only=ON');
  assert.equal((await deliver(app, payload())).status, 503);
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM messages').get().n, 0);
});

test('configuration rejects overlapping addresses and duplicate ids', () => {
  const boxes = config();
  boxes.inboxes[1].addresses = ['ONE@example.com'];
  assert.throws(() => validateInboxes(boxes), /duplicate address/);
  const ids = config(); ids.inboxes[1].id = 'one';
  assert.throws(() => validateInboxes(ids), /duplicate inbox/);
});
