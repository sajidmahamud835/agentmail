import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';
import { configure, manageInbox, readEnv } from '../scripts/configure.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'agentpost-config-'));
  t.after(() => rmSync(root, { recursive: true }));
  writeFileSync(join(root, '.env'), 'MAIL_HOSTNAME=mail.example.com\nACME_EMAIL=admin@example.com\nPUBLIC_IPV4=203.0.113.10\n');
  return root;
}

test('configuration reruns preserve secrets, keys, inboxes and valid YAML', t => {
  const root = fixture(t);
  const first = configure(root);
  const key = readFileSync(join(root, 'runtime/postal/signing.key'), 'utf8');
  const inbox = manageInbox(root, 'add', 'assistant', 'assistant@example.com');
  const second = configure(root);
  assert.deepEqual(first, second);
  assert.equal(readFileSync(join(root, 'runtime/postal/signing.key'), 'utf8'), key);
  const postal = YAML.parse(readFileSync(join(root, 'runtime/postal/postal.yml'), 'utf8'));
  assert.equal(postal.main_db.password, first.DB_POSTAL_PASSWORD);
  assert.equal(postal.message_db.database_name_prefix, 'postal');
  assert.equal(postal.smtp_server.tls_enabled, false);
  const boxes = JSON.parse(readFileSync(join(root, 'runtime/inbox-config/inboxes.json')));
  assert.equal(boxes.inboxes.length, 1);
  assert.ok(!JSON.stringify(boxes).includes(inbox.token));
  assert.match(readFileSync(join(root, 'runtime/database-init/01-postal.sql'), 'utf8'), /`postal-%`/);
});

test('configuration treats dotenv as data, rejects injection and invalid hostnames', t => {
  const root = fixture(t);
  writeFileSync(join(root, '.env'), 'MAIL_HOSTNAME=$(touch /tmp/unwanted)\n');
  assert.throws(() => readEnv(join(root, '.env')), /Invalid/);
  writeFileSync(join(root, '.env'), 'MAIL_HOSTNAME=mail.example.com\nMAIL_HOSTNAME=evil.example.com\n');
  assert.throws(() => readEnv(join(root, '.env')), /Duplicate/);
  writeFileSync(join(root, '.env'), 'MAIL_HOSTNAME=-bad.example.com\n');
  assert.throws(() => configure(root), /hostname/);
});

test('inbox management prevents duplicates, rotates and revokes credentials', t => {
  const root = fixture(t); configure(root);
  const first = manageInbox(root, 'add', 'assistant', 'assistant@example.com');
  assert.throws(() => manageInbox(root, 'add', 'assistant', 'other@example.com'), /exists/);
  assert.throws(() => manageInbox(root, 'add', 'other', 'ASSISTANT@example.com'), /assigned/);
  assert.notEqual(manageInbox(root, 'rotate', 'assistant').token, first.token);
  assert.equal(manageInbox(root, 'revoke', 'assistant').revoked, true);
  assert.throws(() => manageInbox(root, 'rotate', 'assistant'));
});
