import { randomBytes, generateKeyPairSync, createPublicKey, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, chownSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const secret = bytes => randomBytes(bytes).toString('hex');
const own = (path, mode, uid) => {
  chmodSync(path, mode);
  if (process.platform === 'linux' && process.getuid() === 0 && uid !== undefined) chownSync(path, uid, uid);
};
export function readEnv(file) {
  const env = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = line.match(/^([A-Z][A-Z0-9_]*)=([^\r\n]*)$/);
    if (!match || !/^[A-Za-z0-9._:@/+%=-]*$/.test(match[2])) throw new Error('Invalid .env line: use unquoted simple values, without shell expressions');
    if (Object.hasOwn(env, match[1])) throw new Error(`Duplicate setting: ${match[1]}`);
    env[match[1]] = match[2];
  }
  return env;
}
export function atomicWrite(file, value, mode = 0o600, uid) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp-${secret(6)}`;
  writeFileSync(temp, value, { mode });
  own(temp, mode, uid);
  renameSync(temp, file);
}
function saveEnv(file, env) {
  atomicWrite(file, Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
}
const hostnameValid = value => typeof value === 'string' && value.length <= 253 && value.includes('.') &&
  value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));

export function configure(root) {
  const envFile = resolve(root, '.env');
  if (!existsSync(envFile)) throw new Error('Copy .env.example to .env and set MAIL_HOSTNAME, ACME_EMAIL, PUBLIC_IPV4 first');
  const env = readEnv(envFile);
  if (!hostnameValid(env.MAIL_HOSTNAME)) throw new Error('MAIL_HOSTNAME must be a lowercase fully-qualified hostname');
  if (!/^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(env.ACME_EMAIL || '')) throw new Error('ACME_EMAIL must be an email address');
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(env.PUBLIC_IPV4 || '') || env.PUBLIC_IPV4.split('.').some(part => Number(part) > 255)) throw new Error('PUBLIC_IPV4 must be an IPv4 address');
  if (!['true', 'false'].includes(env.SMTP_TLS_ENABLED || 'false')) throw new Error('Invalid SMTP_TLS_ENABLED');
  const existingInstallation = existsSync(resolve(root, 'runtime/initialized')) || existsSync(resolve(root, 'runtime/database'));
  for (const [key, length] of [['DB_ROOT_PASSWORD', 32], ['DB_POSTAL_PASSWORD', 32], ['RAILS_SECRET_KEY', 64]]) {
    if (!env[key] && existingInstallation) throw new Error(`${key} is missing on an existing installation; recover the original .env from backup`);
    env[key] ||= secret(length);
    if (!/^[a-f0-9]{64,}$/.test(env[key])) throw new Error(`${key} must be at least 64 lowercase hex characters`);
  }
  env.SMTP_TLS_ENABLED ||= 'false';
  env.ADMIN_FROM_ADDRESS ||= env.ACME_EMAIL;
  for (const [folder, uid] of [['postal', 999], ['inbox-config', 1000], ['inbox', 1000], ['database-init', 999], ['caddy/data', undefined], ['caddy/config', undefined]]) {
    const path = resolve(root, 'runtime', folder);
    mkdirSync(path, { recursive: true });
    own(path, 0o750, uid);
  }
  const keyFile = resolve(root, 'runtime/postal/signing.key');
  if (!existsSync(keyFile)) {
    if (existingInstallation) throw new Error('Signing key is missing on an existing installation; restore it from backup');
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    atomicWrite(keyFile, privateKey, 0o640, 999);
  }
  const publicKey = createPublicKey(readFileSync(keyFile)).export({ type: 'spki', format: 'pem' });
  atomicWrite(resolve(root, 'runtime/inbox-config/signing.pub'), publicKey, 0o640, 1000);
  const inboxFile = resolve(root, 'runtime/inbox-config/inboxes.json');
  if (!existsSync(inboxFile)) atomicWrite(inboxFile, '{"inboxes":[]}\n', 0o640, 1000);
  const h = env.MAIL_HOSTNAME;
  // JSON is a valid YAML scalar encoding, keeping operator strings out of YAML syntax.
  const q = JSON.stringify;
  const postal = `version: 2
postal:
  web_hostname: ${q(h)}
  web_protocol: https
  smtp_hostname: ${q(h)}
  signing_key_path: /config/signing.key
  allowed_request_destinations: ["127.0.0.1"]
web_server:
  default_bind_address: 127.0.0.1
  default_port: 5000
main_db:
  host: 127.0.0.1
  username: postal
  password: ${q(env.DB_POSTAL_PASSWORD)}
  database: postal
