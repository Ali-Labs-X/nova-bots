# Connectors and the connector catalogue

- Date: 2026-11-12
- Related: no tracker issue yet for this feature; [Browser, web search, secrets and connectors](2026-10-08-browser-and-secrets.md) — its connector section will be rewritten, after Jahanzaib's OK

## Why

- The Connectors page shows one row, GitHub, because the connector is a hardcoded GitHub block in
  the code: `ds-bot/src/host/connectors.js` carries the id `github`, the secret `GITHUB_TOKEN`, the
  endpoint `https://api.githubcopilot.com/mcp/`, an identity probe against `api.github.com/user`,
  a mount that sends `Authorization` and `X-MCP-Toolsets`, a `known(id)` guard that throws for
  anything else, and a `connectorsView()` that returns a one-element array. The client is GitHub
  too: `ds-bot/src/client/connectors.js` has one icon, one `ABOUT` line, one PAT link, one
  `t('GitHub token')` field.
- What the user asked for is not "one more service" but a **visible library**: what a Bot can
  reach, whether it needs an account, whether it needs a card, what the free tier really gives,
  and whether it can be self-hosted. With one hardcoded service, that library does not exist.
- So two decisions: a connector becomes a **data-driven definition**, granted per Bot like a
  capability; and the library gets an **honest catalogue** where every row states the credential,
  the cost, the licence and the version.

## Decided behaviour

### The connector definition (data model)

A service = one definition, held in a catalogue reviewed in our own repository (not in the user's
data). Fields:

- `id`: lower case with hyphens, unique, at most 32 characters, and not the same as a capability's name (the tool namespace `mcp__<id>__` would collide).
- `name`: the display name. `about`: one line of description. `icon`: the icon; the first letter is used when none can be fetched.
- `secretName`: the secret this connector uses, validated against `SECRET_NAME` (`secrets.js:13`), named `<SERVICE>_<THING>` (for example `GITLAB_TOKEN`, `SLACK_TOKEN`, `PG_PASSWORD`). **One secret per connector.**
- `url`: the MCP endpoint. `headers`: request headers whose values are **references** such as `$NOVA_SECRET_<name>`, never values. `extraHeaders`: the service's own extra headers.
- `probe`: an optional connectivity/identity probe `{ url, headers, accountPath }`. Without a `probe`, only the mount result itself is looked at.
- `fields`: the fields the connect form asks for, `[{ key, label, secret }]`; a field with `secret: true` uses a masked input.
- `authKind`: `none | token | oauth | account`. `category`: the catalogue category.
- `licence`, `selfHostable`, `freeTier`, `paid`, `version`, `verifiedOn`: the fields the catalogue page shows; `docsUrl`, `docsLabel`: where to get the credential.

### Mounting: granted per Bot

- A connector is mounted **per Bot**, exactly like a capability: **a Bot without the grant does not see the tools**. The credential itself is never granted to a Bot — it keeps an empty scope (`scope: []`), and the host injects it into that connector's own request headers at mount time (`capabilities.js:283-284`, the `env` and `headers` maps built from the secret references).
- This **changes today's GitHub behaviour** (today it is mounted for the whole team and the token is read with `rt.secretValue`, `secrets.js:581`, without a scope check) and takes effect only with the maintainer's explicit OK.
- Each connector's tools are named `mcp__<id>__<tool>`; every Bot mounts its own, and they do not affect each other.

### Secrets

- The value comes only from the user's input, is stored in `bot/secrets.json`, and appears only in the MCP request headers sent to that service; the headers are built in memory and are never written into the runtime profile.
- A connector **does not put its secret into any Bot's shell**; the user can open that up themselves on the Secrets page.
- A connector adds, deletes and renames nobody else's secret; the secret name comes from the definition.
- Each connector's credential exists in exactly one place — the team secret store — and is used in exactly one place: the request headers of that connector's own endpoint, built in memory at mount time. It never reaches the Nova profile, never reaches any Bot's shell, never appears in a tool result or a model request, and never reaches another connector's endpoint.

### The connect flow

- The form is rendered from `fields`, with one generic implementation; a service without fields needs no form.
- On connect the `probe` runs first (if there is one): the credential asks the service once, and the field named by `accountPath` becomes the account name. The account name is **filtered before it is shown**: the length is capped, control characters and look-alike control characters are removed, and it may not impersonate another account.
- The account name's legal shape is `/^[A-Za-z0-9._-]+$/`, at most 64 characters, no angle brackets, no control characters. **If it is invalid as a whole (all symbols, or empty after filtering) the connection is rejected**, the error names the service, nothing is stored and nothing is mounted.
- The probe is not the criterion for a successful connection — the mount decides. When the probe fails but the service works, the connection is reported as failed and the probe step is named.
- Deleting the secret = disconnecting.

