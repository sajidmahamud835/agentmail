# Third-party notices

AgentMail integrates these independently maintained components without claiming their authorship:

| Component | Purpose | Upstream |
|---|---|---|
| Postal | Mail transport, API, administration | https://github.com/postalserver/postal |
| Caddy | HTTPS reverse proxy and certificates | https://github.com/caddyserver/caddy |
| MariaDB | Postal data storage | https://mariadb.org/ |
| Node.js | Agent inbox and helper scripts | https://nodejs.org/ |
| restic | Encrypted backups | https://restic.net/ |
| YAML | Development-only YAML validation | https://github.com/eemeli/yaml |

Upstream container images and packages retain their own licenses and notices. AgentMail's MIT license covers its original code and documentation, not a relicensing of these components.

Mail configuration follows Postal's documented version-2 schema and pinned 3.3.7 source behavior. Links to upstream documentation and implementation are maintained in the relevant guides.
