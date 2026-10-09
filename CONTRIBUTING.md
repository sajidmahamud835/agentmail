# Contributing

Use a branch and a pull request. Keep deployment changes compatible with the documented Ubuntu target and pinned Postal version. Add behavioral tests for authorization, delivery persistence, or recovery changes.

Run `npm ci`, `npm test`, and `npm run check`. CI additionally runs ShellCheck and a Docker integration smoke test. Never use production credentials or real customer mail in tests. Run Docker integration only on an isolated Linux machine: it binds mail ports and creates disposable databases.

Document changes to DNS, backup format, configuration, and upgrade requirements. Keep examples generic. Do not commit `.env`, `runtime/`, private keys, message payloads, or private infrastructure details.

Generated configuration is intentionally recreated from `.env`; edit the generator rather than patching generated `runtime/postal/postal.yml`. Changes to Postal itself belong upstream and must preserve its attribution and license.