### The page Settings → Connectors

- **Every catalogue entry is listed**, connected or not; the state is one of "not connected / connecting / connected / failed".
- The page does not repeat the licence, the price and the install steps — those live in `docs/connectors.md`.
- **Adding a service does not change the client**: the definition lives on the host, the icon falls back to the first letter, and the form is rendered from `fields`.

### Configuration

- `rt.config.connectors` is a **map keyed by id** (`{ github: false }` keeps working); `false` means that connector is not installed.

### The catalogue documents

- `docs/connectors.md` (English) + `docs/connectors/<service>.md`: the table columns map straight onto the fields of the definition above, so **the table and the code cannot drift apart**.
- The table has nine columns: service, category, what it is for, credential, self-hostable, free tier, paid, licence, version/date. Every price carries its source and its date; when it cannot be read, it says `unverified`.
- A service that needs a card or a paid account is marked `needs a card`, and **is not sorted first among its category**.
- Order within a category: keyless local → self-hosted → free hosted → paid.

### Tranches

- **Tranche 1**: token connectors only (`authKind: token` or `account`), plus the keyless
  remote servers that need no credential at all (`authKind: none`). OAuth (Gmail, Notion, a
  Slack app) needs a browser consent page and waits for tranche 3.
- **The five keyless remote servers**, measured to complete the MCP handshake from the
  engine container with no credential: DeepWiki (`https://mcp.deepwiki.com/mcp`, 3 tools),
  Context7 (`https://mcp.context7.com/mcp`, 2 tools, a real keyless tool call was measured
  working), Exa (`https://mcp.exa.ai/mcp`, 2 tools), Firecrawl (`https://mcp.firecrawl.dev/mcp`,
  3 tools) and Hugging Face (`https://hf.co/mcp`, 4 tools). They are the first rows of
  tranche 1 because they need no account and no card.
- **Tranche 2**: local stdio connectors, **approved like a local capability and never started automatically**; only pure JS / pure Python services, because the engine image has no `sqlite3`, `psql`, `soffice`, `pandoc` or `tesseract`.
- **Tranche 3**: OAuth connectors.
- A stdio connector's credential arrives only through the explicit `env` / `headers` map as a secret reference, never ambient and never on the command line where `ps` would show it (rule R12). A service that takes its DSN as `process.argv[0]` — `@modelcontextprotocol/server-postgres` — is therefore not mounted as a stdio server with a real credential.

### Credential-free services are still an approval

- **A credential-free service is still an approval.** A remote MCP needs the user's approval
  whatever its credential situation; "no credential" describes the credential, not the trust
  decision (rule R7). The address must be https and is vetted like every other endpoint (rule
  R5). The user picks the service, sees exactly which host it will talk to, approves it once, and
  only then does it mount; the approval is revocable and the mount gate refuses an unapproved
  server.
- **A catalogue row says who receives the traffic.** For a hosted service the row states the host
  the Bot's requests go to, so the user can see where their content leaves the machine before
  approving. This is the same fact R5 needs — the probe address and the MCP address share one
  registrable domain, one vendor — and the row is where a human reads it.
- **The five keyless servers are not self-hosted and not free of consequence.** They are hosted
  third-party endpoints, measured to complete the MCP handshake from the engine container with no
  credential (one real keyless tool call works on Context7). A row for one is verified as
  *reachable and credential-free*; it is not a claim about licence, privacy or data handling, so
  any unverified field stays `unverified` — the same rule the GitLab rows follow.

### The two fixes that come first

- A streamable-http capability: an address that is not `https:` is refused outright; `approved: true` is no longer the default (fix `a99dbea4`).
- The account name a probe returns is filtered before it is shown (see above) (fix `b498b2bd`).

### Credential handling per service

- R12 states the rule; the wiring it means is `env: { GITHUB_PERSONAL_ACCESS_TOKEN:
  "$NOVA_SECRET_GITHUB_TOKEN" }` — the value is a reference, resolved per Bot at mount time, and
  the value never leaves the secret store.
- A credential on the command line is refused: `@modelcontextprotocol/server-postgres` takes its
  DSN as `process.argv` and a DSN carries the password, so it is not mounted with a real
  credential until the DSN travels by env, or we use a remote Postgres MCP.

### Decisions added after that draft

Rulings taken after the data-model draft was written; each one is binding.

- Mounting has a 15-second ceiling and a stalled set (copied from `capabilities.js:352` and `:404-419`), and the number of servers per Bot is capped — N bots × M connectors would be N×M live MCP sessions.
- A remote MCP whose url or headers changed must be **approved again** before it mounts, with the same semantics as a changed stdio server, implemented with the existing config-hash mechanism (`capabilities.js:309-310`) plus the approval state — not a new mechanism. A remote MCP whose url the user edited falls back to "needs approval".
- The catalogue columns map onto the definition's fields, so the reference page and the code cannot drift:

