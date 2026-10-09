import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { AgentMail } from '../src/client.mjs';

class SMTP {
  constructor(socket) {
    this.socket = socket;
    this.buffer = '';
    this.replies = [];
    this.waiters = [];
    this.lines = [];
    this.onData = data => {
      this.buffer += data.toString();
      while (this.buffer.includes('\r\n')) {
        const index = this.buffer.indexOf('\r\n');
        const line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 2);
        this.lines.push(line);
        if (/^\d{3} /.test(line)) {
          const reply = { code: Number(line.slice(0, 3)), text: this.lines.join('\n') };
          this.lines = [];
          if (this.waiters.length) this.waiters.shift()(reply); else this.replies.push(reply);
        }
      }
    };
    socket.on('data', this.onData);
  }
  async response() {
    let timer;
    try {
      return await Promise.race([
        this.replies.length ? Promise.resolve(this.replies.shift()) : new Promise(resolve => this.waiters.push(resolve)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('SMTP response timeout')), 15_000); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  async command(value, expected) {
    this.socket.write(value + '\r\n');
    const reply = await this.response();
    assert.equal(reply.code, expected, reply.text);
    return reply;
  }
}

const rawKey = readFileSync('runtime/smoke-postal.txt', 'utf8').match(/AGENTMAIL_TEST_KEY=(\S+)/)?.[1];
assert.ok(rawKey, 'Postal fixture produced a key');
const inboxKey = JSON.parse(readFileSync('runtime/smoke-inbox.json')).token;
const sendClient = new AgentMail({ url: 'http://127.0.0.1:5000', sendKey: rawKey });
const inbox = new AgentMail({ url: 'http://127.0.0.1:8025', inboxKey });
const sent = await sendClient.send({ from: 'assistant@inbound.example.com', to: ['developer@example.net'], subject: 'Held integration message', text: 'This should remain held in the test mail server.' });
assert.ok(sent.message_id);
assert.ok(sent.messages['developer@example.net'].id);

let socket = connect({ host: '127.0.0.1', port: 25 });
socket.on('error', error => { throw error; });
let smtp = new SMTP(socket);
assert.equal((await smtp.response()).code, 220);
assert.match((await smtp.command('EHLO localhost', 250)).text, /STARTTLS/);
await smtp.command('STARTTLS', 220);
socket.off('data', smtp.onData);
socket = tlsConnect({ socket, rejectUnauthorized: false }); // Disposable self-signed test certificate.
await once(socket, 'secureConnect');
assert.ok(socket.getProtocol());
smtp = new SMTP(socket);
await smtp.command('EHLO localhost', 250);
await smtp.command('MAIL FROM:<sender@example.net>', 250);
const relay = await smtp.command('RCPT TO:<someone@external.example.org>', 530);
assert.ok(relay.code >= 500, 'Unauthenticated external relay rejected');
await smtp.command('RSET', 250);
await smtp.command('MAIL FROM:<sender@example.net>', 250);
await smtp.command('RCPT TO:<assistant@inbound.example.com>', 250);
await smtp.command('DATA', 354);
await smtp.command('From: Sender <sender@example.net>\r\nTo: assistant@inbound.example.com\r\nSubject: Integration inbound\r\nMessage-ID: <ci-inbound@example.net>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello from the SMTP integration test.\r\n.', 250);
await smtp.command('QUIT', 221);
socket.end();

let received;
for (let attempt = 0; attempt < 45; attempt++) {
  const page = await inbox.messages();
  if (page.data.length) { received = await inbox.message(page.data[0].id); break; }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
assert.ok(received, 'SMTP message arrived through Postal signed HTTP delivery');
assert.equal(received.message.subject, 'Integration inbound');
assert.match(received.message.plain_body, /Hello from the SMTP/);
await inbox.acknowledge(received.id);
assert.equal((await inbox.messages({ unacked: true })).data.length, 0);
console.log('Real Postal API send, SMTP STARTTLS, relay rejection, signed inbox delivery and acknowledgement passed.');
