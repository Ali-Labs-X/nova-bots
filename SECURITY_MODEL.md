# Nova Bots security model

The threat model that security reviews and scans of this repository start from. Infrastructure is `docker/` and `docker-compose.yml` in this repository.

## System overview and trust boundaries

Nova Bots is a team of long-lived LLM Bots built as a plugin on DeepSeek Harness (DSH). It runs in three ways:

- **DSH Desktop / DSH Web** with the `ds-bot` plugin, on the user's own computer.
- **Desktop app** (`app/`, Electron) that runs a pinned DSH with the plugin in its own `DSH_HOME`, and imports a team from `~/.dsh` (read only).
- **Docker** (`docker/`, `docker-compose.yml`): `dsh web` on `0.0.0.0:3080` (published as `0.0.0.0:13080`), `DSH_PERMISSION_MODE=danger-full-access`, approval `never`. The container is the sandbox boundary.

Trust boundaries:
1. Untrusted content -> model -> Bot tools. Web pages, files, search results, connector/MCP results and messages from other Bots reach the model; the model's tool calls run with the Bot's permission preset.
2. Ordinary Bot -> Main Bot rights (create/change/stop Bots, groups, folders), enforced in `ds-bot/src/host/tools.js` via `rt.isMain`.
3. Model/tool output -> outbound model requests (secret redaction in `ds-bot/src/host/secrets.js`).
4. Browser renderer -> host: `POST /api/bot` channel (`ds-bot/src/host/channel.js`, `ROUTE` in `constants.js`) and Electron IPC (`app/src/main.mjs`, `preload.cjs`).
5. Bot-produced HTML widgets -> app page (`ds-bot/src/client/widget-html.js`, `sandbox="allow-scripts"` iframe without same-origin).
6. Bot browser pages -> app (`app/src/bot-browser.mjs`, `bot-views.mjs`: sandboxed, contextIsolation, own partition).
7. **Tenant -> tenant** (hosted edition, `NOVA_TENANCY=isolated`): one account's engine, Bots, files, memory, provider keys and browser session must never be observable or affectable by another account. See [Tenant isolation](#tenant-isolation-hosted-edition).
8. **Browser -> portal -> engine** (hosted edition): the portal session (`access_token`, HMAC-signed JWT) is the sole authority; engine cookies are minted and held by the portal and never reach a browser.

## Components

- **host** — plugin server side: `ds-bot/index.js`, `ds-bot/src/host/` (roster, tools, turns/delivery, groups, parts, memory, schedules, permissions, connectors, providers).
- **secrets** — `ds-bot/src/host/secrets.js` (secrets.json mode 600, `$DSH_SECRET_<NAME>`, redactor) and API keys/providers (`providers.js`, `models.js`).
- **client** — browser UI: `ds-bot/src/client/` (incl. widget-html, read-page, connectors UI) and generated `ds-bot/client.js`.
- **browser** — Bot browser bridge and browser plugins: `ds-bot/src/host/browser.js`, `browser-plugins.js`, `src/host/browser/`, `browser-plugins/`.
- **desktop-app** — Electron app: `app/src/` (main, preload, IPC, cookie import, updates, import from `~/.dsh`, move-data), `app/engine/`.
- **web-search** — `ds-bot/web-search.js`.
- **docker** — `docker/Dockerfile`, `entrypoint.sh`, `docker.patch.yml`, `docker-compose.yml`.

## Entry points and who reaches them

- Chat input from the user (trusted).
- Content the Bot reads: web pages (Bot browser, `read_browser`, web search), files in the work folder, connector/MCP tool results, messages from other Bots and group chats, scheduled-task prompts. **Attacker-controlled.**
- `/api/bot` HTTP endpoints and DSH Web UI: the local user; in Docker, anyone who can reach port 13080 (DSH trusted-host list + launch token).
- Electron IPC from the app window.

## Assets (maintainer-ranked)