| Column | Definition field | Detail page |
|---|---|---|
| Service | name | url, icon |
| Category | category | — |
| What it does | about | — |
| Credential | authKind, secretName | fields, how the secret is stored |
| Self-hostable | selfHostable | how it runs |
| Free tier | freeTier | — |
| Paid | paid | price source and the date it was read |
| Licence | licence | — |
| Version / date | version, verifiedOn | — |

  The detail page adds: how it runs (built-in skill / local process stdio / remote endpoint
  streamable-http), install steps, the tools it exposes, how the credential is handled, flags, the
  price source, and the date the row was checked. The catalogue reference page is English
  (`docs/local-models.md` is the precedent); the Chinese lives in `README.md` / `README.zh.md` and
  in the interface strings (`ds-bot/src/client/i18n.js`, the `ZH` map).
- Catalogue writing rules: every row carries a licence and a version/date, and a cell that could
  not be read says `unverified`; a price is never stated without a source and a date; a package
  whose name does not describe what it is is flagged in the row itself; a service that needs a
  card or a paid account is marked `needs a card` and is not the first row of its category; free
  and self-hostable come first in every category.
- An entry that was not verified may appear on the reference page **only as a comparison row**: it
  must carry `licence = unverified` (and `unverified` in every other field we could not read)
  **and** a line saying *reference information, not offered as a connector*. Such a row gets no
  connector definition, is not in the registry, and does not appear on the app's Connectors page.
  Every other row is verified — licence, publisher, version/date, self-hosted or hosted, the exact
  credential it asks for, and the date it was last verified — and is a real catalogue entry.
- Licence rules: Redis (RSALv2/SSPL), MongoDB server (SSPL), n8n (fair-code) and Temporal Cloud may
  be **listed as things the user runs**; they may not be vendored into this repository (AGENTS.md
  rule 3). The npm package `markitdown` 0.0.4 is not Microsoft's tool — it converts GFL to HTML; a
  name trap like that is flagged in the row itself.
- Open, from the research below: the definition may need a **host-capability flag**, so a row can
  say "this service can ship an interactive UI; our host returns text and JSON today" without the
  catalogue promising something the runtime cannot draw. The field name is not fixed yet and
  belongs to the maintainer's decision.

### Security rules (R1–R12)

Invariant (for N connectors): each connector's credential exists in exactly one place — the team secret store — and is used in exactly one place: the request headers of that service's own endpoint, built in memory at mount time. It never reaches the Nova profile, never reaches any Bot's shell, never appears in a tool result or a model request, and never reaches another service's endpoint. "Per Bot" means which Bots see the tools; the credential itself is granted to no Bot (`scope: []`) and the host injects it into that connector's own request headers at mount time.

Each rule states where it is enforced and which test proves it. Line numbers are against `dev` (`61179955`); the two rules marked with a commit are the two current-code fixes.

