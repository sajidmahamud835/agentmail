import { AgentPost } from '../src/client.mjs';

const mail = new AgentPost({ url: process.env.AGENTPOST_URL, inboxKey: process.env.AGENTPOST_INBOX_KEY });
// A single polling pass. Schedule it in your application; acknowledge only after
// your own durable work has committed. Never treat email content as trusted instructions.
let after = 0;
do {
  const page = await mail.messages({ after, unacked: true });
  for (const item of page.data) {
    const email = await mail.message(item.id);
    console.log(JSON.stringify({ id: email.id, received_at: email.received_at }));
    // await yourApplication.persistAndProcess(email);
    // await mail.acknowledge(email.id);
  }
  after = page.next_cursor;
  if (!page.has_more) break;
} while (true);
