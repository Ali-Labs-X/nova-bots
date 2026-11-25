#!/usr/bin/env bash
# Read-only report on the live deployment. Usage: tail-live.sh [hours]
# Changes nothing, signs in nowhere and reads no runtime home or .env file.
set -u
hours="${1:-6}"
[[ "$hours" =~ ^[0-9]+$ ]] || { echo "usage: tail-live.sh [hours]" >&2; exit 2; }
url="${NOVA_LIVE_URL:-https://bots.alilabsx.com}"

redact() {
  sed -E \
    -e 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/<email>/g' \
    -e 's/\?[^ "]+/?<query>/g' \
    -e 's/(bearer|cookie:|password[=:]|token[=:]|secret[=:]|api[_-]?key[=:]) *[^ ",]+/\1<redacted>/gI' \
    -e 's/(sk-|ghp_|eyJ)[A-Za-z0-9._-]+/<redacted>/g' \
    -e 's/\b([0-9]{1,3}\.){3}[0-9]{1,3}\b/<ip>/g'
}
# Identical problems on one line, whatever their ids, times and counts.
group() { sed -E -e 's/[0-9a-f]{8}-[0-9a-f-]{27}/<id>/g' -e 's/[0-9a-f]{32}/<id>/g' -e 's/[0-9]+/N/g' | cut -c1-260 | sort | uniq -c | sort -rn | head -20; }
section() { printf '\n== %s\n' "$1"; }

section "public answers (401 on /app/ is correct when signed out)"
for path in / /app/ /login; do curl -sS -m 20 -o /dev/null -w "%{http_code} %{time_total}s $path\n" "$url$path" 2>&1 | redact; done

section "engine problems, ${hours}h"
docker logs --since "${hours}h" nova-bots 2>&1 | grep -iE 'warn|error|fail|unhandled|not used|left out|timeout|did not' | redact | group

section "web front end problems, ${hours}h"
docker logs --since "${hours}h" nova-bots-web 2>&1 | grep -E '\[(error|crit|alert|emerg)\]|" 5[0-9]{2} ' | redact | group

section "portal problems, ${hours}h"
journalctl --user -u nova-bots-portal --since "-${hours}h" --no-pager -o cat 2>/dev/null | grep -iE 'error|fail|exited|restart' | redact | group

section "requests cut off at the tunnel, ${hours}h"
journalctl --user -u cloudflared-bots --since "-${hours}h" --no-pager -o cat 2>/dev/null | grep 'Request failed' | grep -oE 'dest=[^ ?]+' | redact | group

section "portal connections by peer port (a growing count is a leak)"
pid="$(systemctl --user show -p MainPID --value nova-bots-portal 2>/dev/null)"
[[ "${pid:-0}" != 0 ]] && ss -Htnp state established 2>/dev/null | grep "pid=$pid," | awk '{n=split($4,a,":"); print a[n]}' | sort | uniq -c | sort -rn | head -5

section "load"
uptime
docker stats --no-stream --format '{{.Name}} cpu {{.CPUPerc}} mem {{.MemUsage}}' nova-bots nova-bots-web 2>&1
docker top nova-bots -eo pid,pcpu,rss,comm 2>/dev/null | awk 'NR>1{c[$4]+=$2;r[$4]+=$3;n[$4]++}END{for(k in c)printf "%d%% %dMB %d %s\n",c[k],r[k]/1024,n[k],k}' | sort -rn | head -5
