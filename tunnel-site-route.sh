#!/usr/bin/env bash
#
# Add the Nova Bots hostname to the EXISTING Cloudflare tunnel that already
# serves nova.alilabsx.com (the "site" tunnel), instead of creating a second
# tunnel.
#
# What it does:
#   1. backs up /etc/cloudflared/config.yml
#   2. inserts the bot.alilabsx.com / bots.alilabsx.com ingress rules in front
#      of the catch-all rule (idempotent: running it twice changes nothing)
#   3. restarts cloudflared-nova.service
#   4. prints the DNS record to create in the Cloudflare dashboard
#
# Run it as the desktop user (it needs sudo for the config and the restart):
#
#   ./tunnel-site-route.sh
#
set -euo pipefail

SITE_TUNNEL="b4b9e71d-1a57-47db-aafc-137b2616e715"
CONFIG="/etc/cloudflared/config.yml"
SERVICE="cloudflared-nova"

RULES='  # Nova Bots UI — added by tunnel-site-route.sh
  - hostname: bot.alilabsx.com
    path: ^/_health(/.*)?$
    service: http_status:200
  - hostname: bot.alilabsx.com
    service: http://127.0.0.1:13080
  - hostname: bots.alilabsx.com
    path: ^/_health(/.*)?$
    service: http_status:200
  - hostname: bots.alilabsx.com
    service: http://127.0.0.1:13080
'

[ -f "$CONFIG" ] || { echo "no $CONFIG — the site tunnel is not installed here" >&2; exit 1; }

if grep -q "bot.alilabsx.com" "$CONFIG"; then
  echo "the bot hostnames are already in $CONFIG"
else
  echo "→ backing up $CONFIG"
  sudo cp "$CONFIG" "$CONFIG.bak.$(date +%Y%m%d-%H%M%S)"

  echo "→ inserting the ingress rules"
  sudo python3 - "$CONFIG" "$RULES" <<'PY'
import sys
config, rules = sys.argv[1], sys.argv[2]
text = open(config).read()
lines = text.splitlines(keepends=True)
# The catch-all is the last rule of the ingress list; the bot rules go just
# above it, so the tunnel still ends on a catch-all.
catch_all = None
for index, line in enumerate(lines):
    if line.strip() == "- service: http_status:404":
        catch_all = index
if catch_all is None:
    raise SystemExit("no catch-all rule found in the ingress list")
lines.insert(catch_all, rules)
open(config, "w").write("".join(lines))
print("inserted before line", catch_all + 1)
PY
fi

echo "→ restarting $SERVICE"
sudo systemctl restart "$SERVICE"
sleep 2
systemctl --no-pager status "$SERVICE" | sed -n '1,6p'

cat <<EOF

Next: create the DNS record in the Cloudflare dashboard (DNS → Records → Add):

  Type     CNAME
  Name     bot
  Target   ${SITE_TUNNEL}.cfargotunnel.com
  Proxy    ON (proxied)
  TTL      Auto

Repeat for a second record with Name "bots" if you want that spelling too.

Then open https://bot.alilabsx.com/ — the Nova Bots login page.
EOF
