#!/bin/sh
# Host firewall for isolated Nova Bots tenants (run as root).
#
# Tenant engines run with full access inside their containers, so a Bot can
# open any connection the container's network allows. Docker already keeps
# tenants apart (one bridge, inter-container traffic disabled) and keeps the
# published ports on 127.0.0.1. What docker does not do is stop a tenant from
# reaching services on the HOST through its gateway (anything bound to
# 0.0.0.0 or to a docker bridge address such as 172.17.0.1) or private
# addresses on the LAN (the router, other machines, cloud metadata). This
# script closes that and leaves the internet open: the Bots need their model
# providers and the web.
#
#   sudo ops/tenant-firewall.sh apply     # (re)build the rules (idempotent)
#   sudo ops/tenant-firewall.sh remove    # take them out
#   sudo ops/tenant-firewall.sh status
#   ops/tenant-firewall.sh plan           # print the ordered rules, change nothing
#
# DNS: Docker's embedded resolver (127.0.0.11) forwards queries from inside
# the container to the container's upstream servers. Without --dns those are
# the host's upstreams — on this host the Wi-Fi router, a 10.x address that
# the private-range drop blocks. The provisioner therefore starts every tenant
# with explicit public resolvers (NOVA_TENANT_DNS, default 1.1.1.1,1.0.0.1),
# and this script allows port 53 to exactly those resolvers (RESOLVERS, keep
# the two lists equal) before any drop.
#
# Settings: BRIDGE (NOVA_TENANT_BRIDGE_NAME, default nb-tenants),
# RESOLVERS (default "1.1.1.1 1.0.0.1").
#
# Layout: two chains of our own, filled in order and hooked once:
#   INPUT       -i $BRIDGE -> NOVA-TENANTS-HOST   (traffic to the host itself)
#   DOCKER-USER -i $BRIDGE -> NOVA-TENANTS-FWD    (traffic leaving the host)
# Allowed forwarded traffic RETURNs, so Docker's own FORWARD rules still run.
#
# Persistence: ops/nova-bots-tenant-firewall.service re-applies the rules at
# boot after docker (see the unit file; it is not installed automatically).
set -eu

BRIDGE=${BRIDGE:-nb-tenants}
RESOLVERS=${RESOLVERS:-1.1.1.1 1.0.0.1}
PRIVATE="10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16"
HOST_CHAIN=NOVA-TENANTS-HOST
FWD_CHAIN=NOVA-TENANTS-FWD
IPT=${IPT:-iptables}

# The ordered rule plan, one rule per line: "<host|fwd> <match and target>".
# "ALLOW" is ACCEPT in the host chain and RETURN in the forward chain.
plan() {
  for resolver in $RESOLVERS; do
    echo "fwd -d $resolver -p udp --dport 53 -j ALLOW"
    echo "fwd -d $resolver -p tcp --dport 53 -j ALLOW"
  done
  echo "fwd -m conntrack --ctstate ESTABLISHED,RELATED -j ALLOW"
  for net in $PRIVATE; do
    echo "fwd -d $net -j DROP"
  done
  echo "host -m conntrack --ctstate ESTABLISHED,RELATED -j ALLOW"
  echo "host -j DROP"
}

fill_chains() { # fill_chains <host-allow-target> <fwd-allow-target>
  for chain in $HOST_CHAIN $FWD_CHAIN; do
    $IPT -N "$chain" 2>/dev/null || true
    $IPT -F "$chain"
  done
  plan | while read -r scope rest; do
    if [ "$scope" = host ]; then chain=$HOST_CHAIN; allow=$1; else chain=$FWD_CHAIN; allow=$2; fi
    # shellcheck disable=SC2086
    $IPT -A "$chain" $(echo "$rest" | sed "s/-j ALLOW/-j $allow/")
  done
}

hook() { # hook <parent chain> <match...> -j <our chain>
  parent=$1; shift
  $IPT -C "$parent" "$@" 2>/dev/null || $IPT -I "$parent" 1 "$@"
}

unhook() {
  parent=$1; shift
  while $IPT -C "$parent" "$@" 2>/dev/null; do $IPT -D "$parent" "$@"; done
}

apply_rules() {
  # DOCKER-USER exists once docker has started; create it if we run first.
  $IPT -N DOCKER-USER 2>/dev/null || true
  fill_chains ACCEPT RETURN
  hook INPUT -i "$BRIDGE" -j "$HOST_CHAIN"
  hook DOCKER-USER -i "$BRIDGE" -j "$FWD_CHAIN"
}

remove_rules() {
  unhook INPUT -i "$BRIDGE" -j "$HOST_CHAIN"
  unhook DOCKER-USER -i "$BRIDGE" -j "$FWD_CHAIN"
  for chain in $HOST_CHAIN $FWD_CHAIN; do
    $IPT -F "$chain" 2>/dev/null || true
    $IPT -X "$chain" 2>/dev/null || true
  done
}

# For the integration test only: the same plan applied to a lab container's
# own OUTPUT chain (a container on the tenant network with NET_ADMIN), where
# the host is the network gateway. Never used on the host.
lab_apply() {
  gateway=${GATEWAY:?GATEWAY is the tenant network gateway}
  fill_chains ACCEPT RETURN
  $IPT -A OUTPUT -d "$gateway" -j "$HOST_CHAIN"
  $IPT -A OUTPUT -o eth0 -j "$FWD_CHAIN"
}

case "${1:-status}" in
  plan) plan ;;
  apply) apply_rules; echo "tenant firewall applied on $BRIDGE (resolvers: $RESOLVERS)" ;;
  remove) remove_rules; echo "tenant firewall removed from $BRIDGE" ;;
  status)
    $IPT -S INPUT | grep -- "$HOST_CHAIN" || echo "INPUT: not hooked"
    $IPT -S DOCKER-USER 2>/dev/null | grep -- "$FWD_CHAIN" || echo "DOCKER-USER: not hooked"
    $IPT -S "$HOST_CHAIN" 2>/dev/null || true
    $IPT -S "$FWD_CHAIN" 2>/dev/null || true
    ;;
  lab-apply) lab_apply ;;
  *) echo "usage: $0 plan|apply|remove|status" >&2; exit 2 ;;
esac
