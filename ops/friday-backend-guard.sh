#!/usr/bin/env sh
set -eu

IPTABLES_BIN="${IPTABLES_BIN:-iptables}"
CHAIN="${FRIDAY_BACKEND_GUARD_CHAIN:-DOCKER-USER}"
PROXY_IP="${FRIDAY_PROXY_IP:-192.168.1.124}"
BACKEND_IP="${FRIDAY_BACKEND_HOST_IP:-192.168.1.64}"
BACKEND_PORT="${FRIDAY_BACKEND_PORT:-3010}"
ALLOW_COMMENT='friday-backend-guard-allow'
DROP_COMMENT='friday-backend-guard-drop'

chain_exists() { "$IPTABLES_BIN" -S "$CHAIN" >/dev/null 2>&1; }
allow_exists() {
  "$IPTABLES_BIN" -C "$CHAIN" -p tcp -s "$PROXY_IP" \
    -m conntrack --ctorigdst "$BACKEND_IP" --ctorigdstport "$BACKEND_PORT" \
    -m comment --comment "$ALLOW_COMMENT" -j ACCEPT >/dev/null 2>&1
}
drop_exists() {
  "$IPTABLES_BIN" -C "$CHAIN" -p tcp \
    -m conntrack --ctorigdst "$BACKEND_IP" --ctorigdstport "$BACKEND_PORT" \
    -m comment --comment "$DROP_COMMENT" -j DROP >/dev/null 2>&1
}
require_chain() {
  chain_exists || { echo "FRIDAY backend guard: $CHAIN is unavailable; no rules changed." >&2; exit 1; }
}
check_rules() { require_chain; allow_exists && drop_exists; }
apply_rules() {
  require_chain
  drop_exists || "$IPTABLES_BIN" -I "$CHAIN" 1 -p tcp \
    -m conntrack --ctorigdst "$BACKEND_IP" --ctorigdstport "$BACKEND_PORT" \
    -m comment --comment "$DROP_COMMENT" -j DROP
  allow_exists || "$IPTABLES_BIN" -I "$CHAIN" 1 -p tcp -s "$PROXY_IP" \
    -m conntrack --ctorigdst "$BACKEND_IP" --ctorigdstport "$BACKEND_PORT" \
    -m comment --comment "$ALLOW_COMMENT" -j ACCEPT
  check_rules
  echo "FRIDAY backend guard active: $PROXY_IP -> $BACKEND_IP:$BACKEND_PORT only."
}
remove_rules() {
  require_chain
  while allow_exists; do
    "$IPTABLES_BIN" -D "$CHAIN" -p tcp -s "$PROXY_IP" \
      -m conntrack --ctorigdst "$BACKEND_IP" --ctorigdstport "$BACKEND_PORT" \
      -m comment --comment "$ALLOW_COMMENT" -j ACCEPT
  done
  while drop_exists; do
    "$IPTABLES_BIN" -D "$CHAIN" -p tcp \
      -m conntrack --ctorigdst "$BACKEND_IP" --ctorigdstport "$BACKEND_PORT" \
      -m comment --comment "$DROP_COMMENT" -j DROP
  done
  echo 'FRIDAY backend guard rules removed.'
}

case "${1:-}" in
  apply) apply_rules ;;
  check) check_rules && echo 'FRIDAY backend guard rules are present.' ;;
  remove) remove_rules ;;
  *) echo 'usage: friday-backend-guard.sh apply|check|remove' >&2; exit 2 ;;
esac
