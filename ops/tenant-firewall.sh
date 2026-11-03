#!/bin/sh
# Host firewall for isolated Nova Bots tenants (run as root).
#
# Tenant engines run with full access inside their containers, so a Bot can
# open any connection the container's network allows. Docker already keeps
# tenants apart (one bridge, inter-container traffic disabled) and keeps the
# published ports on 127.0.0.1. What docker does not do is stop a tenant from
# reaching services on the HOST through its gateway address (anything bound to
# 0.0.0.0 or to a docker bridge address, e.g. 172.17.0.1:*) or private
# addresses on the LAN. This script closes that, leaving the internet open
# (the Bots need their model providers and the web).
#
#   sudo ops/tenant-firewall.sh apply     # add the rules (idempotent)
#   sudo ops/tenant-firewall.sh remove    # take them out
#   sudo ops/tenant-firewall.sh status
#
# BRIDGE is the tenant network's bridge interface (NOVA_TENANT_BRIDGE_NAME,
# default nb-tenants). The rules are not persistent across a reboot by
# themselves: run "apply" from a boot unit, or save them with
# iptables-persistent / netfilter-persistent.
set -eu

BRIDGE=${BRIDGE:-nb-tenants}
PRIVATE="10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16"
TAG="nova-bots-tenants"

rule() { # rule <check|add|del> <chain> <args...>
  op=$1; chain=$2; shift 2
  case "$op" in
    check) iptables -C "$chain" "$@" -m comment --comment "$TAG" 2>/dev/null ;;
    add) iptables -C "$chain" "$@" -m comment --comment "$TAG" 2>/dev/null || iptables -I "$chain" 1 "$@" -m comment --comment "$TAG" ;;
    del) while iptables -C "$chain" "$@" -m comment --comment "$TAG" 2>/dev/null; do iptables -D "$chain" "$@" -m comment --comment "$TAG"; done ;;
  esac
}

apply_rules() {
  # Host services: nothing from a tenant reaches the host itself, except the
  # replies to connections the host opened (the portal talking to a tenant
  # goes through the published loopback port, not this interface).
  rule add INPUT -i "$BRIDGE" -j DROP
  rule add INPUT -i "$BRIDGE" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  # Forwarded traffic: no private ranges (LAN, other containers, cloud metadata).
  for net in $PRIVATE; do
    rule add DOCKER-USER -i "$BRIDGE" -d "$net" -j DROP
  done
  rule add DOCKER-USER -i "$BRIDGE" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
}

remove_rules() {
  rule del INPUT -i "$BRIDGE" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  rule del INPUT -i "$BRIDGE" -j DROP
  rule del DOCKER-USER -i "$BRIDGE" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
  for net in $PRIVATE; do
    rule del DOCKER-USER -i "$BRIDGE" -d "$net" -j DROP
  done
}

case "${1:-status}" in
  apply) apply_rules; echo "tenant firewall applied on $BRIDGE" ;;
  remove) remove_rules; echo "tenant firewall removed from $BRIDGE" ;;
  status) iptables -S INPUT | grep "$TAG" || echo "INPUT: no tenant rules"; iptables -S DOCKER-USER | grep "$TAG" || echo "DOCKER-USER: no tenant rules" ;;
  *) echo "usage: $0 apply|remove|status" >&2; exit 2 ;;
esac
