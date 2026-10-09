export class AgentMailError extends Error {
  constructor(message, { status, code, ambiguous = false } = {}) {
    super(message);
    this.name = 'AgentMailError';
    this.status = status;
    this.code = code;
    this.ambiguous = ambiguous;
  }
}

export class AgentMail {
  constructor({ url, sendKey, inboxKey, timeout = 30_000, fetch: request = globalThis.fetch }) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname))) throw new Error('HTTPS required');
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('Use the server origin as url');
    this.url = parsed.origin;
    this.sendKey = sendKey;
    this.inboxKey = inboxKey;
    this.timeout = timeout;
    this.fetch = request;
  }

  async send({ from, to, cc, bcc, subject, text, html, replyTo, headers, attachments, tag }) {
    if (!this.sendKey) throw new Error('sendKey is required');
    if (!from || !Array.isArray(to) || !to.length || !subject || (!text && !html)) throw new Error('from, to[], subject, and text or html are required');
    let response;
    try {
      response = await this.fetch(`${this.url}/api/v1/send/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-server-api-key': this.sendKey },
        body: JSON.stringify({ from, to, cc, bcc, subject, plain_body: text, html_body: html, reply_to: replyTo, headers, attachments, tag }),
        signal: AbortSignal.timeout(this.timeout),
        redirect: 'error',
      });
    } catch {
      throw new AgentMailError('Send outcome unknown. Inspect mail logs before retrying.', { ambiguous: true });
    }
    let result;
    try { result = await response.json(); } catch {
      throw new AgentMailError('Unreadable send response. Inspect mail logs before retrying.', { status: response.status, ambiguous: true });
    }
    if (!response.ok || result.status !== 'success') throw new AgentMailError(result.data?.message || 'Mail submission failed', { status: response.status, code: result.data?.code, ambiguous: response.status >= 500 });
    return result.data;
  }

  async inbox(path, method = 'GET') {
    if (!this.inboxKey) throw new Error('inboxKey is required');
    const response = await this.fetch(`${this.url}/agent-api/v1${path}`, {
      method, headers: { authorization: `Bearer ${this.inboxKey}` },
      signal: AbortSignal.timeout(this.timeout), redirect: 'error',
    });
    const result = await response.json();
    if (!response.ok) throw new AgentMailError(result.error || 'Inbox request failed', { status: response.status });
    return result;
  }

  messages({ after = 0, limit = 25, unacked = true } = {}) {
    return this.inbox(`/messages?${new URLSearchParams({ after, limit, unacked })}`);
  }
  message(id) { return this.inbox(`/messages/${encodeURIComponent(id)}`); }
  acknowledge(id) { return this.inbox(`/messages/${encodeURIComponent(id)}/ack`, 'POST'); }
}