message_db:
  host: 127.0.0.1
  username: postal
  password: ${q(env.DB_POSTAL_PASSWORD)}
  database_name_prefix: postal
smtp_server:
  default_bind_address: 0.0.0.0
  default_port: 25
  max_message_size: 10
  tls_enabled: ${env.SMTP_TLS_ENABLED}
  tls_certificate_path: /config/smtp.cert
  tls_private_key_path: /config/smtp.key
dns:
  mx_records: [${q(h)}]
  spf_include: ${q('spf.' + h)}
  return_path_domain: ${q('rp.' + h)}
  route_domain: ${q('routes.' + h)}
  track_domain: ${q('track.' + h)}
  helo_hostname: ${q(h)}
smtp:
  host: 127.0.0.1
  port: 25
  username: ${q(env.ADMIN_SMTP_USERNAME || '')}
  password: ${q(env.ADMIN_SMTP_PASSWORD || '')}
  from_name: AgentMail
  from_address: ${q(env.ADMIN_FROM_ADDRESS)}
  enable_starttls_auto: true
rails:
  secret_key: ${q(env.RAILS_SECRET_KEY)}
`;
  atomicWrite(resolve(root, 'runtime/postal/postal.yml'), postal, 0o640, 999);
  const sql = `CREATE USER IF NOT EXISTS 'postal'@'%' IDENTIFIED BY '${env.DB_POSTAL_PASSWORD}';
GRANT ALL PRIVILEGES ON \`postal\`.* TO 'postal'@'%';
GRANT ALL PRIVILEGES ON \`postal-%\`.* TO 'postal'@'%';
FLUSH PRIVILEGES;\n`;
  atomicWrite(resolve(root, 'runtime/database-init/01-postal.sql'), sql, 0o640, 999);
  // Do not proxy /postal/inbound publicly. Host-network workers reach loopback directly.
  atomicWrite(resolve(root, 'runtime/Caddyfile'), `{
  email ${env.ACME_EMAIL}
  admin 127.0.0.1:2019
}
${h} {
  encode zstd gzip
  header {
    X-Content-Type-Options nosniff
    Referrer-Policy same-origin
    -Server
  }
  handle /postal/* {
    respond 404
  }
  handle /agent-api/* {
    reverse_proxy 127.0.0.1:8025
  }
  handle {
    reverse_proxy 127.0.0.1:5000
  }
}
`, 0o644);
  saveEnv(envFile, env);
  return env;
}

export function manageInbox(root, command, id, address) {
  const file = resolve(root, 'runtime/inbox-config/inboxes.json');
  const config = JSON.parse(readFileSync(file, 'utf8'));
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(id || '')) throw new Error('Use a short lowercase inbox id');
  const box = config.inboxes.find(item => item.id === id);
  if (command === 'revoke') {
    if (!box) throw new Error('Inbox not found');
    config.inboxes = config.inboxes.filter(item => item.id !== id);
    atomicWrite(file, JSON.stringify(config, null, 2) + '\n', 0o640, 1000);
    return { id, revoked: true };
  }
  if (command === 'add') {
    if (box) throw new Error('Inbox id already exists');
    if (!/^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(address || '')) throw new Error('Invalid inbox email address');
    if (config.inboxes.some(item => item.addresses.some(value => value.toLowerCase() === address.toLowerCase()))) throw new Error('Address already assigned');
  } else if (command !== 'rotate' || !box) throw new Error('Use add, rotate, or revoke');
  const token = 'ap_in_' + secret(32);
  const token_hash = createHash('sha256').update(token).digest('hex');
  if (box) box.token_hash = token_hash;
  else config.inboxes.push({ id, addresses: [address.toLowerCase()], token_hash });
  atomicWrite(file, JSON.stringify(config, null, 2) + '\n', 0o640, 1000);
  return { id, token, note: 'Save this token now. Only its hash is stored.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const root = process.env.AGENTMAIL_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const [command = 'configure', ...args] = process.argv.slice(2);
    if (command === 'configure') { configure(root); console.log('Configuration generated; existing secrets preserved.'); }
    else if (command === 'get') {
      const value = readEnv(resolve(root, '.env'))[args[0]];
      if (value === undefined) throw new Error('Unknown setting');
      console.log(value);
    } else if (command === 'tls-enable') {
      const file = resolve(root, '.env'), env = readEnv(file);
      env.SMTP_TLS_ENABLED = 'true'; saveEnv(file, env); configure(root);
    } else if (command === 'inbox') console.log(JSON.stringify(manageInbox(root, ...args), null, 2));
    else throw new Error('Unknown command');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
