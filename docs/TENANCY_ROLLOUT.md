# Enabling per-account isolation in production (runbook)

This turns on `NOVA_TENANCY=isolated` on the live host: every account gets
its own engine container, and the admin keeps the existing `nova-bots` engine
as its own tenant. Nothing here changes the engine image, the engine
container, nginx or the tunnel. The only process restarted is the portal.

Time: about 10 minutes. Users notice one thing: **everyone signs in again
once** (sessions are now HMAC-signed; tokens signed the old way no longer
verify).

## 0. Preconditions

- PR #1 (fail-closed gate) and this PR merged; the live checkout updated by
  the owner (`git -C ~/Desktop/Nova-Bots pull` on the merged branch).
- `cd ~/Desktop/Nova-Bots/portal && npm ci && npm test` passes.
- The engine image `nova-bots:local` exists (`docker image inspect nova-bots:local`).
- Free capacity: `free -g` shows at least `NOVA_TENANT_MAX_RUNNING x 1.5 GB`
  available beyond what the host already uses (see RUNNING.md, Capacity).

## 1. Host firewall (root, once)

Tenants must not reach host services through their gateway (the portal on
`0.0.0.0:13081`, services bound to `172.17.0.1`, the LAN router and other
private ranges). The internet stays open, and DNS goes to the public
resolvers the tenants are started with (`NOVA_TENANT_DNS`, default
`1.1.1.1,1.0.0.1`). The host's own upstream is the Wi-Fi router, a `10.x`
address that this firewall blocks, so the two resolver lists must match.

```sh
sh ~/Desktop/Nova-Bots/ops/tenant-firewall.sh plan          # read the ordered rules first
sudo install -m 0755 ~/Desktop/Nova-Bots/ops/tenant-firewall.sh /usr/local/sbin/nova-bots-tenant-firewall
sudo install -m 0644 ~/Desktop/Nova-Bots/ops/nova-bots-tenant-firewall.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nova-bots-tenant-firewall       # applies now and at every boot / docker restart
sudo /usr/local/sbin/nova-bots-tenant-firewall status
```

The rules match the interface name (`nb-tenants`), so they can be applied
before the tenant network exists. The unit is `PartOf=docker.service`, so a
docker restart re-applies the hook.

## 2. Settings in `portal/portal.env`

Append (keep the existing lines; `NOVA_SIGNUP_MODE=open` is already there):

```sh
NOVA_TENANCY=isolated
# The account that keeps the existing nova-bots engine (the admin):
NOVA_LEGACY_TENANT_EMAIL=<admin email>
# 32+ random characters; seals per-tenant provider keys. Generate with:
#   openssl rand -base64 48
NOVA_TENANT_SECRET_KEY=<generated>
NOVA_TENANT_TRUSTED_HOST=localhost,127.0.0.1,bots.alilabsx.com,bot.alilabsx.com
# Public resolvers for the tenants; keep equal to RESOLVERS in the firewall unit.
NOVA_TENANT_DNS=1.1.1.1,1.0.0.1
NOVA_TENANT_IDLE_MINUTES=30
NOVA_TENANT_MAX_RUNNING=10
NOVA_TENANT_MAX_TOTAL=150
NOVA_TENANT_MEMORY=1536m
NOVA_TENANT_CPUS=1.0
NOVA_TENANT_PIDS=512
NOVA_TENANT_EXPORT_DIR=/srv/nova-bots/exports
```

The portal unit has `ProtectHome=read-only`, so the export folder must sit
outside the user's home. `/srv` is such a place; create it once, owned by
the user the portal runs as:

```sh
sudo mkdir -p /srv/nova-bots/exports
sudo chown "$USER":"$USER" /srv/nova-bots/exports
chmod 700 /srv/nova-bots/exports
```

A folder outside the home needs no write exception, so the unit needs no
drop-in file for it.

## 3. Backfill: every account present now

The portal runs the same backfill on every start with tenancy on, and
allocates a tenant for each new sign-up, so this step is to *see* the mapping
first. It covers every account in the database at that moment, not a fixed
list.

```sh
cd ~/Desktop/Nova-Bots/portal
set -a; . ./portal.env; set +a
node tenants-backfill.mjs --dry-run     # read-only: prints each account and its plan
node tenants-backfill.mjs               # creates the tenants table + one row/port per account
# optional, to pay the container-creation cost now instead of on first visit:
# node tenants-backfill.mjs --provision
```

Expected: the admin is `map to the shared engine (legacy)`; every other
non-forbidden account is `new isolated tenant`; forbidden accounts are
skipped (they get a tenant if they are unforbidden later).

## 4. Restart the portal

```sh
systemctl --user restart nova-bots-portal
journalctl --user -u nova-bots-portal -n 20 --no-pager
# expect: "portal: tenancy isolated — N tenants allocated, M existing, legacy mapped"
```

