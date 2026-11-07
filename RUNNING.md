# Nova Bots — local install

This folder is a complete, self-hosted Nova Bots deployment: a team of
long-lived bots with their own chats, group chats and a shared workspace.

## The shape of it

```
https://bots.alilabsx.com/          the public address (Cloudflare tunnel)
        │
        ▼
   nginx  :13080                     the web front end — landing page, sign-in
        │                            page, and the app
        ├── /api/v1/auth/…  ───────► portal :13081   the account API
        └── everything else ───────► portal :13081   the bridge to the engine
                                            │
                                            ▼
                                   engine  :13083   the bots (loopback only)
```

- **The engine** is the container in `docker/`. It is bound to the loopback,
  so nothing on the network can talk to it directly.
- **The portal** (`portal/`) is a small Node service: it keeps the accounts,
  checks the session, and hands the request to the engine with the engine's
  own browser cookie. It runs as the user unit `nova-bots-portal.service`.
- **The web front end** is nginx (`nova-bots-web`): it serves the landing
  page and the sign-in page and forwards everything else to the portal.
- **The tunnel** (`cloudflared-bots.service`) publishes the address.

The accounts live in their own database (`nova_bots`) on the shared Postgres
server, with their own tables. Nothing the bots do touches the other
applications on this machine.

## Signing in

The sign-in page takes an email and a password. The accounts are Nova Bots'
own; the six that already existed on this machine were copied across once, so
the same password works here. A visitor can also create an account on the
sign-in page ("No account yet? Create one").

## Open it

| | URL |
|---|---|
| Public | **https://bots.alilabsx.com/** |
| On this machine | **http://127.0.0.1:13080/** |
| On the LAN | **http://10.162.159.121:13080/** |

The public address asks for an email and a password. The local address does
the same. If the account store is empty, the first account to sign up owns the
workspace.

The engine's own login token is still available for a direct connection to the
engine (no front end, no portal):

```sh
~/Desktop/Nova-Bots/nova-bots.sh url
```

It prints something like:

```
Login URL: http://127.0.0.1:13080/?token=0eORYKps6B7o60pz7tIkzMqk-0gU4OIHIuQkbeghj7Q
```

The interface is **Nova**: a violet-to-cyan aurora theme, the Nova spark
mark, and a glass surface across the conversation, settings and side panels.

## Give the bots a folder on this machine

The container can only reach what is mounted into it. Your host folders are
mounted under **`/host`**:

| On this machine | Inside the container |
|---|---|
| `~/Desktop` | `/host` |
| `~/Desktop/linkedin-agent` | `/host/linkedin-agent` |

Set that up in `docker/.env`:

```sh
HOST_SHARE=~/Desktop
#BOT_MOUNTS=~/Documents,~/notes:/mnt/notes
```

`HOST_SHARE` is one folder, mounted at `/host`. `BOT_MOUNTS` is a
comma-separated list of extra folders, each mounted under `/host` by its own
name (or at the path you give as `host:container`).

Or use the helper, which writes `docker/.env` for you:

```sh
~/Desktop/Nova-Bots/nova-bots.sh mounts                  # show what is mounted
~/Desktop/Nova-Bots/nova-bots.sh mount ~/Desktop/linkedin-agent
~/Desktop/Nova-Bots/nova-bots.sh mount ~/Documents       # extra folder
~/Desktop/Nova-Bots/nova-bots.sh unmount ~/Documents
~/Desktop/Nova-Bots/nova-bots.sh restart                 # apply
```

The bots read and write these folders as the `PUID`/`PGID` user (1000 by
default), so keep those matching the owner of the folder, or the bots get
permission errors.

### Let the bots install packages

