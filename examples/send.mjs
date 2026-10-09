import { AgentMail } from '../src/client.mjs';

const mail = new AgentMail({ url: process.env.AGENTMAIL_URL, sendKey: process.env.AGENTMAIL_SEND_KEY });
const result = await mail.send({
  from: process.env.MAIL_FROM,
  to: [process.env.MAIL_TO],
  subject: 'Hello from AgentMail',
  text: 'Your agent email connection is working.',
  tag: 'connection-test',
});
console.log(JSON.stringify(result, null, 2));
