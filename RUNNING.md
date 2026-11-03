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
| `/home/jahanzaib/Desktop` | `/host` |
| `/home/jahanzaib/Desktop/linkedin-agent` | `/host/linkedin-agent` |

Set that up in `docker/.env`:

```sh
HOST_SHARE=/home/jahanzaib/Desktop
#BOT_MOUNTS=/home/jahanzaib/Documents,/home/jahanzaib/notes:/mnt/notes
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
- **Sign-up is open** on the public address (five accounts per address per
  hour). For a closed workspace, set the accounts up yourself and forbid the
  rest from the operator console.