The Nova process runs as the `node` user, so it cannot `apt install` on its
own. A browser automation stack needs that (Chromium's shared libraries).
`docker/.env` has:

```sh
BOT_ROOT=1
```

With it on, the bots may use `sudo` **inside the container**. That is root in
the container, not on the host: the bots still write to `/host` as
`PUID`/`PGID` unless they ask for sudo themselves. Set it to `0` to withhold
that power; the change needs a restart, not a rebuild.

### Point a bot at a folder (in the UI)

The whole team currently works in **`/host/linkedin-agent`**. To change one:

1. Open the bot's chat, then the **Orion** / bot pill at the top → details.
2. **Working folder** → pick from the list, **Browse folders…**, or
   **Enter a path…**.
3. The path must be absolute and must already exist. Paths that hold the
   Nova data (`/data`) are refused.

The bot's permission is **Full access** — the container is the only sandbox,
so no approval is asked. A folder change starts a fresh part in the new
folder; the old conversation stays readable.

## Commands

```sh
~/Desktop/Nova-Bots/nova-bots.sh start     # start (reuses the existing image)
~/Desktop/Nova-Bots/nova-bots.sh rebuild   # rebuild the image, then start
~/Desktop/Nova-Bots/nova-bots.sh stop      # stop
~/Desktop/Nova-Bots/nova-bots.sh restart
~/Desktop/Nova-Bots/nova-bots.sh logs      # follow the log (Ctrl+C to stop)
~/Desktop/Nova-Bots/nova-bots.sh url       # print the engine's login URL with the token
~/Desktop/Nova-Bots/nova-bots.sh status
~/Desktop/Nova-Bots/nova-bots.sh mounts
~/Desktop/Nova-Bots/nova-bots.sh portal-status  # portal health, landing page, sign-in page
~/Desktop/Nova-Bots/nova-bots.sh portal-logs    # follow the portal log
~/Desktop/Nova-Bots/nova-bots.sh web-logs      # follow the web front end log
~/Desktop/Nova-Bots/nova-bots.sh mount <hostpath> [containerpath]
~/Desktop/Nova-Bots/nova-bots.sh unmount <hostpath>
```

Or plain compose, from `~/Desktop/Nova-Bots/docker`:

```sh
docker compose up -d
docker compose logs -f nova-bots
```

## The public address

The tunnel is the user unit `cloudflared-bots.service`; its token lives in
`~/.nova/cloudflared/token-bots` and its ingress rules in
`~/.nova/cloudflared/config-bots.yml`.

```sh
~/Desktop/Nova-Bots/nova-bots.sh tunnel          # the public URLs
~/Desktop/Nova-Bots/nova-bots.sh tunnel-status   # connector state and reachability
~/Desktop/Nova-Bots/nova-bots.sh tunnel-start    # (re)start the connector
~/Desktop/Nova-Bots/nova-bots.sh tunnel-logs     # follow the connector log
```

The connector is registered at boot (lingering is on), so the address comes
back on its own after a reboot.

The tunnel's route comes from the Cloudflare dashboard: `bots.alilabsx.com →
http://localhost:13080`. The front end and the portal are what run on 13080.

## Survive a reboot

Already set up:

- `docker.service` is **enabled**, so Docker starts at boot.
- The container's restart policy is **`unless-stopped`**, so Docker brings it
  back on its own.
- `~/.config/systemd/user/nova-bots.service` is **enabled** and runs
  `nova-bots.sh start` after Docker, so the container also comes back with the
  current `docker/.env` (ports, mounts, trusted hosts).
- **Lingering** is on for `jahanzaib`, so the user unit starts at boot even
  without a login.

Check it:

```sh
~/Desktop/Nova-Bots/nova-bots.sh boot-status
```

To install it again on another machine, or after changing the unit:

```sh
~/Desktop/Nova-Bots/nova-bots.sh install-boot     # install + enable + start
~/Desktop/Nova-Bots/nova-bots.sh uninstall-boot   # remove the unit
```

Everything Nova needs lives in `docker/data/` (the team, chats, model
settings) and `docker/.env` (port, mounts, trusted hosts), both on disk, so a
reboot loses nothing.

The browser cache the bots use (Playwright's Chromium and its headless shell)
lives in `docker/cache/`, bind-mounted into the container, so it survives a
reboot **and** a container recreate. The image also carries the browser runtime
and the virtual display stack (Chromium's shared libraries, Xvfb, x11vnc,
fluxbox), so a fresh container can drive a browser without installing anything
first.

## Where things are

| Path | What it is |
|---|---|
| `docker/.env` | Your settings (port, trusted hosts, model key, host folders). Git-ignored. |
| `docker/data/` | The Nova home: the team, chats, profiles, login cookie key. |
| `docker/workspace/` | The team workspace the bots used before the host mount. |
| `docker/cache/` | The browser cache (Playwright's Chromium and headless shell). Bind-mounted. |
| `docker/compose.mounts.yml` | Generated from `BOT_MOUNTS` by `nova-bots.sh`. Git-ignored. |
| `docker/nova/` | The Nova brand layer and the build-time shell patch. |
| `docker/PINNED.md` | Every pinned resource and how to refresh it. |
| `portal/` | The portal: the account API and the bridge to the engine. |
| `portal/portal.env` | Its settings (database URL, signing secret, admin token). Mode 600. |
| `portal/public/` | The landing page and the sign-in page. |
| `portal/nginx/nova-bots.conf` | The web front end's configuration. |
| `nova-bots.sh` | The helper for everything above. |

## Add a model

The models are already listed, but they need a key. Either set it in
`docker/.env`:

```sh
NOVA_API_KEY=sk-...
```

then `~/Desktop/Nova-Bots/nova-bots.sh restart`, or add it in the UI under
**Settings → Models** (this writes the same config and survives a rebuild).
Then pick a model for Orion in its details panel.

## Port

Published on host port **13080** (the container always listens on 3080
inside). Change it in `docker/.env`:

```sh
NOVA_PORT=13080
```

Then restart the container. Pick a port that is free on the host.

## Access from another machine

`docker/.env` has `NOVA_TRUSTED_HOST`. The UI answers **403** on its API for any
`Host` header that is not listed, so add every name or IP you open it at:

```sh
NOVA_TRUSTED_HOST=localhost,127.0.0.1,10.162.159.121
```

## Notes

- The container is the sandbox boundary. It runs in **full access** mode: every
  command a bot runs happens without asking, and it can change anything the
  container can see — including everything under `/host`.
- Over plain HTTP the API keys you type cross the network in clear text. For
  regular use, put a reverse proxy with HTTPS in front.
- Back up `docker/data/` and `docker/.env` (stop the container first). The
  mounted host folders are backed up with whatever backs up your Desktop.
- Uninstalling does not delete the data — remove `docker/data/` and
  `docker/workspace/` yourself if you want it gone.
- Rebuilding the image takes a while (it installs the engine and system tools).
  `docker compose up -d` alone reuses the existing image.
- The engine keeps its internal package paths and environment names for
  compatibility. The container, service, image, plugin package, helper,
  systemd unit, page title, logs and every interface surface use the Nova
  name.
- The engine is bound to the loopback (port 13083). Only the portal talks to
  it, and only the portal can sign a browser in.
- The account store is the `nova_bots` database on the shared Postgres server:
  its own tables, its own connection, nothing shared with the other
  applications. The copy of the existing accounts happened once, in
  `portal/setup-db.mjs`.
- **Sign-up** follows `NOVA_SIGNUP_MODE` in `portal/portal.env` (`open` or
  `closed`, five accounts per address per hour; optional
  `NOVA_SIGNUP_ALLOWED_EMAILS` / `NOVA_SIGNUP_ALLOWED_DOMAINS`). When closed,
  the sign-in page offers "Request access" instead. An open sign-up never
  opens the shared engine: without tenancy a new account is held out, with
  tenancy it gets its own engine.
- Sessions are HMAC-signed with `NOVA_JWT_SECRET` (at least 16 characters).

## Per-account workspaces (tenancy)

With `NOVA_TENANCY=isolated` in `portal/portal.env`, every account gets its
own engine: container `nova-bots-t-<tenant id>`, two volumes
(`…-data` = the engine home, `…-data-work` = `/workspace`), its own launch
token and a loopback port from `NOVA_TENANT_PORT_BASE` (14100) on. The admin
keeps this folder's `nova-bots` engine as its own tenant. Default
(`shared`, or unset) is the single engine described above.

- **Lazy start**: the first visit creates the container ("Setting up your
  private workspace…", ~30 s); a stopped one is started on the next visit
  ("Waking up…", ~15 s).
- **Idle stop** after `NOVA_TENANT_IDLE_MINUTES` (30) without a request and
  without an open live feed. Data stays in the volumes.
- **Hard cap** `NOVA_TENANT_MAX_RUNNING`: at the cap, the least recently
  active idle tenant is stopped to make room; if every running tenant has an
  open live feed the visitor sees "All workspaces are busy" (retries itself).
- **Limits per tenant**: `NOVA_TENANT_CPUS` (1.0), `NOVA_TENANT_MEMORY`
  (1536m, no swap), `NOVA_TENANT_PIDS` (512); override per tenant through the
  admin API (`tenants/<id>/limits`). Logs rotate at 3 x 10 MB.
- **Provider keys**: none by default. The account adds its own in its
  workspace (Settings -> Models), or the operator assigns one to that tenant
  only (`tenants/<id>/key`, sealed with `NOVA_TENANT_SECRET_KEY`).
- **Admin API** (`X-Nova-Bots-Token`): `GET tenants` (state, last active,
  CPU/memory/pids, capacity), `POST tenants/<id>/start|stop|delete|key|limits`,
  `POST tenants/backfill`, `POST users/<id>/delete` (with `{"export":true}`
  the volumes are archived to `NOVA_TENANT_EXPORT_DIR` first). Every action
  is in the audit log.
- **Host firewall**: `ops/tenant-firewall.sh` (installed as the system unit
  `ops/nova-bots-tenant-firewall.service`) keeps tenants away from host
  services and the LAN. Tenants resolve names through `NOVA_TENANT_DNS`
  (default `1.1.1.1,1.0.0.1`), never the LAN router (see SECURITY_MODEL.md).

Turning it on, verifying and rolling back: [docs/TENANCY_ROLLOUT.md](docs/TENANCY_ROLLOUT.md).

### Capacity on this host (30 GB RAM, 12 cores, ~240 GB free disk)

Measured on `nova-bots:local`: an idle tenant engine uses ~150 MB RAM and
11 processes; a fresh tenant is 3.3 MB of volume plus a 0.4 MB container
layer (the 2.3 GB image is shared). A busy tenant (a Bot turn with tools)
sits around 300-600 MB; one driving a Chromium browser can reach the 1.5 GB
cap.

| Resource | Budget for tenants | Per tenant (worst case) | Result |
|---|---|---|---|
| RAM | ~16 GB (30 GB minus ~10 GB already used by the Nova stack, Postgres and the shared engine, minus 4 GB headroom) | 1.5 GB cap | **`NOVA_TENANT_MAX_RUNNING=10`** (15 GB if all ten peak at once; typical mix ~3-5 GB) |
| CPU | 12 cores, shared | 1 core cap | 10 running is safe: engines are mostly waiting on model APIs |
| Disk | ~240 GB free, keep 50 GB spare | ~1 GB typical after real use (files, chats, browser cache), logs <= 30 MB | **`NOVA_TENANT_MAX_TOTAL=150`** |
| Ports | 14100-14299 | 1 | 200 tenants max (`NOVA_TENANT_PORT_COUNT`) |

Idle stop is what makes this work: accounts that are not in use cost disk
only. With 30-minute idle stop, 10 running slots serve far more than 10
accounts. Watch `GET tenants` (usage) and `docker system df -v`; there is no
per-volume disk quota on this filesystem.

### Testing tenancy

```sh
cd portal
npm test                    # unit tests (gate, bridge routing, provisioner, sessions)
npm run test:integration    # real docker: two tenants, isolation proofs, idle stop, cleanup
node test/e2e/staging-e2e.mjs   # headless Chromium against a staging stack, screenshots in test/e2e/.state/
npm run staging up          # leave a staging stack on 127.0.0.1:13181 to poke at; "npm run staging down" removes it
```

The integration and e2e tests need the `nova-bots:local` and
`pgvector/pgvector:pg16` images. They create only `nbt-test-*` containers,
volumes and networks (own Postgres container, portal on 127.0.0.1:13181,
tenant ports from 14600) and remove them at the end. They never touch the
live portal, engine or database.