| # | Rule | Enforced at | Test |
|---|---|---|---|
| R1 | The endpoint and the secret name come from the connector definition; the request body may not specify either | New registry + the `connector-connect` handler (`ds-bot/src/host/connectors.js:124-137`) | PLANNED `ds-bot/test/connectors-generic.test.js` — "the endpoint and the secret name come from the definition, not from the request" (to be written with the registry; the file does not exist yet) |
| R2 | A connector's secret is granted to no Bot (`scope: []`) | `ds-bot/src/host/connectors.js:132` (per connector) | TODAY `ds-bot/test/connectors.test.js:78` "connecting saves the token, kept out of every Bot shell, and mounts GitHub MCP; disconnecting undoes both" + `ds-bot/test/secrets.test.js:29` "scope is every Bot or a list" |
| R3 | A connector's secret never appears in any Bot's shell environment | `ds-bot/src/host/secrets.js:518-528` (`resolveEnv`) + `canUse` (`secrets.js:27-28`) | TODAY `ds-bot/test/connectors.test.js:78` "connecting saves the token, kept out of every Bot shell, and mounts GitHub MCP; disconnecting undoes both" + `ds-bot/test/secrets.test.js:144` "a card saves a key the Bot never sees, and the shell gets it" |
| R4 | The secret reaches no profile, no tool result and no log line | `ds-bot/src/host/connectors.js:132-133` (stored as a secret, never in the profile) and `connectors.js:58-60` (`redactSecrets` on every error text) | TODAY `ds-bot/test/connectors.test.js:124` "a failed MCP connection shows the error without the token, and Try again mounts again" + `ds-bot/test/secrets.test.js:307` "tool results and model requests lose the values" |
| R5 | An endpoint must be https and vetted; a definition's probe address and MCP address must share one registrable domain (one vendor) — enforced when the registry loads | `ds-bot/src/host/connectors.js:21, 44` (today, the https check) + the registry load | TODAY `ds-bot/test/connectors.test.js:162` "a GitHub address without https refuses to send the token"; PLANNED: the "probe address on another domain is refused" case lands in `ds-bot/test/connectors-generic.test.js` with the registry |
| R6 | Connectors are mounted **per Bot**, exactly like a capability — a Bot without the grant does not see the tools. The credential itself is never granted to a Bot: it keeps an empty scope, and the host injects it into that connector's own request headers at mount time | Copy `ds-bot/src/host/capabilities.js:267-285` (`secretFor` / `resolveValues` / `configFor`) — the per-Bot mount, and the in-memory injection into the `env` (`:283`) and `headers` (`:284`) maps | PLANNED `ds-bot/test/connectors-generic.test.js` — "a Bot without the grant does not see the connector's tools" (to be written with the registry) |
| R7 | A catalogue entry is a definition, not an automatic install; a remote MCP needs an explicit approval, like a local stdio one | `ds-bot/src/host/capabilities.js:114-121` (today: `approved: true` hardcoded at `:120`, `http:` accepted at `:117`) → fix `a99dbea4` | TODAY `ds-bot/test/capability-remote-mcp.test.js:90` "a remote MCP is not approved just because it was saved, and it does not mount before approval" + `:100` "a remote MCP on a plain http address is refused and nothing is saved" + `:112` "a remote MCP can be approved and then mounts" + `:125` "a remote MCP whose URL changed must be approved again before it mounts again" |
| R8 | No connector exposes a tool that would send our credential to an arbitrary address | Checked when the catalogue is built (registry build) | PLANNED catalogue lint — "no entry carries such a generic call tool" (written with the registry build) |
| R9 | An account name is filtered (character set and length) before it is shown, and it comes only from that connector's own probe | `ds-bot/src/host/connectors.js:116` + `ds-bot/src/client/connectors.js:17` → fix `b498b2bd` | TODAY `ds-bot/test/connector-account-sanitised.test.js:63` "the account name from the probe is sanitised before it is stored or shown" + `:99` "an account name that is entirely invalid is refused: no empty account, no secret, no mount" + `:116` "the account name comes from the probe, not from the request" + `:129` "a normal GitHub connection is unchanged: same row, same account label, same mounted server" |
| R10 | One connector that cannot connect does not block the others, and N connectors do not queue one Agent's startup | `ds-bot/src/host/capabilities.js:352` (mount per Agent) and `:404-419` (the 15 s limit and the stalled set) | TODAY `ds-bot/test/capabilities.test.js:337` "a hung mount releases the message after the limit and does not hold up other Bots"; PLANNED: the "one connector that cannot connect does not block the others" case lands in `ds-bot/test/connectors-generic.test.js` with the registry |
| R11 | The "get your token" link on the Connectors page comes from the vetted definition and stays on the vendor's own domain | `ds-bot/src/client/connectors.js:6, 53` (today: a hardcoded GitHub link) | PLANNED `ds-bot/test/connectors-client.test.js` — "the connect link comes from the vetted definition" (to be written with the Connectors page) |
| R12 | A stdio connector's credential arrives only through the explicit `env` / `headers` map, as a secret reference — never ambient (the runtime scrubs every `*KEY*`, `*PASSWORD*`, `*SECRET*`, `*TOKEN*` name and every `DSH_*` name before the child starts), and never on the command line, where `ps` would show it | `ds-bot/src/host/capabilities.js:7` (`SECRET_REFERENCE`), `:272-278` (`resolveValues`), `:283-284` (the stdio `env` map and the streamable-http `headers` map); the scrub lives in the runtime: `@deepseek-ai/dsh-subprocess` **0.2.1-rc.4** `lib/index.js:32, 50-52` and `@deepseek-ai/dsh-mcp-client` **0.2.1-rc.4** `lib/index.js:26-28` | PLANNED catalogue lint — "no entry puts a credential on argv" (written with the registry build) |

Three notes (decided behaviour, not new rules):