1. **Critical: API keys and Bot secrets** — provider keys, `secrets.json`, `$DSH_SECRET_*`, connector tokens; a connector token never reaches a Bot's shell. Must not leak to the model, logs, tool results, other Bots outside the secret's scope, or outbound requests.
2. **Critical: files on the user's computer** — outside the Bot's work folder; `~/.dsh` must never be written by the app.
3. Other: imported cookies / browser login state, conversations and memory.

## Attacker profiles

- **Primary (maintainer-confirmed): prompt injection** in web pages, files or messages that makes a Bot exceed its rights — exfiltrate keys/secrets, read or write user files outside its scope, gain Main Bot rights, change other Bots, bypass the permission preset or redaction.
- Lower concern (not chosen by the maintainer): LAN users reaching the Docker web UI, malicious browser plugins or connectors, a rogue ordinary Bot acting by itself.

## Existing controls

- Main-Bot checks in `tools.js` (`rt.isMain`, `rt.isAdminOf`).
- Per-Bot permission presets (`permissions.js`), set on every Session.
- Secrets: scoped per Bot (`canUse`), redacted from tool results and outbound model requests (`redactor`, JSON/URL-encoded forms).
- Connectors: each connector's credential lives in the team secret store only, and is used only in the request headers of that connector's own endpoint, built in memory at mount time. It never reaches the Nova profile, never reaches a Bot's shell, never appears in a tool result or a model request, and never reaches another connector's endpoint (`ds-bot/src/host/connectors.js`, `ds-bot/src/host/secrets.js`).
- A connector is mounted for the whole team today; its secret is stored with an empty scope and is read at mount time without a scope check (`ds-bot/src/host/connectors.js`, `ds-bot/src/host/secrets.js`). The per-Bot grant is designed but not built — see the connectors design note (`docs/plans/2026-11-12-connectors-and-catalogue.md`).
- Connectors refuse non-HTTPS addresses, and a definition's probe address and MCP address must share one registrable domain (`ds-bot/src/host/connectors.js`).
- Remote (streamable-http) MCP servers need an explicit approval, like local (stdio) ones, and only HTTPS URLs are accepted; the account label a connector probe returns is sanitised (character set and length) before it is shown (`ds-bot/src/host/capabilities.js`, `ds-bot/src/host/connectors.js`).
- HTML widgets in `sandbox="allow-scripts"` iframes; Electron webviews sandboxed with contextIsolation and own partitions; IPC handlers call `assertWindow(event)`.
- Cookie values stay in the Electron main process (`cookie-import.mjs`).
- Launch token redacted from host logs (`host-process.mjs`).

## Out of scope / accepted risk (maintainer)

- **Docker edition: Bots have full access inside the container by design** (`danger-full-access`, approval `never`). A Bot changing or reading files inside the container is not a finding; escaping the container or leaking keys/secrets still is.
- DSH itself is upstream; not explicitly ruled out, but fixes belong upstream (hard rule: never patch DSH).

## Tenant isolation (hosted edition)

