# Nova Bots in Docker

This directory deploys Nova Bots as a Docker image: the web runtime with the
`nova-bots` plugin installed, ready for a NAS or any always-on box. The
container is the sandbox boundary — see [Permissions](#permissions).

## Requirements

- Docker 24+ with Compose v2.24+ (Docker Desktop, or Docker Engine + the
  compose plugin — `env_file.required` needs 2.24).
- Linux containers, x86-64. arm64 builds should work (`node:24-bookworm-slim` is
  multi-arch) but are untested.
- A model provider API key (or another Anthropic-Messages-compatible endpoint
  through `NOVA_BASE_URL`).

## Quick start

From the repository root:

```sh
cp docker/.env.example docker/.env
# Edit docker/.env: NOVA_API_KEY, NOVA_TRUSTED_HOST, PUID/PGID.
cd docker
docker compose up -d --build
```

Then ask the helper for the login URL:

```sh
~/Desktop/Nova-Bots/nova-bots.sh url
```

Open it once. The token signs a cookie (valid 30 days, bound to that
authority), after which **http://127.0.0.1:13080/** opens the UI directly.

The published host port is **13080** (`NOVA_PORT`); the container always listens
on 3080 inside. Data and workspace files live in `docker/data` and
`docker/workspace`.

The first time the team opens, Nova Bots creates a Main Bot called **Orion**
(Mission Commander) and the interface opens in the **Nova Galaxy** theme.

## The front end and the portal

The compose project has two containers:

| Service | What it is | Port |
|---|---|---|
| `nova-bots` | The engine and the bots | `127.0.0.1:13083` (loopback only) |
| `nova-bots-web` | nginx: the landing page, the sign-in page, the app | `13080` (published) |

In front of the web front end sits the **portal** (`../portal/`), a small Node
service on `127.0.0.1:13081`. It holds the accounts, checks the session and
hands the request to the engine with the engine's own browser cookie. It runs
as the user unit `nova-bots-portal.service`.

```
browser → nginx :13080 → portal :13081 → engine :13083
```

The accounts live in their own database (`nova_bots`) on the shared Postgres
server, with their own tables; nothing is shared with the other applications
on the machine. The sign-in page also offers a sign-up, so a workspace can
grow its own accounts.

## The image

The build has three layers:

1. The agent runtime and its browser runtime, installed from npm at the version
   in `NOVA_ENGINE_VERSION`.
2. The `nova-bots` plugin, packed from [`../ds-bot`](../ds-bot) into
   `/opt/nova-bots/nova-bots.tgz`.
3. The Nova brand layer from [`nova/`](nova): the sign-in page, the icon, the
   wordmark, the starfield and glow layer, and the build-time patch that
   replaces the runtime's own titles, manifest and log lines with the Nova
   names.

The brand patch runs once at build time, inside the image. It never touches
your data folder.

## Permissions

The container is the only sandbox, so the image offers exactly one permission
preset, **Full access**: every bot command runs without asking. Only mount
folders the bots may change, and run the container with `PUID`/`PGID` of the
share owner so file ownership stays right.

With `BOT_ROOT=1` the bots may use `sudo` **inside** the container. That is
root in the container, not on the host: the bots still write to the mounted
folders as `PUID`/`PGID` unless they ask for sudo themselves.

## Network

The runtime binds all interfaces inside the container, and the published port
is the real boundary. The UI checks the `Host` header of every `/api` request:
loopback is always trusted, and every other name or IP you open it at must be
listed in `NOVA_TRUSTED_HOST` (no port — a bare entry trusts it on any port),
or the API answers 403.

Alternatives:

- **Host network**: set `network_mode: host` in `compose.yml` and drop `ports:`.
  The server then binds the host's interfaces directly on `NOVA_LISTEN_PORT`
  (default 3080); `NOVA_HOST=127.0.0.1` narrows it to loopback.
- **Reverse proxy / HTTPS**: the proxy must preserve the browser-visible `Host`
  header and forward WebSocket upgrades; add the public host name to
  `NOVA_TRUSTED_HOST`.

**HTTPS is recommended, not required.** The UI works over plain
`http://<LAN IP>`, but the page is not a secure context there: API keys and
secret values you type cross the network in clear text. Put a reverse proxy in
front for regular use.

## Public hostname (Cloudflare tunnel)

The helper can publish the workspace under a public name through a Cloudflare
tunnel:

```sh
~/Desktop/Nova-Bots/nova-bots.sh tunnel           # print the public URLs
~/Desktop/Nova-Bots/nova-bots.sh tunnel-status    # connector state and reachability
~/Desktop/Nova-Bots/nova-bots.sh tunnel-start     # (re)start the connector
~/Desktop/Nova-Bots/nova-bots.sh tunnel-logs      # follow the connector log
cat token | ~/Desktop/Nova-Bots/nova-bots.sh tunnel-set-token   # store the token and start
```

The connector is a **user** systemd service (`cloudflared-bots.service`), so it
needs no root and comes back after a reboot without a login (lingering is on).
Its files:

| Path | What it is |
|---|---|
| `~/.nova/cloudflared/config-bots.yml` | The ingress rules: the public hostname → `http://127.0.0.1:13080` |
| `~/.nova/cloudflared/token-bots` | The tunnel token, mode 0600 |
| `~/.config/systemd/user/cloudflared-bots.service` | The boot unit |

The public hostname must also be in `NOVA_TRUSTED_HOST`, otherwise the API
answers 403 behind the tunnel.

## Environment variables

`docker/.env` holds every setting; `docker/.env.example` lists them all.

| Variable | Purpose |
|---|---|
| `NOVA_API_KEY` | API key for the model endpoint |
| `NOVA_BASE_URL` | Override the endpoint (Anthropic-Messages-compatible) |
| `NOVA_TRUSTED_HOST` | Comma-separated host names / IPs the UI answers to |
| `NOVA_PORT` | Published host port of the web front end (default 13080) |
| `NOVA_ENGINE_PORT` | Loopback port of the engine itself (default 13083) |
| `NOVA_HOST` | Bind address: `0.0.0.0` (default) or `127.0.0.1`; only relevant with `network_mode: host` |
| `NOVA_LISTEN_PORT` | Listen port inside the container (default 3080) |
| `PUID` / `PGID` | User/group the server runs as and new files belong to |
| `HOST_SHARE` | One host folder, mounted at `/host` for the bots |
| `BOT_MOUNTS` | Extra folders, each mounted under `/host` by name |
| `BOT_ROOT` | `1` lets the bots use sudo inside the container |
| `NOVA_TELEMETRY_DISABLED` | `1` turns off anonymous telemetry |
| `NOVA_ENGINE_VERSION` | Runtime version to build in (build argument) |
| `NPM_REGISTRY` | npm registry for the build (mainland China mirror) |

## Custom model endpoint

For an OpenAI-compatible relay, create `DATA_DIR/cordis.patch.yml` before the
first start — the runtime's home-level patch layer, applied after the
profile's own — with a provider and a default-model row, and pass the key as
an env var:

```yaml
- id: llm-pi-ai
  config:
    providers:
      relay:
        apiKeyEnv: RELAY_API_KEY
        api: openai-completions          # or openai-responses / anthropic-messages
        baseURL: http://host.docker.internal:3425/v1
        models:
          - id: my-model
            contextWindow: 131072
            maxTokens: 8192
- id: agent-default-model
  config:
    provider: relay
    model: my-model
```

Add `RELAY_API_KEY` to `docker/.env`. The alternative is Settings → Models in
the UI, which writes the same config.

## Data

- `/data` (`DATA_DIR`) is the runtime home: the team and chats (`bot/`,
  `sessions/`), profiles, settings and the login cookie key.
- `/workspace` (`WORKSPACE_DIR`) is the team workspace where the bots work.
- `/host` (`HOST_SHARE`) is the host folder the bots may read and write.

A rebuild reuses the persisted data and workspace. Keep their container
destinations unchanged when you rebuild or move the host directories; the team
records those destinations, not the host paths.

**Backup**: stop the container, then copy both `DATA_DIR` and `WORKSPACE_DIR`.
Restore by putting both folders back and starting again.

On every start, entries in `/data` with a different owner or group are assigned
to `PUID`/`PGID`, including existing profiles and restored files. This scans
the data directory, so large histories can take longer to start. It does not
follow symbolic links or descend into other filesystems. A populated
`/workspace` keeps its ownership; if you change `PUID`/`PGID`, grant the new
user access to that share on the host.

## Updating

```sh
~/Desktop/Nova-Bots/nova-bots.sh rebuild   # build the image, then start
```

A rebuild changes the image and the runtime it contains. An existing persisted
profile keeps its own plugin copy, so after a rebuild the plugin is refreshed
once:

```sh
docker exec -u node -e HOME=/home/node -e DSH_HOME=/data nova-bots \
  sh -c 'dsh plugin --profile web remove nova-bots && dsh plugin --profile web add /opt/nova-bots/nova-bots.tgz'
docker restart nova-bots
```

The helper's `rebuild` does the build and the start; refresh the profile
plugin as shown above so the interface picks up the new bundle.

Every build input is pinned — the base image by digest, the runtime by
version, the npm packages by exact version. See [PINNED.md](PINNED.md).

## Limits

- Over plain http, API keys and secret values you type cross the network in
  clear text — use HTTPS off-box (see [Network](#network)).
- Full access is the only permission mode: a bot can change everything the
  container can see.
- The web runtime has no bot browser; the bots read pages through the browser
  the image ships instead.

## Testing

After building the image, run `node docker/test.mjs nova-bots:local` from the
repository root. The test uses isolated, network-disabled containers and
temporary Docker volumes, with no host directory mounts or model calls. It
checks entrypoint permissions, first start, UID/GID changes, restored files,
workspace ownership and web startup. All test containers and volumes are
removed when it finishes.