- **R2 and R6 carry the whole invariant.** The secret is created with `scope: []`, so no Bot can hold it (R2); the connector is mounted per Bot like a capability, so a Bot without the grant cannot even see the tools (R6). Today a connector is mounted for the whole team and its token is read with `rt.secretValue` (`ds-bot/src/host/secrets.js:581`, **without a scope check**) — that is how the code behaves today, not the design goal; the new framework must grant per Bot, and that needs the maintainer's explicit OK.
- **R7's approval semantics (fixed in the current-code fix):** when a remote MCP's url or headers change it goes back to `needs-approval` and the user must approve again; a non-https remote address is refused outright; a remote MCP the user saves by hand in the settings page is approved by that save.
- **R9's refusal semantics (fixed in the current-code fix):** an entirely invalid account name (all symbols, or empty after filtering) **refuses that connection**, with an error naming the service: no secret stored, no mount, no empty account shown. The filtered form is `/^[A-Za-z0-9._-]+$/`, at most 64 characters.

### Acceptance criteria

Every statement below is testable, and each one names the test file it lives in. Baseline (`dev` = `61179955`): `npm test` → 1462 tests / 1460 pass / 0 fail / 2 skipped; `ds-bot/test/connectors.test.js` → 7 assertions. Any later pull request states how the totals moved.

**One. Generic — true for every connector id (`ds-bot/test/connectors-generic.test.js`)**

1. The list shows every enabled connector in configuration order, one row per id, with no duplicate and none missing.
2. A connector configured as `false` does not appear; a removed connector disappears from the list **and** is unmounted.
3. A connector stores only its own single secret (the name comes from the definition and is validated against `SECRET_NAME`), and mounts with its own url and headers.
4. The credential appears only in the request headers sent to that connector's own service: a request to another service never carries it.
5. The credential appears in no roster, no `state.json`, no client bundle, no log line and no error message; one occurrence fails the criterion.
6. The credential is not offered to any Bot's shell (the scope stays `[]`).
7. The probe is per connector: its own identity address and its own account field; when the probe cannot answer, that row is in the failed state, names that service, and there is no credential, no secret and no mount.
8. The probe host and the MCP host share one registrable domain; a definition that breaks this is refused when the registry loads.
9. An unknown id is refused exactly as it is today (compare `ds-bot/test/connectors.test.js`).
10. Disconnect and retry touch only the connector that was named.
11. A failed mount leaves no half-mounted fiber and no secret behind.
12. Every endpoint is checked for `https:` before any credential is sent.

**Two. The client page (`ds-bot/test/connectors-client.test.js`)**

13. One row per connector, in configuration order; the state is one of not connected / connecting / connected / failed.
14. The form is rendered from the definition's `fields`: field, label and masked input all come from the definition, not from hard-coded copy.
15. The "get your token" link comes from the definition and stays on the vendor's own domain; a Gmail row must not point at GitHub.
16. A failed row carries `role="alert"`; a connecting row is only the waiting hint, with no `.bt-error` and no `role="alert"`.
17. A missing icon falls back to the first letter; adding a service needs no new client bundle.

**Three. The lines QA will not sign off**

18. An unverified entry is **not** a connector. A service whose licence or publisher we have not verified may appear on the reference page (`docs/connectors.md`) only as a comparison row, carrying both markers — `licence = unverified` (and every other unverified field likewise) **and** a line saying it is reference information, not offered as a connector. It takes no connector definition, gets no registry entry and never appears on the Connectors page. Every other row is verified and is a real catalogue entry. **Testable:** every row on the reference page is either a verified catalogue entry or a comparison row; a comparison row carries both markers and appears in no connector definition and on no Connectors page; the registry holds no comparison row. The red line is unchanged — an unverified entry never becomes a connector.

19. A write operation from the catalogue (send mail, delete a repository, drop a table) is not allowed unless it goes through the approval path.
20. A suite whose totals moved without the pull request saying so is not signed off.

**Four. How the tests run (no real service is contacted)**

21. The identity probe uses a `node:http` stub in `ds-bot/test/fixtures/connector-stub/` on `127.0.0.1`; the MCP mount uses the existing fake loader (`ds-bot/test/connectors.test.js:57-66`), so no real MCP server is needed. The shared helper is `ds-bot/test/connector-harness.js`.
22. The two current-code fixes each have a test file, written by QA and measured:
    - `ds-bot/src/host/capabilities.js:114-121` — a streamable-http capability is no longer `approved: true` by default and does not mount before it is approved; a non-https address is refused outright. When the url or the headers change, it goes back to `needs-approval` and the user must approve it again before it mounts again. Test: `ds-bot/test/capability-remote-mcp.test.js` (4 cases).
    - `ds-bot/src/host/connectors.js:116` — the account name a probe returns is filtered before it is shown (character set `/^[A-Za-z0-9._-]+$/`, at most 64 characters, no angle brackets, no control characters) and it comes only from that connector's own probe. When the account name is invalid as a whole, the connection is refused with an error naming that service: no secret stored, nothing mounted, no empty account shown. Test: `ds-bot/test/connector-account-sanitised.test.js` (5 cases).

**Five. What "per Bot" means in a test**