The hosted portal (`portal/`) can run every account in its own engine
(`NOVA_TENANCY=isolated`). The design assumes **each tenant fully controls its
own engine process** (the Bots have full access inside their container and can
change the engine's code), so a tenant's engine is treated as hostile to every
other tenant and to the portal.

| Layer | Control | Where |
|---|---|---|
| Routing | Every request and WebSocket upgrade is routed from the portal session, re-checked per request (forbidden / revoked / token version), to that account's own tenant only. No request parameter, header or cookie can select an engine. | `gate.mjs` (`routeFor` -> `own-tenant`), `server.mjs` |
| Engine cookies | Minted server-side per engine and per Host, kept in portal memory, never sent to a browser. Every `dsh-auth-*` cookie a browser presents is stripped and deleted; engine `Set-Cookie` for `dsh-auth-*` or `access_token` is dropped. Each engine's cookie key lives in its own volume, so a cookie of A is rejected by B (HTTP 401, WS 401). | `bridge.mjs` |
| Nothing secret forwarded | The portal session cookie, `Authorization` and the admin token header are removed before a request reaches an engine. | `bridge.mjs` |
| Sessions | HS256 = HMAC-SHA256 keyed with `NOVA_JWT_SECRET` (min. 16 chars). Revoke / forbid / password change also close the account's open WebSockets. | `auth.mjs`, `admin.mjs` |
| Container | `nova-bots-t-<tenant>` from `nova-bots:local`; `--cap-drop ALL` + `CHOWN,SETUID,SETGID,DAC_OVERRIDE` (needed by the entrypoint to hand `/data` to `node` and drop to it); `no-new-privileges` (also disables sudo); `BOT_ROOT=0`; cpu / memory (no swap) / pids limits; json-file logs with rotation; no docker socket; no host folder; no `host-gateway` alias; labels `nova-bots.tenant=<id>`. | `tenants.mjs` (`containerArgs`) |
| Storage | Two named volumes per tenant (`…-data` for `/data` = DSH_HOME, `…-data-work` for `/workspace`); never shared. | `tenants.mjs` |
| Launch token | Generated by the tenant's own engine on each start inside its own volume; read by the portal through `docker exec`, kept in memory only; never logged. | `tenants.mjs` |
| Network | One bridge (`nova-bots-tenants`, interface `nb-tenants`) with inter-container traffic disabled: tenants cannot reach each other. Published port bound to `127.0.0.1` only. **Host services** reachable through the gateway (anything on `0.0.0.0` or a docker bridge address) and private LAN ranges are closed by `ops/tenant-firewall.sh` (required before enabling, needs root; boot unit `ops/nova-bots-tenant-firewall.service`). DNS goes only to explicit public resolvers (`--dns`, `NOVA_TENANT_DNS`), allowed on port 53 ahead of the private-range drop, so tenants never use the LAN router as a resolver. | `tenants.mjs`, `ops/tenant-firewall.sh` |
| Provider keys | Tenants do not inherit the operator's keys (no `env_file`, explicit env only). A tenant brings its own key in its own Settings -> Models, or the operator assigns one per tenant via the admin API; assigned keys are sealed with AES-256-GCM (`NOVA_TENANT_SECRET_KEY`), passed to `docker create` through a 0600 env file that is deleted right after, and only names in `NOVA_TENANT_KEY_ENVS` are accepted. | `tenants.mjs`, `admin.mjs` |
| Resources | Idle stop after `NOVA_TENANT_IDLE_MINUTES` (no open live feed); hard cap `NOVA_TENANT_MAX_RUNNING` (LRU idle tenant is stopped to make room, otherwise "busy" page); `NOVA_TENANT_MAX_TOTAL`. | `tenants.mjs` |
| Audit | Allocation, provisioning, start, stop (with reason), recreate, key assign/clear (names only), limits, delete/export, backfill, admin actions. | `audit_log` |

Residual risks and accepted limits:

- **Kernel / container escape** is the boundary: tenants share the host kernel.
  A container escape compromises every tenant. Mitigations: dropped
  capabilities, `no-new-privileges`, default seccomp and AppArmor profiles,
  rootless-ish user (`node`) for the engine; a stronger runtime (gVisor
  `runsc`, Kata) is the next step if untrusted sign-ups grow.
- **Disk** is not quota-limited per volume (the local volume driver has no
  quota on ext4); the admin API shows usage and the operator can delete.
- **Same origin**: every tenant's engine UI is served from the same origin as
  the portal. A tenant can make its own engine serve arbitrary script, but the
  portal only ever routes an account to its own engine, so that script only
  runs in its own author's browser session. Do not add routes that serve one
  tenant's content to another account.
- **Egress** to the internet is open (the Bots need their providers and the
  web). Abuse handling is operational (forbid the account; its engine stops).
- The admin's tenant is the pre-tenancy shared engine (`nova-bots`, mapped as
  `legacy`): it still mounts `/host` (the operator's Desktop) and holds the
  operator's keys. It is reachable only by the admin account.

## Open questions

- Is the Docker web UI expected to be reachable only on a trusted LAN?
- Hosted edition: should untrusted public sign-ups run on gVisor (`--runtime runsc`) by default?
- Should a secret scoped to one Bot be treated as hidden from Main Bots too?