## 5. Verify

```sh
P=http://127.0.0.1:13081
curl -s $P/health                                  # ok
curl -s $P/api/v1/auth/setup-status                # "tenancy":"isolated","signup_open":true
set -a; . ~/Desktop/Nova-Bots/portal/portal.env; set +a
curl -s -H "x-nova-bots-token: $NOVA_ADMIN_TOKEN" $P/api/v1/bots-admin/tenants \
  | jq '.capacity, [.tenants[] | {email, kind, state, port}]'
```

Then in a browser (or the staging e2e against the public URL):

1. Sign in as a non-admin test account, open `/app/`: the page says
   "Setting up your private workspace…" and refreshes into a fresh Nova Bots
   workspace (Orion only, no operator Bots).
   `docker ps --filter label=nova-bots.instance=production --format '{{.Names}} {{.Status}}'`
   shows `nova-bots-t-<id>`.
2. Sign in as the admin: the existing workspace with all its Bots.
3. Check that a non-admin account cannot see any admin Bot or file.
4. `curl -s -o /dev/null -w '%{http_code}\n' -H 'Accept: text/html' http://127.0.0.1:13081/app/` → `302` (no session).
5. From a tenant engine: the internet and DNS work, the host and the LAN do not:
   ```sh
   C=$(docker ps --filter label=nova-bots.role=tenant-engine --format '{{.Names}}' | head -1)
   docker exec $C sh -c "curl -s -m 10 -o /dev/null -w '%{http_code}\n' https://api.openai.com/v1/models"   # 401 = reachable
   docker exec $C sh -c "curl -s -m 4 -o /dev/null -w '%{http_code}\n' http://172.17.0.1:8080/ || true"     # 000 = blocked
   docker exec $C sh -c "curl -s -m 4 -o /dev/null -w '%{http_code}\n' http://10.162.159.131/ || true"      # 000 = blocked
   ```

## 6. Operating

```sh
T="-H x-nova-bots-token:$NOVA_ADMIN_TOKEN"
curl -s $T $P/api/v1/bots-admin/tenants | jq .                                  # list, state, usage
curl -s $T -X POST $P/api/v1/bots-admin/tenants/<id>/stop
curl -s $T -X POST $P/api/v1/bots-admin/tenants/<id>/start
curl -s $T -X POST -H 'content-type: application/json' \
  -d '{"env":{"DEEPSEEK_API_KEY":"sk-..."}}' $P/api/v1/bots-admin/tenants/<id>/key   # assign a key (recreates container, keeps data)
curl -s $T -X POST -H 'content-type: application/json' -d '{"clear":true}' $P/api/v1/bots-admin/tenants/<id>/key
curl -s $T -X POST -H 'content-type: application/json' -d '{"memory":"3g","cpus":2}' $P/api/v1/bots-admin/tenants/<id>/limits
curl -s $T -X POST -H 'content-type: application/json' -d '{"export":true}' $P/api/v1/bots-admin/tenants/<id>/delete
curl -s $T -X POST -H 'content-type: application/json' -d '{"export":true}' $P/api/v1/bots-admin/users/<user-id>/delete   # account + tenant
```

Forbidding an account stops its engine and closes its live feeds; revoking
sessions closes its live feeds.

## Rollback

Fast (keeps the code, turns isolation off):

```sh
sed -i 's/^NOVA_TENANCY=isolated/NOVA_TENANCY=shared/' ~/Desktop/Nova-Bots/portal/portal.env
systemctl --user restart nova-bots-portal
# stop the tenant engines (data stays in their volumes):
docker ps -q --filter label=nova-bots.instance=production --filter label=nova-bots.role=tenant-engine | xargs -r docker stop
```

With `shared`, the portal behaves as before this PR: admins reach the
shared engine, everyone else sees the held page, sign-up follows
`NOVA_SIGNUP_MODE`. The `tenants` table and the volumes are left in place, so
turning isolation back on resumes every tenant with its data.

Full code rollback: check out the previous portal commit and restart the
portal. Users sign in again once more. Note that the previous code signs
sessions without a key (forgeable), so prefer the fast rollback.

Remove everything tenant-related (destructive, after an export if needed):

```sh
docker ps -aq --filter label=nova-bots.instance=production --filter label=nova-bots.role=tenant-engine | xargs -r docker rm -f
docker volume ls -q --filter label=nova-bots.instance=production | xargs -r docker volume rm
docker network rm nova-bots-tenants
sudo systemctl disable --now nova-bots-tenant-firewall   # runs "remove"
sudo rm /etc/systemd/system/nova-bots-tenant-firewall.service /usr/local/sbin/nova-bots-tenant-firewall
```
