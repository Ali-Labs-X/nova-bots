# Nova Bots — registered with Nova Ops

Nova Bots is a **separate product** from Nova. It shares this host with Nova
and nothing else: its own compose project (`nova-bots`), its own containers,
its own *user* systemd units. It never reads Nova, and Nova never reads it —
the only thing that crosses between them is this registration, which lets the
Nova Ops layer see and report on the product.

Nova Ops lives in the Nova repository (`~/Desktop/nova`). Everything below
lives there, except this file.

## Which files carry the entry

| File | What it carries |
| --- | --- |
| `~/Desktop/nova/scripts/inventory.py` | The `nova_bots` inventory item (the generator — `~/.nova/gates/inventory.json` is produced by it, never hand-edited) |
| `~/Desktop/nova/scripts/healthcheck-daemon.py` | The `P18_bots` probe and its auto-fix |
| `~/Desktop/nova/ecosystem.config.js` | The `NOVA_BOTS_*` environment for the probe, and the `nova-bots-ops` PM2 app |
| `~/Desktop/nova/scripts/pm2-nova-bots.sh` | The PM2 supervisor for the product's user units (new file) |

Nothing under `~/Desktop/nova/backend`, `frontend` or `docker` was touched.

## The topology the probe looks at

| Layer | Where | Owner |
| --- | --- | --- |
| the engine | container `nova-bots`, published on `127.0.0.1:13083` | `nova-bots.service` |
| the web front end | container `nova-bots-web`, published on `:13080` | the compose stack |
| the portal | `127.0.0.1:13081` (its own default, `NOVA_PORTAL_PORT`) | `nova-bots-portal.service` |
| the public edge | `https://bots.alilabsx.com/` | `cloudflared-bots.service` |

The portal listens on **13081**, not 13082. The probe therefore takes a
comma-separated list of candidate URLs and uses the first one that answers —
13081 first, 13082 as the second candidate — so a portal that moves does not
turn the probe red.

## The inventory entry

`nova_bots` — one item in `~/.nova/gates/inventory.json`, kind
`agent_gateway`, endpoint `http://127.0.0.1:13080`. It reports the state of
the `nova-bots` container and whether the published port answers. The file
itself is written by the gates daemon (`scripts/gates/gates-daemon.py`), which
runs `scripts/inventory.py` every 10 minutes — so a change to the generator
shows up within one cycle, with no restart.

The same file also lists `pm2_nova-bots-ops`, because that app is declared in
`ecosystem.config.js` and the inventory reports every declared app.

## The probe

`P18_bots` in the healthcheck daemon (`nova-healthcheck`). Three layers:

1. **the engine container** — `docker inspect nova-bots`. Down is **red**:
   the product is down.
2. **the portal** — `http://127.0.0.1:13081/health` (plain-text `ok`), with
   `http://127.0.0.1:13082/health` as the second candidate. Not answering is
   **amber** while it has never answered (it is a front end in front of the
   engine, not the engine) and **red** once it has been up and went away.
