# Connector catalogue

Every service a Bot can be connected to, with the facts that decide whether you want it: the
credential it needs, whether you can run it yourself, what the free tier really gives, what it
costs, and under which licence.

This is a reference, not a recommendation. Nothing here is ranked, endorsed, or "best"; the
order inside a category is deliberate and is explained under [House rules](#house-rules).

- The **Connectors page** in the app shows the same list — connected or not — and the state of
  each one. It does not repeat prices, licences, or install steps.
- A **per-service page** (`docs/connectors/<service>.md`) holds the mechanics: how it runs, the
  exact install steps, the tools it exposes, and how its credential is handled. The template is
  [`docs/connectors/_template.md`](connectors/_template.md).
- The **security note** ([`SECURITY_MODEL.md`](../SECURITY_MODEL.md)) holds the credential
  rules. This page does not repeat them.

Rows marked unverified are things we could not read on the day the row was checked; they are
written as unverified rather than estimated. The date in the last column is when the row was
last read.

## How to read a row

| Column | What it tells you |
|---|---|
| Service | The product, and the link to its detail page |
| Category | Which part of the work it belongs to |
| What it does | One line, no adjectives |
| Credential | `none` · `token` · `OAuth app` · `account` |
| Self-hostable | `yes — one binary` · `yes — one container` · `yes — a file` · `no` |
| Free tier | What the free tier actually gives |
| Paid | The price, or unverified |
| Licence | The licence, or unverified |
| Version / date | The version, and when the row was last read |

## House rules

1. Every row carries a licence and a version/date. A cell we could not read says unverified.
2. A price is never stated without a source and a date; an unreadable price is unverified, never
   estimated, never "around".
3. A service that needs a card or a paid account is marked `needs a card` and is never the first
   row of its category.
4. Inside every category the order is: keyless and local → self-hosted → free hosted tier → paid.
5. A package whose name does not describe what it is is flagged in the row itself.
6. "Self-hostable" always names a shape — one binary, one container, a file, or a cluster — never
   a bare yes.
7. A service whose licence or publisher is unverified may appear here only as a **comparison row**: it
   carries `licence = unverified` (and unverified in every other field we could not read) **and** the line
   *reference information, not offered as a connector*. Such a
   row never enters the registry, never gets a connector definition, and never appears in the
   app's Connectors page.
8. Every other row is verified and must be installable-by-catalogue: licence, publisher,
   version/date, self-hosted or hosted, the exact credential it asks for, and the date it was
   last verified.
9. Nothing that was not read is written. No credentials, no sign-ups, no accounts.

## Mail and messaging

| Service | Category | What it does | Credential | Self-hostable | Free tier | Paid | Licence | Version / date |
|---|---|---|---|---|---|---|---|---|
| [Gmail API](https://developers.google.com/workspace/gmail/api/reference/quota) | Mail and messaging | REST v1 for mail, drafts, labels, threads, history | OAuth app | no | Quota page exists; send quota **unverified** | Google Workspace — unverified | Google API terms (not open source) | API live, read 2026-11-12 |
| [Gmail MCP server (official)](https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server) | Mail and messaging | Gmail tools: `create_draft`, `list_drafts`, `get_thread`, `get_message`, `search_threads`, `label_thread`, `unlabel_thread`, `list_labels`, `label_message`, `create_label` | OAuth app | no — Google runs it, and its MCP server is **local**: there is no hosted Gmail endpoint | Free to use with a Google account | Workspace for higher quotas — unverified | Google service terms (not an OSS package) | no version published, read 2026-11-12 |
| [Microsoft Graph](https://learn.microsoft.com/en-us/graph/throttling) | Mail and messaging | Outlook mail, files, calendar, identity | Azure Entra app (OAuth) | no | 130,000 requests / 10 s per app across all tenants | M365 licence — unverified | Microsoft service terms | live, read 2026-11-12 |
| [Stalwart Mail Server](https://stalw.art/open-source/) | Mail and messaging | One Rust binary: SMTP, IMAP, JMAP, CalDAV/CardDAV, webmail | none beyond your own domain | yes — one container | Community edition free | sponsor path — unverified | AGPL-3.0 | version **unverified**, read 2026-11-12 |
| [mailcow](https://docs.mailcow.email/) | Mail and messaging | Dockerised mail suite with webmail and CalDAV/CardDAV | your domain + app password | yes — docker-compose | Free and open source | support only — unverified | MIT (mailcow-docker) | version **unverified**, read 2026-11-12 |

## Code and forges

| Service | Category | What it does | Credential | Self-hostable | Free tier | Paid | Licence | Version / date |
|---|---|---|---|---|---|---|---|---|
| [GitHub REST / GraphQL](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) | Code and forges | Repos, issues, PRs, Actions, Apps | fine-grained PAT, or OAuth app | no | Actions free for public repos; unauthenticated REST 60 req/h — unverified | github.com/pricing — unverified | GitHub service terms | REST API 2026-03-10, read 2026-11-12 |
| [GitLab](https://about.gitlab.com/pricing/) — *reference information, not offered as a connector* | Code and forges | Repos, CI, issues, registry | PAT or OAuth app | yes — CE | Free tier exists, figures unverified | pricing page read 2026-11-12, figures unverified | **unverified** (CE and hosted differ) | no version published, read 2026-11-12 |
| [Forgejo](https://codeberg.org/forgejo/forgejo) | Code and forges | Git forge, single binary, REST API, Actions, packages | token | yes — one binary | Free, no paid tier | none | MIT | v17.0.1, released 2026-10-26 |
| [Gitea](https://gitea.com/) | Code and forges | Git forge, single binary, REST API | token | yes — one binary | Free, no paid tier | none | MIT | version **unverified**, read 2026-11-12 |

## Databases and storage

| Service | Category | What it does | Credential | Self-hostable | Free tier | Paid | Licence | Version / date |
|---|---|---|---|---|---|---|---|---|
| [PostgreSQL](https://www.postgresql.org/versions.json) | Databases and storage | The relational default | none locally | yes — one container | Free and open source | — | PostgreSQL Licence (BSD-like) | major 18, latest 18.6, released 2026-08-13 |
| [SQLite](https://www.npmjs.com/package/better-sqlite3) | Databases and storage | File database, no server | none | yes — a file | Free and open source | — | MIT (`better-sqlite3`) | `better-sqlite3` 13.1.1, read 2026-11-12 |
| [MySQL](https://www.npmjs.com/package/mysql2) | Databases and storage | Relational | none locally | yes — one container | Free and open source | — | GPL (`mysql2` client) | `mysql2` 3.24.6, read 2026-11-12 |
| [Redis](https://www.npmjs.com/package/ioredis) | Databases and storage | Cache and queue | none locally | yes — one container | Free and open source | — | **RSALv2/SSPL** — may be run by you, never vendored here | `ioredis` 6.0.0, read 2026-11-12; server version unverified |
| [MongoDB](https://www.npmjs.com/package/mongodb) | Databases and storage | Document store | none locally | yes — community server | Free and open source | — | **SSPL server** (driver Apache-2.0) — may be run by you, never vendored here | driver 7.8.0, read 2026-11-12; server version unverified |
| [Neon](https://neon.com/pricing) | Databases and storage | Hosted serverless Postgres | account | no | $0: 100 projects, 100 CU-hrs/mo per project, 1 GB storage per project, no credit card | usage-based, typically $15/mo; $0.106/CU-hr, $0.35/GB-month | proprietary SaaS | pricing read 2026-11-12 |
| [Supabase](https://supabase.com/pricing) | Databases and storage | Hosted Postgres with auth, storage, edge functions | account | no | $0: unlimited API requests, 50,000 MAU, 500 MB DB, 5 GB egress — **projects pause after 1 week inactive**, max 2 active | Pro from $25/mo, Team from $599/mo | proprietary SaaS | pricing read 2026-11-12 |
| [Turso](https://turso.tech/pricing) | Databases and storage | Hosted SQLite / libSQL | account | no | $0: 100 DBs, 5 GB storage, 500M rows read, 10M rows written, 3 GB sync, 1-day PITR | Developer $4.99/mo, Scaler $24.92/mo, Pro $416.58/mo | proprietary SaaS | pricing read 2026-11-12 — **the banner on that page reads "Turso is joining Supabase"** |

## Workflow, automation and DevOps

| Service | Category | What it does | Credential | Self-hostable | Free tier | Paid | Licence | Version / date |
|---|---|---|---|---|---|---|---|---|
| [n8n](https://n8n.io/pricing/) | Workflow, automation and DevOps | Visual workflow automation, 400+ integrations | token per integration | yes — one container (Community Edition) | Community self-host free | Cloud: Starter €20/mo, Pro €50/mo, Business €667/mo — no card for the trial | **fair-code** ("SEE LICENSE IN LICENSE.md") — may be run by you, never vendored here | 2.47.4, read 2026-11-12 |
| [Temporal](https://temporal.io/pricing) | Workflow, automation and DevOps | Durable execution, workflow-as-code | API key for Cloud | yes — a service, not a one-shot container | OSS free; Cloud $150 credits / 90 days | Cloud from $50 / million actions; support add-on from $500/mo | OSS MIT; Cloud proprietary | SDK `@temporalio/client` 1.25.0, read 2026-11-12 |
| [Prefect](https://www.prefect.io/pricing) | Workflow, automation and DevOps | Python-native orchestration, durable flows | API key for Cloud | yes — local `prefect server` | OSS free | Cloud pricing page read 2026-11-12, figures unverified | Apache-2.0 (OSS) | read 2026-11-12 |
| [Apache Airflow](https://airflow.apache.org/) | Workflow, automation and DevOps | DAG scheduler, Python | — | needs a scheduler, webserver and metadata DB | Apache-2.0, free | — | Apache-2.0 | version **unverified**, read 2026-11-12 |
| [Argo Workflows](https://argo-workflows.readthedocs.io/) | Workflow, automation and DevOps | Container-native workflows | — | needs a Kubernetes cluster | Apache-2.0, free | — | Apache-2.0 | version **unverified**, read 2026-11-12 |
| [Woodpecker CI](https://woodpecker-ci.org/) | Workflow, automation and DevOps | Container-per-step CI, small footprint | repo token | yes — one binary and a database | Apache-2.0, free | — | Apache-2.0 | version **unverified**, read 2026-11-12 |
| [Drone](https://www.drone.io/) | Workflow, automation and DevOps | Container-native CI | repo token | yes — a server and runners | Apache-2.0, free | — | Apache-2.0 | version **unverified**, read 2026-11-12 |
| [GitHub Actions](https://github.com/pricing) | Workflow, automation and DevOps | CI/CD tied to the repository | repo token | yes — a self-hosted runner | free for public repos; minutes and price unverified | github.com/pricing | GitHub service terms | read 2026-11-12 |
| [GitLab CI](https://about.gitlab.com/pricing/) — *reference information, not offered as a connector* | Workflow, automation and DevOps | CI/CD in GitLab | project token | yes — a self-managed runner | included in the free tier, figures unverified | — | **unverified** | read 2026-11-12 |

## Office and documents

| Service | Category | What it does | Credential | Self-hostable | Free tier | Paid | Licence | Version / date |
|---|---|---|---|---|---|---|---|---|
| [Our own Office skills](../ds-bot/src/office/) | Office and documents | Reads and writes `.docx`, `.xlsx` and `.pptx`; checks, packs and unpacks packages | none | yes — already in this repository, nothing to install | Free, fully offline, no key | — | Apache-2.0 (this repository) | this checkout, read 2026-11-12 |
| [LibreOffice](https://www.libreoffice.org/download/) | Office and documents | Headless conversion of any Office format | none | yes — offline, needs `soffice` in the image | Free | — | MPL-2.0 | stable 26.8.2, read 2026-11-12 |
| [tesseract.js](https://www.npmjs.com/package/tesseract.js) | Office and documents | OCR in pure JavaScript | none | yes — offline | Free | — | Apache-2.0 | 7.0.0, read 2026-11-12 |
| [pdfjs-dist](https://www.npmjs.com/package/pdfjs-dist) | Office and documents | Reads and renders PDFs | none | yes — offline | Free | — | Apache-2.0 | 6.5.438, read 2026-11-12 |
| [pdf-lib](https://www.npmjs.com/package/pdf-lib) | Office and documents | Creates and modifies PDFs | none | yes — offline | Free | — | MIT | 1.17.1, read 2026-11-12 |
| [Pandoc](https://pandoc.org/) | Office and documents | Universal document converter | none | yes — offline | Free | — | GPL-2.0 | version **unverified**, read 2026-11-12 |

## The plugin platform we already have

These are ours, they are in this repository, and they need no account and no key.

| Service | Category | What it does | Credential | Self-hostable | Free tier | Paid | Licence | Version / date |
|---|---|---|---|---|---|---|---|---|
| [`office` + `office-tools` skills](../ds-bot/src/office/) | The plugin platform we already have | Offline document tools: `office.js` with `unpack`, `pack`, `check`, `docx`, `pptx`, `xlsx`, `sheet` | none | yes — a built-in skill, not a process | Free | — | Apache-2.0 | this checkout, read 2026-11-12 |
| [Browser plugins](../browser-plugins/) | The plugin platform we already have | One browser backend for the team, one Chromium profile per Bot: `refs`, `script`, `task` | none | yes — in this repository | Free | — | Apache-2.0 | this checkout, read 2026-11-12 |
| [Repo skills](../.agents/skills/) | The plugin platform we already have | Skills with the standard `SKILL.md` frontmatter, mounted into the agent | none | yes — in this repository | Free | — | Apache-2.0 | this checkout, read 2026-11-12 |
| [Capability library](../ds-bot/src/host/capabilities.js) | The plugin platform we already have | Shared MCP servers, skills and packs, mounted per Bot over stdio or streamable-http | none beyond what the service asks for | yes — a shared library | Free | — | Apache-2.0 | this checkout, read 2026-11-12 |

## Build blocks — libraries, not connectors

These are the client libraries a connector would be written against. They are not services and a
Bot does not connect to them; they are listed so the choice is on the record.

| Library | Version | Licence | Used for |
|---|---|---|---|
| [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) | 1.32.2 | MIT | The MCP client/server SDK we build against |
| [`@modelcontextprotocol/server-filesystem`](https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem) | 2.3.0 | "SEE LICENSE IN LICENSE" | MCP server for local files |
| [`@modelcontextprotocol/server-memory`](https://www.npmjs.com/package/@modelcontextprotocol/server-memory) | 2.1.1 | "SEE LICENSE IN LICENSE" | MCP server for a local memory file |
| [`@modelcontextprotocol/server-puppeteer`](https://www.npmjs.com/package/@modelcontextprotocol/server-puppeteer) | 2025.5.12 | MIT | MCP server driving a browser — **archived and unmaintained** on npm |
| [`@modelcontextprotocol/server-slack`](https://www.npmjs.com/package/@modelcontextprotocol/server-slack) | 2025.4.25 | MIT | MCP server for Slack — **no longer supported** on npm |
| [`@modelcontextprotocol/server-brave-search`](https://www.npmjs.com/package/@modelcontextprotocol/server-brave-search) | 0.6.2 | MIT | MCP server for Brave Search — **no longer supported** on npm |
| [`@modelcontextprotocol/server-github`](https://www.npmjs.com/package/@modelcontextprotocol/server-github) | 2025.4.8 | MIT | Official MCP server for the GitHub API — **archived and unmaintained** on npm |
| [`@modelcontextprotocol/server-postgres`](https://www.npmjs.com/package/@modelcontextprotocol/server-postgres) | 0.6.2 | MIT | MCP server for Postgres — **archived and unmaintained** on npm; it takes the DSN on the command line, where `ps` shows it |
| [`@octokit/rest`](https://www.npmjs.com/package/@octokit/rest) | 22.0.1 | MIT | Official GitHub REST client |
| [`@gitbeaker/rest`](https://www.npmjs.com/package/@gitbeaker/rest) | 44.0.5 | MIT | GitLab API client for Node |
| [`better-sqlite3`](https://www.npmjs.com/package/better-sqlite3) | 13.1.1 | MIT | SQLite driver |
| [`mysql2`](https://www.npmjs.com/package/mysql2) | 3.24.6 | GPL | MySQL driver |
| [`ioredis`](https://www.npmjs.com/package/ioredis) | 6.0.0 | MIT | Redis client (the server licence is RSALv2/SSPL) |
| [`mongodb`](https://www.npmjs.com/package/mongodb) | 7.8.0 | Apache-2.0 | MongoDB driver (the server is SSPL) |
| [`imapflow`](https://www.npmjs.com/package/imapflow) | 2.11.0 | MIT | IMAP client for Node |
| [`nodemailer`](https://www.npmjs.com/package/nodemailer) | 10.5.0 | MIT-0 | SMTP sending for Node |
| [`ical.js`](https://www.npmjs.com/package/ical.js) | 2.2.1 | MPL-2.0 | iCalendar / vCard parser |
| [`caldav`](https://www.npmjs.com/package/caldav) | 0.0.1 | MIT | Node CalDAV client |
| [`docx`](https://www.npmjs.com/package/docx) | 9.15.3 | MIT | Write .docx |
| [`exceljs`](https://www.npmjs.com/package/exceljs) | 4.4.0 | MIT | Read and write .xlsx and csv |
| [`pptxgenjs`](https://www.npmjs.com/package/pptxgenjs) | 4.0.1 | MIT | Write .pptx |
| [`pdf-lib`](https://www.npmjs.com/package/pdf-lib) | 1.17.1 | MIT | Create and modify PDFs |
| [`pdf-parse`](https://www.npmjs.com/package/pdf-parse) / [`pdf2json`](https://www.npmjs.com/package/pdf2json) | 2.4.5 / 4.1.1 | Apache-2.0 | Extract PDF text |
| [`mammoth`](https://www.npmjs.com/package/mammoth) | 1.13.0 | BSD-2-Clause | .docx to HTML / Markdown |
| [`turndown`](https://www.npmjs.com/package/turndown) / [`cheerio`](https://www.npmjs.com/package/cheerio) / [`jsdom`](https://www.npmjs.com/package/jsdom) | 7.2.5 / 1.2.0 / 31.0.0 | MIT | HTML to Markdown, DOM |
| [`playwright`](https://www.npmjs.com/package/playwright) | 1.65.0 | Apache-2.0 | Headless browser |

The npm MCP servers were measured on 2026-11-12: `server-github`, `server-postgres` and
`server-puppeteer` carry the **archived and unmaintained** notice, `server-slack` and
`server-brave-search` carry **no longer supported**; `server-filesystem` and `server-memory` start
cleanly with no credential and no service.

## Name traps

- [`markitdown`](https://www.npmjs.com/package/markitdown) 0.0.4 is **not** Microsoft's tool. It is
  "Convert GFL to html using pandoc". A row like this is flagged in the row itself and is caught
  before it ships.

## Not listed, and why

- **Redis (RSALv2/SSPL), MongoDB server (SSPL), n8n (fair-code), Temporal Cloud** are listed
  above as things you can run. They may not be vendored into this repository (AGENTS.md rule 3).
- **`@modelcontextprotocol/server-sqlite`** is not published under that name (registry 404).
- **GitLab and GitLab CI** appear above as comparison rows only: their licences were not read, so
  they get no connector definition, no entry in the registry, and no row on the Connectors page
  until the licences are verified.
- **Gmail send-quota numbers, GitHub and GitLab free-tier figures, Prefect Cloud pricing, and
  the versions of Gitea, Stalwart, mailcow, Pandoc, Airflow, Argo, Woodpecker and Drone** were
  not re-read; the rows say unverified rather than an estimate.
