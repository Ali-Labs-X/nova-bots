#!/usr/bin/env bash
# Read-only report on the live deployment. Usage: tail-live.sh [hours]
# Changes nothing, signs in nowhere and reads no runtime home or .env file.
set -u
hours="${1:-6}"
[[ "$hours" =~ ^[0-9]+$ ]] || { echo "usage: tail-live.sh [hours]" >&2; exit 2; }
url="${NOVA_LIVE_URL:-https://bots.alilabsx.com}"
since="$(date -u -d "-${hours} hours" +%Y-%m-%dT%H:%M:%S)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

redact() {
  sed -E \
    -e 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/<email>/g' \
    -e 's/\?[^ "]+/?<query>/g' \
    -e 's/(bearer|cookie:|password[=:]|token[=:]|secret[=:]|api[_-]?key[=:]) *[^ ",]+/\1<redacted>/gI' \
    -e 's/(sk-|ghp_|eyJ)[A-Za-z0-9._-]+/<redacted>/g' \
    -e 's/\b([0-9]{1,3}\.){3}[0-9]{1,3}\b/<ip>/g' \
    -e 's/\b([0-9a-f]{1,4}:){3,7}[0-9a-f:]*/<ip6>/gI'
}
# Identical problems on one line, whatever their ids, times and counts.
group() { sed -E -e 's/[0-9a-f]{8}-[0-9a-f-]{27}/<id>/g' -e 's/[0-9a-f]{32}/<id>/g' -e 's/[0-9]+/N/g' | cut -c1-260 | sort | uniq -c | sort -rn | head -20; }
section() { printf '\n== %s\n' "$1"; }

# recent <container> <file>: the log lines of the window, with their times.
# A log damaged by a power cut reads only up to the damage, and --since then
# finds nothing: that looks like a quiet log. The last lines are read instead,
# as many as still reach the newest one.
recent() {
  local newest last first n
  newest="$(docker logs --timestamps --tail 1 "$1" 2>&1 | awk '$1>m{m=$1} END{print substr(m,1,19)}')"
  for n in 100000 40000 20000 10000 5000 2000 500 50; do
    docker logs --timestamps --tail "$n" "$1" >"$tmp/raw" 2>&1
    last="$(awk '$1>m{m=$1} END{print substr(m,1,19)}' "$tmp/raw")"
    [[ ! "$last" < "$newest" ]] && break
  done
  first="$(awk 'NR==1||$1<m{m=$1} END{print substr(m,1,19)}' "$tmp/raw")"
  awk -v since="$since" '$1>=since' "$tmp/raw" >"$2"
  if [[ -z "$newest" ]]; then echo "NOT READABLE: no log lines at all"
  elif [[ "$last" < "$newest" ]]; then echo "NOT READABLE: damaged near its end; an empty section here proves nothing"
  elif [[ "$first" > "$since" && "$n" != 100000 ]]; then echo "readable only from $first UTC (the window starts $since): damaged before that"
  fi
  return 0
}

section "public answers (401 on /app/ is correct when signed out)"
for path in / /app/ /login; do curl -sS -m 20 -o /dev/null -w "%{http_code} %{time_total}s $path\n" "$url$path" 2>&1 | redact; done

section "engine problems, ${hours}h"
recent nova-bots "$tmp/engine"
cut -d' ' -f2- "$tmp/engine" | grep -iE 'warn|error|fail|unhandled|not used|left out|timeout|did not' | redact | group

section "web front end problems, ${hours}h"
recent nova-bots-web "$tmp/web"
echo "$(wc -l <"$tmp/web") lines"
cut -d' ' -f2- "$tmp/web" | grep -E '\[(error|crit|alert|emerg)\]|" 5[0-9]{2} ' | redact | sed -E 's/^.*(\[(error|crit|alert|emerg)\])/\1/; s/^<ip> - - \[[^]]*\] //; s/ "[^"]*" "[^"]*"( "[^"]*")?$//' | group

# The live connection is logged when it ends. Many, and large, mean browsers
# that are cut off and start the same download over.
section "live connections that ended, and the heaviest paths, ${hours}h"
awk -F'"' '{split($2,r," "); split($3,s," "); p=r[2]; sub(/\?.*/,"",p); gsub(/[0-9a-f]{8}-[0-9a-f-]{27}/,"<id>",p); if(p!=""){b[p]+=s[2]; n[p]++}} END{for(k in b) printf "%.1f MB, %d x %s, %.0f KB each\n", b[k]/1e6, n[k], k, b[k]/n[k]/1e3}' "$tmp/web" | sort -rn | head -6 | redact

section "portal problems, ${hours}h"
journalctl --user -u nova-bots-portal --since "-${hours}h" --no-pager -o cat 2>/dev/null | grep -iE 'error|fail|exited|restart|not ready|not expected|nobody waited' | redact | group

section "requests cut off at the tunnel, ${hours}h"
journalctl --user -u cloudflared-bots --since "-${hours}h" --no-pager -o cat 2>/dev/null | grep 'Request failed' | grep -oE 'dest=[^ ?]+' | redact | group
echo "tunnel reconnects: $(journalctl --user -u cloudflared-bots --since "-${hours}h" --no-pager -o cat 2>/dev/null | grep -c 'Registered tunnel connection')"

section "portal connections by peer port (a growing count is a leak)"
pid="$(systemctl --user show -p MainPID --value nova-bots-portal 2>/dev/null)"
[[ "${pid:-0}" != 0 ]] && ss -Htnp state established 2>/dev/null | grep "pid=$pid," | awk '{n=split($4,a,":"); print a[n]}' | sort | uniq -c | sort -rn | head -5

# docker top does not list zombies: they have left the cgroup. /proc in the
# container still has them, the engine reads each one every time it looks at its
# process table, and they count against the container's process limit.
section "engine process table"
docker exec nova-bots sh -c 'cat /proc/[0-9]*/stat 2>/dev/null' 2>/dev/null | awk '{s=$0; sub(/^.*\) /,"",s); split(s,f," "); n++; if(f[1]=="Z") z++} END{printf "%d processes, %d zombies\n", n, z}'
echo "pids $(docker exec nova-bots cat /sys/fs/cgroup/pids.current 2>/dev/null) of $(docker exec nova-bots cat /sys/fs/cgroup/pids.max 2>/dev/null)"
engine="$(docker inspect -f '{{.State.Pid}}' nova-bots 2>/dev/null)"
[[ "$(cat "/proc/$engine/comm" 2>/dev/null)" == tini ]] && engine="$(pgrep -P "$engine" | head -1)"
if [[ -r "/proc/$engine/io" ]]; then
  cpu() { awk '{s=$0; sub(/^.*\) /,"",s); split(s,f," "); print f[12]+f[13]}' "/proc/$engine/stat"; }
  reads() { awk '/^syscr/{print $2}' "/proc/$engine/io"; }
  c0=$(cpu); r0=$(reads); sleep 5; c1=$(cpu); r1=$(reads)
  echo "engine main process: $(( (c1 - c0) / 5 ))% of a core, $(( (r1 - r0) / 5 )) reads a second"
fi

section "load"
uptime
docker stats --no-stream --format '{{.Name}} cpu {{.CPUPerc}} mem {{.MemUsage}}' nova-bots nova-bots-web 2>&1
docker top nova-bots -eo pid,pcpu,rss,comm 2>/dev/null | awk 'NR>1{c[$4]+=$2;r[$4]+=$3;n[$4]++}END{for(k in c)printf "%d%% %dMB %d %s\n",c[k],r[k]/1024,n[k],k}' | sort -rn | head -5