3. **the public edge** — `https://bots.alilabsx.com/`. A 401/403 counts as
   answered (the app's auth wall proves the origin is alive). A 5xx, a 404
   (hostname not routed) or no answer is **red**.

The probe is **skipped** (green, "skipped (NOVA_BOTS_ENABLED unset)") unless
`NOVA_BOTS_ENABLED` is set — the daemon is generic and knows nothing about
specific products. `ecosystem.config.js` sets it, together with the targets:

```
NOVA_BOTS_ENABLED=1
NOVA_BOTS_CONTAINER=nova-bots
NOVA_BOTS_PORTAL_URL=http://127.0.0.1:13081/health,http://127.0.0.1:13082/health
NOVA_BOTS_PUBLIC_URL=https://bots.alilabsx.com/
```

> The running `nova-healthcheck` process still has the code from before this
> registration. It picks the probe up at its next restart
> (`pm2 restart nova-healthcheck`) — that restart was deliberately not done
> here, because no Nova process may be restarted as part of this change.

### Auto-fix

Red is repaired after two consecutive red cycles (the daemon's own rule), and
only with the product's own **user** units — never `sudo`, and the daemon's
privilege model is unchanged:

| Failing layer | Repair |
| --- | --- |
| engine container | `systemctl --user restart nova-bots` |
| public edge | `systemctl --user restart cloudflared-bots` — only when the tunnel token is actually set; with an empty token the connector can never come up, so the daemon alerts instead of restarting |
| portal only | not repaired — the daemon does not own that service; it alerts with `systemctl --user restart nova-bots-portal` as the manual step |

## The PM2 supervisor

`nova-bots-ops` (PM2 app, script `~/Desktop/nova/scripts/pm2-nova-bots.sh`)
is the same kind of sidecar supervisor as `nova-tunnel`, one privilege level
down: no root, no `sudo`.

- keeps `nova-bots.service`, `nova-bots-portal.service` and
  `cloudflared-bots.service` up (`systemctl --user`)
- tails their user journal into `~/.nova/bots/nova-bots-ops-journal.log`
- emits a heartbeat every 30 s into
  `~/.nova/bots/nova-bots-ops-heartbeat.log`, in the same shape as the other
  supervisors:
  `2026-11-03T01:02:45Z nova-bots=active/exited nova-bots-portal=failed/failed cloudflared-bots=inactive/dead pm2=775405`

It deliberately does not start the tunnel connector while its token file is
empty, and it does not restart a unit systemd has already given up on
(`state=failed` is systemd's start limit, not something to hammer).

## Checking it by hand

```bash
# Inventory — the product entry and the supervisor entry
python3 -c "import json;d=json.load(open('/home/jahanzaib/.nova/gates/inventory.json'));print([c for c in d['checks'] if 'bots' in c['name']])"

# The probe, in isolation (does not touch the running daemon)
cd ~/Desktop/nova && NOVA_BOTS_ENABLED=1 \
  NOVA_BOTS_CONTAINER=nova-bots \
  NOVA_BOTS_PORTAL_URL="http://127.0.0.1:13081/health,http://127.0.0.1:13082/health" \
  NOVA_BOTS_PUBLIC_URL=https://bots.alilabsx.com/ \
  HEALTHCHECK_STATUS_PATH=/tmp/hc-once.json \
  python3 scripts/healthcheck-daemon.py --once | \
  python3 -c "import json,sys; print([p for p in json.load(sys.stdin)['probes'] if p['name']=='P18_bots'])"

# The layers on their own
docker inspect --format '{{.State.Status}}' nova-bots
curl -sS -o /dev/null -w 'portal http %{http_code}\n' http://127.0.0.1:13081/health
curl -sS -o /dev/null -w 'edge   http %{http_code}\n' https://bots.alilabsx.com/

# The supervisor
pm2 list nova-bots-ops
pm2 logs nova-bots-ops --lines 20 --nostream
tail -5 ~/.nova/bots/nova-bots-ops-heartbeat.log
systemctl --user status nova-bots nova-bots-portal cloudflared-bots --no-pager
```

## Removing it

1. Drop the `nova-bots-ops` app and the `NOVA_BOTS_*` block from
   `~/Desktop/nova/ecosystem.config.js`, then
   `pm2 delete nova-bots-ops && pm2 save`.
2. Delete the `P18_bots` probe, `fix_nova_bots` and its `FIX_DISPATCH` entry
   from `~/Desktop/nova/scripts/healthcheck-daemon.py`, and the `nova_bots`
   probe from `~/Desktop/nova/scripts/inventory.py`.
3. Delete `~/Desktop/nova/scripts/pm2-nova-bots.sh`.
4. Restart `nova-healthcheck` and `nova-gates` so both stop reporting it.
5. The `nova_bots` item disappears from `~/.nova/gates/inventory.json` on the
   next gates cycle (10 minutes).

Nothing outside the Nova Ops layer has to be touched: the product keeps
working exactly as before this registration.
