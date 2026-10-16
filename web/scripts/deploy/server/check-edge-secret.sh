#!/bin/sh
# Caddy's ExecStartPre (caddy-ripple.conf): exit 1 unless EDGE_SECRET, handed in by systemd from /etc/caddy/edge.env,
# is 32 or more characters of letters, digits, - and _. Never prints the value.
case "${EDGE_SECRET:-}" in
  *[!A-Za-z0-9_-]*)
    echo "ripple: EDGE_SECRET has characters other than letters, digits, - and _; Caddy will not start" >&2
    exit 1
    ;;
esac
if [ "${#EDGE_SECRET}" -lt 32 ]; then
  echo "ripple: EDGE_SECRET is missing or shorter than 32 characters; Caddy will not start (the origin lock would be open). Run push-secrets." >&2
  exit 1
fi
exit 0