23. A Bot that has a connector attached has that connector's tools, and that connector's own request carries the credential; the same Bot's scope and its shell still show no secret. The Bot without the grant does not see the tools at all. Test: `ds-bot/test/connectors-generic.test.js` ("a Bot with the grant has the tools and the request carries the credential, and the Bot's scope and shell show no secret").

### Research findings: ACP, MCP Apps, plugin manifests, and the MCP Registry

Four questions, each answered from primary sources (the spec site, the official registry API, the npm registry, vendor documentation) and measured where it could be measured.

#### 1. ACP is a host protocol for us, not a connector type

The Agent Client Protocol (ACP) standardises communication between code editors and coding agents over JSON-RPC 2.0. The spec is published at [agentclientprotocol.com](https://agentclientprotocol.com/llms.txt) in two revisions, **v1** and **v2**. The client library is [`@agentclientprotocol/sdk`](https://www.npmjs.com/package/@agentclientprotocol/sdk), latest **2.6.0**, **Apache-2.0**, published 2026-11-10 (the v1 line ends at 1.9.0). There is an **ACP Registry** — a curated set of agents that support authentication — and the official agents page lists **48** agents (Claude Agent, Codex CLI, Gemini CLI, Goose, OpenCode, Hermes, Cursor, Copilot CLI, and others).

Two facts decide our design:

- **Our runtime is an ACP server, and it has no ACP client.** `dsh-acp` (0.2.1-rc.4 in the packaged app, 0.2.0-rc.2 in the host install) is the only runtime package that depends on `@agentclientprotocol/sdk`, which it pins at **1.4.0**. Driving a third-party ACP agent from Nova Bots would require a new client side (spawn over JSON-RPC stdio, `initialize`, `auth/login`, `session/new`, `session/prompt`, plus `session/request_permission`, `fs/*` and `terminal/*` handling). That is runtime work, not a connector record.
- **The reverse direction already works and costs nothing.** `dsh-acp` lets an external editor (Zed) drive Nova Bots. That is a host integration; it does not belong on the Connectors page.

ACP and MCP meet in one place: `session/new` carries an `mcpServers` array, so a client can hand MCP servers to an agent (stdio is mandatory for agents, http and sse are optional capabilities). Support is **per agent**, not a property of ACP — in our own handshake test OpenCode called a client-supplied MCP tool, while Goose ignored it and exposed no such tool.

**Conclusion: a connector is an MCP server (remote endpoint or local stdio). ACP stays a host-side protocol we already serve; the catalogue lists services, not agents.**

#### 2. MCP Apps: a connector can return text and JSON today, and no interactive UI

MCP Apps is the extension that lets an MCP server ship an interactive interface. A server declares **UI resources** with the **`ui://`** URI scheme at tool-registration time; the host fetches the resource and renders it in a **sandboxed iframe**, and the view completes a `ui/initialize` handshake with the host before the tool runs. The extension is published at `modelcontextprotocol/ext-apps`, spec revision **2026-01-26**, with the SDK `@modelcontextprotocol/ext-apps` at **2.0.4** (**MIT**, 2026-10-27). Its security model is declarative CSP inside the iframe, and it is designed as a progressive enhancement: a host without MCP Apps support still gets the tool, returning text.

**What our runtime can do today:** `dsh-mcp-resources` (0.2.1-rc.4) exposes exactly three shared model tools — `list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource` — and contains no `ui://` handling at all; the `ext-apps` package is not installed. Rendering a connector's UI would need `ui://` support in the resource layer, an iframe host with the postMessage bridge, the `ui/initialize` lifecycle, and a CSP story consistent with the CSP hardening work already in flight.

**Conclusion: today a connector returns text and structured JSON only. If a service can ship MCP Apps, the catalogue records that as a capability of the *service* while the host's own limitation is recorded separately, so the page never promises a UI our runtime cannot draw.**

#### 3. Plugin and app manifests: partly expressible, not fully

| ecosystem | manifest | what it carries | expressible in our model? |
|---|---|---|---|
| Claude Code plugins | `.claude-plugin/plugin.json` (+ `.mcp.json`, `marketplace.json`) | `name`, `displayName`, `version`, `metadata`, `userConfig`, `mcpServers`, `commands`, `hooks`, `skills/`, `lspServers`, `monitors` | **partly** — `mcpServers` and `skills/` map onto our `mcp` and `skill` capabilities; `commands`, `hooks`, `lspServers` and `userConfig` prompts have no expression in a Cordis plugin plus `dsh` manifest |
| OpenAI / ChatGPT plugins (portable "Agent Plugins") | root `plugin.json` + `mcp.json` + `.app.json` + `skills/`, `hooks/`, `scripts/`, `assets/`; `.codex-plugin/plugin.json` kept as a compatibility fallback; OpenAI-specific data under `extensions.com.openai` | plugin identity, skills, MCP server mappings, registered app ids | **partly** — skills and MCP servers map onto our capability model; `extensions.com.openai` and `hooks/` do not |
| VS Code extensions | VSIX with `package.json` (`contributes`), MCP servers via the portable `mcpServers` format or a workspace `.mcp.json` | a whole editor-extension runtime | **no** — but its MCP server entry is portable and is expressible |
| Zapier / Make / Pipedream | no installable manifest — hosted MCP endpoints reached over HTTP with OAuth or a connection token | — | **yes**, as remote MCP endpoints, which is how we would list them |

**Name-squat and impersonation risk is measurable, not theoretical.** A search of the official registry returns **22** servers whose name contains "gmail", **25** for "slack", **43** for "postgres", **29** for "figma" and **17** for "stripe" — in each case exactly one is the vendor's own, and the rest are third parties with no vendor relationship. The npm `markitdown` is not Microsoft's tool. Any catalogue row must therefore name its publisher.

#### 4. The official MCP Registry exists, and it guarantees much less than it appears to

| fact | value |
|---|---|
| Service | **Official MCP Registry**, "a community driven registry service for MCP servers" |
| Version | **1.8.9** (built 2026-11-10) |
| API | `GET /v0/servers` (parameters `cursor`, `limit`, `updated_since`, `search`, `version`, `include_deleted`), `GET /v0/servers/{name}/versions`, `POST /v0/publish`, `POST /v0/validate`, publisher auth via DNS / HTTP / OIDC / GitHub |
| Public | **Yes** — reads need no key (measured) |
| Size (measured, full pagination, 624 pages) | **62,331** distinct servers; **42,009** with a remote endpoint; **24,294** with a package; 4,660 with both; remote transports: 42,224 `streamable-http`, 1,142 `sse` |

**What it guarantees:** a reverse-DNS namespace the publisher has proven it controls, and metadata (name, version, description, remotes, packages with a `sha256` for `mcpb` bundles, declared environment variables including which are secrets).

**What it does not guarantee:** it has **no licence field at all** (the published server schema contains no `license` property), it does not review the server's code, it does not scan it, and it signs nothing except the `mcpb` bundle digest. It is an index of claims, not a certification.

**Rule that follows:** the registry is a **candidate source** for URLs, never a source of truth for a catalogue row. Every row still passes our own verification — licence, publisher, version and date, self-hosted or hosted, the exact credential it asks for, and the date we verified it. The registry is also a good detector of lookalikes: the same service name is claimed by many unrelated publishers.

#### 5. Hosted vendor endpoints, measured

Each endpoint below was probed with a single unauthenticated `initialize` request — no token was sent and nothing was created.

| endpoint | response | credential it asks for |
|---|---|---|
| `https://mcp.context7.com/mcp` | **200** | **none** (keyless) |
| `https://mcp.notion.com/mcp` | 401 | OAuth |
| `https://mcp.linear.app/mcp` | 401 | OAuth (a read-only endpoint exists too) |
| `https://mcp.stripe.com` | 401 | OAuth |
| `https://mcp.figma.com/mcp` | 401 | OAuth |
| `https://mcp.atlassian.com/v1/mcp` | 401 | OAuth |
| `https://mcp.make.com` | 401 | OAuth |
| `https://mcp.zapier.com/api/mcp` | 403 | OAuth inside the client, or a connection token for code clients |
| `https://mcp.sentry.dev/mcp` | 401 | OAuth |
| `https://api.githubcopilot.com/mcp/` | 401 | `Authorization: Bearer` — our connector today |
| `https://mcp.gmail.com/mcp` | **no such host** | — |

Two corrections this table forces:

- **Google's Gmail MCP is official but local.** There is no hosted Gmail endpoint, so a Gmail connector means either a stdio server in the engine image or a third-party hosted one whose publisher and licence we verify ourselves.
- **Most hosted vendor endpoints are OAuth-shaped.** Notion, Linear, Stripe, Figma, Atlassian, Make, Zapier and Sentry want an OAuth grant, not a pasted token. The connector definition therefore has to state the **credential kind** (`token` | `oauth` | `none`) as a first-class field, and an OAuth connector is a later tranche, not a first one.

#### 6. What this changes in the note

Nothing in the data model. The record already carries `url`, `headers`, `secretName`, `authKind`, `category`, `licence`, `selfHostable`, `freeTier`, `paid`, `version` and `verifiedOn` — which is exactly the set of facts the registry cannot supply, so the rule "an entry we have not verified is not listed as a connector" stays as it is. Two additions are worth making:

1. **A credential kind is explicit** (`token` | `oauth` | `none`), because half of the good hosted endpoints are OAuth-only and a user reading "paste your token" for an OAuth service would be misled.
2. **A host-capability flag**, so a row can say "this service can ship an interactive UI; our host returns text and JSON today" without the catalogue promising something the runtime cannot draw.

**Adopt today:** a remote MCP endpoint as a connector definition (already supported by the MCP client); a local stdio MCP server as a connector definition (approval-gated, binary must exist in the engine image); the official registry as a discovery source behind our own verification step.
**Needs work on our side:** an OAuth flow for connectors; MCP Apps rendering (resource layer, iframe host, `ui/initialize`, CSP); a licence and publisher verification step for every catalogue row; an ACP client — only if a third-party coding agent is ever to be a connector.

## What this does not do

- No external marketplace, and no pulling definitions from someone else's registry; the registry is
  in this repository, one reviewed definition per service.
- Tranche 1 does no OAuth and no browser consent flow.
- Third-party services are not vendored into the repository; they run as separate processes.
- A Bot never sees or enters the value of a credential; a newly connected credential does not
  reach a Bot's shell unless the user opens that up on the Secrets page.
- No fuzzy name matching and no automatic install; every service is one reviewed definition.
- Prices that were not read are never written.
- **ACP is not a connector type.** The runtime has no ACP client (`dsh-acp` is a server only), so
  driving OpenCode, Goose or Gemini as a connector would be runtime work. ACP stays a host-side
  protocol we already serve: `dsh-acp` lets Zed drive Nova Bots.
- **MCP Apps are not a connector feature.** `dsh-mcp-resources` exposes three read-only resource
  tools and has no `ui://` handling, so an interactive connector UI is runtime work. The
  catalogue records that as a host capability, never as a service feature.
- **Plugin manifests are only partly expressible.** We can take `mcpServers` and `skills/` from
  Claude Code and OpenAI/ChatGPT portable plugins; `commands`, `hooks`, `lspServers`,
  `userConfig` and VS Code's `contributes` have no expression in our plugin model, and
  Zapier/Make/Pipedream are hosted endpoints, not manifests.
- **The official MCP Registry finds, it does not certify.** It guarantees the namespace and the
  metadata and nothing else — no licence field, no code review, no signature — so it is a source
  of candidate URLs behind our own verification, never the source of truth for a row.

## Known limits

- This design changes today's GitHub connector behaviour (mounted per Bot instead of team-wide).
  That is a change to a decided design (the connector section of
  [Browser, web search, secrets and connectors](2026-10-08-browser-and-secrets.md)), so **it takes
  effect only after Jahanzaib's explicit OK**; that note's "Changes" list gets a dated entry only
  after that OK.
- A catalogue entry does not enter the registry before its licence is verified; an unverified
  entry exists only as a comparison row.
- The free tiers and prices in the catalogue are a snapshot read on 2026-11-12 and go out of date.
  Every definition carries `verifiedOn`; after six months the row is marked "needs re-check".
- The Gmail row is real but belongs to tranche 3, and Google has **no hosted** Gmail MCP
  endpoint (`mcp.gmail.com` does not resolve): Google's own Gmail MCP is official but
  **local**, so a Gmail connector means a stdio server in the engine image or a third-party
  hosted one whose publisher and licence we verify ourselves.
- An interactive connector UI (MCP Apps) needs runtime work — `ui://` handling in the
  resource layer, an iframe host with the `ui/initialize` handshake and a CSP story — so a
  connector returns text and JSON today.
- The engine image has no `sqlite3`, `psql`, `soffice`, `pandoc` or `tesseract`, so only pure JS /
  pure Python local stdio services can run today.
- The tool namespace `mcp__<id>__` collides with a capability of the same name, and that
  capability then registers no tools (the runtime withdraws the whole conflicting server's tools).
- The account name a probe returns is shown unfiltered today; the current-code fixes filter it
  (remote MCP needs approval / account name filtering).
- The catalogue reference page is English only, following `docs/local-models.md`; only
  `README.md` / `README.zh.md` and the interface strings carry Chinese.
- The test baseline before and after the change (`dev` = `61179955`): 1462 tests / 1460 pass / 0 fail
  / 2 skipped, and 7 connector assertions. The two current-code fixes measure 1466 / 1464 / 0 / 2
  and 1467 / 1465 / 0 / 2.

## Changes

- 2026-11-12: first draft. The connector changes from a hardcoded GitHub block to a data-driven
  definition granted per Bot; the catalogue's table, detail page, writing rules and licence rules
  are decided.
- 2026-11-12: rewritten in English on the maintainer's instruction, with Security's rules R1-R12,
  QA's 23 acceptance criteria and the research findings added.
