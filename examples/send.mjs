import { AgentPost } from '../src/client.mjs';

const mail = new AgentPost({ url: process.env.AGENTPOST_URL, sendKey: process.env.AGENTPOST_SEND_KEY });
const result = await mail.send({
  from: process.env.MAIL_FROM,
  to: [process.env.MAIL_TO],
  subject: 'Hello from AgentPost',
  text: 'Your agent email connection is working.',
  tag: 'connection-test',
});
console.log(JSON.stringify(result, null, 2));
