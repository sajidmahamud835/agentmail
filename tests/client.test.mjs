import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentMail } from '../src/client.mjs';

test('client maps outgoing payload to Postal and returns queued message identifiers', async () => {
  let request;
  const client = new AgentMail({ url: 'https://mail.example.com', sendKey: 'send-secret', fetch: async (url, options) => {
    request = { url, ...options };
    return Response.json({ status: 'success', data: { message_id: 'example@id', messages: { 'a@example.net': { id: 1 } } } });
  } });
  const result = await client.send({ from: 'agent@example.com', to: ['a@example.net'], subject: 'Hello', text: 'Text', replyTo: 'reply@example.com', headers: { 'In-Reply-To': '<parent@example.net>' } });
  assert.equal(result.message_id, 'example@id');
  assert.equal(request.url, 'https://mail.example.com/api/v1/send/message');
  assert.equal(request.headers['x-server-api-key'], 'send-secret');
  assert.equal(JSON.parse(request.body).plain_body, 'Text');
  assert.equal(JSON.parse(request.body).reply_to, 'reply@example.com');
  assert.equal(JSON.parse(request.body).headers['In-Reply-To'], '<parent@example.net>');
});

test('API-level errors are errors even when HTTP status is 200', async () => {
  const client = new AgentMail({ url: 'https://mail.example.com', sendKey: 'key', fetch: async () => Response.json({ status: 'error', data: { code: 'UnauthenticatedFromAddress', message: 'Sender is not verified' } }) });
  await assert.rejects(client.send({ from: 'a@example.com', to: ['b@example.com'], subject: 'Hi', text: 'Hi' }), error => error.code === 'UnauthenticatedFromAddress');
});

test('network send failure is ambiguous and never automatically retried', async () => {
  let calls = 0;
  const client = new AgentMail({ url: 'https://mail.example.com', sendKey: 'key', fetch: async () => { calls++; throw new Error('Network lost'); } });
  await assert.rejects(client.send({ from: 'a@example.com', to: ['b@example.com'], subject: 'Hi', text: 'Hi' }), error => error.ambiguous === true);
  assert.equal(calls, 1);
});

test('client rejects remote plain HTTP and credential-bearing origins', () => {
  assert.throws(() => new AgentMail({ url: 'http://mail.example.com' }), /HTTPS/);
  assert.throws(() => new AgentMail({ url: 'https://user:secret@mail.example.com' }), /origin/);
});
