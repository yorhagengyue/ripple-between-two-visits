#!/usr/bin/env bash
# Prepare the hosting server once (C2 track P; docs/plan/hosting.md 5.6). Sent and started by scripts/deploy/provision.ts
# together with the files next to it; runs as root on Ubuntu 24.04. Safe to run again: it only adds what is missing and
# replaces one of its own files only when its content changed (the old one is kept as <file>.prev).
#
#   bash provision.sh [<node version> [<postgres major>]]      defaults: 24.15.0 17
#
# What it does: time zone Asia/Singapore; package updates and automatic security updates; 2 GB swap when there is none;
# Node (the fixed version from nodejs.org, checked against its SHASUMS256.txt); Caddy (its own apt source, or Ubuntu's
# package when that source cannot be read); the
# PostgreSQL client of the given major version from apt.postgresql.org (Ubuntu's own is 16 and cannot dump a 17
# server); age and rclone; the service user "ripple"; the folders; the systemd units for the app, the backup and the
# backup check; Caddy's configuration with the origin lock; the journal's size and age limits.
#
# What it never does:
#   - it does not touch the SSH server's configuration or any firewall: at the end it prints what the owner should
#     check and change by hand;
#   - it does not create, replace or read the contents of /etc/ripple/web.env, /etc/ripple/backup.env,
#     /etc/ripple/backup.age.pub or /etc/caddy/edge.env (push-env and push-secrets own those);
#   - it does not start the app (nothing is released yet) and it leaves Caddy stopped until a usable origin lock is
#     in place.
#
# RIPPLE_SANDBOX_ROOT (tests only): a folder that stands in for / so the script can run on a developer's computer with
# stand-in commands.
set -euo pipefail
# nobody is at the keyboard: no package question, and services that want a restart after an update are listed, not restarted
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=l

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
R="${RIPPLE_SANDBOX_ROOT:-}"
NODE_VERSION="${1:-24.15.0}"
PG_MAJOR="${2:-17}"
TZ_NAME="Asia/Singapore"

case "$NODE_VERSION" in *[!0-9.]* | "") echo "ripple-provision: bad node version" >&2; exit 2 ;; esac
case "$PG_MAJOR" in *[!0-9]* | "") echo "ripple-provision: bad postgres major version" >&2; exit 2 ;; esac
if [ -z "$R" ] && [ "$(id -u)" != "0" ]; then
  echo "ripple-provision: run as root (sudo bash provision.sh)" >&2
  exit 2
fi

say() { printf 'ripple-provision: %s\n' "$*"; }

# put <mode> <file next to this script> <destination>: install it when it is missing or differs (keeping the old one
# as .prev). Answers 0 when something was written, 1 when the destination was already the same.
put() {
  local mode="$1" src="$HERE/$2" dest="$R$3"
  if [ -f "$dest" ] && cmp -s "$src" "$dest"; then return 1; fi
  if [ -f "$dest" ]; then cp -p "$dest" "$dest.prev"; fi
  install -m "$mode" -o root -g root "$src" "$dest"
  say "installed $3"
  return 0
}

apt_install() { apt-get -y -q -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold install "$@" </dev/null; }

# ---------------------------------------------------------------- 1. time zone
if [ "$(timedatectl show -p Timezone --value 2>/dev/null || true)" != "$TZ_NAME" ]; then
  timedatectl set-timezone "$TZ_NAME"
  say "time zone set to $TZ_NAME"
fi

# ---------------------------------------------------------------- 2. updates
# One unreadable apt source makes every apt-get update fail. The one source this script adds that has been unreadable
# is Caddy's own (see the Caddy step below; 402 on 2026-10-11), and a run that stopped there leaves its list behind.
# So when the update fails and that list is present, it is taken out and the update is tried once more.
CADDY_KEY="$R/usr/share/keyrings/caddy-stable-archive-keyring.gpg"
CADDY_LIST="$R/etc/apt/sources.list.d/caddy-stable.list"
if ! apt-get update -q </dev/null; then
  if [ -f "$CADDY_LIST" ]; then
    rm -f "$CADDY_KEY" "$CADDY_LIST"
    say "Caddy's own apt source could not be read: it is taken out (a Caddy that is already installed stays as it is)"
    apt-get update -q </dev/null
  else
    echo "ripple-provision: apt-get update failed" >&2
    exit 1
  fi
fi
# keep every configuration file as it is on this machine (the SSH server's included) when a package brings a new one
apt-get -y -q -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold upgrade </dev/null
apt_install ca-certificates curl gnupg xz-utils unattended-upgrades
mkdir -p "$R/etc/apt/apt.conf.d"
if [ ! -f "$R/etc/apt/apt.conf.d/20auto-upgrades" ]; then
  printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > "$R/etc/apt/apt.conf.d/20auto-upgrades"
  say "automatic security updates switched on"
fi

# ---------------------------------------------------------------- 3. swap (the build must not be killed for memory)
if [ -z "$(swapon --show --noheadings 2>/dev/null || true)" ] && [ ! -f "$R/swapfile" ]; then
  fallocate -l 2G "$R/swapfile"
  chmod 600 "$R/swapfile"
  mkswap "$R/swapfile" >/dev/null
  swapon "$R/swapfile"
  mkdir -p "$R/etc"
  if ! grep -q '^/swapfile ' "$R/etc/fstab" 2>/dev/null; then echo '/swapfile none swap sw 0 0' >> "$R/etc/fstab"; fi
  say "2 GB swap added"
fi

# ---------------------------------------------------------------- 4. Node, a fixed version, checked
NODE_DIR="/opt/node-v$NODE_VERSION"
if [ ! -x "$R$NODE_DIR/bin/node" ]; then
  case "$(uname -m)" in
    x86_64) NODE_ARCH=x64 ;;
    aarch64) NODE_ARCH=arm64 ;;
    *) echo "ripple-provision: unsupported machine type" >&2; exit 1 ;;
  esac
  NODE_TAR="node-v$NODE_VERSION-linux-$NODE_ARCH.tar.xz"
  T="$(mktemp -d)"
  curl -fsSL -o "$T/$NODE_TAR" "https://nodejs.org/dist/v$NODE_VERSION/$NODE_TAR"
  curl -fsSL -o "$T/SHASUMS256.txt" "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
  grep " $NODE_TAR\$" "$T/SHASUMS256.txt" > "$T/sum.txt"
  (cd "$T" && sha256sum -c sum.txt >/dev/null)
  mkdir -p "$R$NODE_DIR"
  tar -xJf "$T/$NODE_TAR" -C "$R$NODE_DIR" --strip-components=1
  rm -rf "$T"
  say "Node $NODE_VERSION installed in $NODE_DIR"
fi
mkdir -p "$R/usr/local/bin"
for b in node npm npx; do ln -sfn "$NODE_DIR/bin/$b" "$R/usr/local/bin/$b"; done

# ---------------------------------------------------------------- 5. Caddy: its own apt source, else Ubuntu's package
# Caddy's own source gives the current version. When apt cannot read it (on the first real run, 2026-10-11, it answered
# "402 Payment Required") the source is taken out again, so apt keeps working for the steps below, and Ubuntu's own
# package is installed: older (2.6 on Ubuntu 24.04), and enough for the Caddyfile this script installs (a header matcher,
# handle, reverse_proxy with header_up, respond, certificates by itself).
if ! command -v caddy >/dev/null 2>&1; then
  apt_install debian-keyring debian-archive-keyring apt-transport-https
  mkdir -p "$R/usr/share/keyrings" "$R/etc/apt/sources.list.d"
  if curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o "$CADDY_KEY" \
    && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > "$CADDY_LIST" \
    && chmod o+r "$CADDY_KEY" "$CADDY_LIST" \
    && apt-get update -q </dev/null; then
    say "Caddy comes from its own apt source"
  else
    rm -f "$CADDY_KEY" "$CADDY_LIST"
    apt-get update -q </dev/null
    say "Caddy's own apt source could not be read: it is taken out again, and Ubuntu's package is installed instead"
  fi
  apt_install caddy
  say "Caddy installed"
fi

# ---------------------------------------------------------------- 6. the PostgreSQL client that matches the database
if [ ! -x "$R/usr/lib/postgresql/$PG_MAJOR/bin/pg_dump" ]; then
  apt_install postgresql-common
  "$R/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh" -y </dev/null
  apt_install "postgresql-client-$PG_MAJOR"
  say "PostgreSQL client $PG_MAJOR installed (the backup calls /usr/lib/postgresql/$PG_MAJOR/bin/pg_dump by its full path)"
fi

# ---------------------------------------------------------------- 7. backup tools
apt_install age rclone

# ---------------------------------------------------------------- 8. the service user and the folders
if ! id ripple >/dev/null 2>&1; then
  useradd --system --home-dir /srv/ripple --no-create-home --shell /usr/sbin/nologin ripple
  say "service user ripple created (it cannot log in)"
fi
install -d -m 0755 -o root -g root "$R/srv/ripple" "$R/usr/local/lib/ripple" "$R/var/lib/ripple-backup" "$R/etc/systemd/system" "$R/etc/systemd/journald.conf.d" "$R/etc/systemd/system/caddy.service.d" "$R/etc/caddy"
# each release folder and the shared folder (spend ledger, npm cache) belong to the service user: it builds and runs there
install -d -m 0755 -o ripple -g ripple "$R/srv/ripple/releases" "$R/srv/ripple/shared" "$R/srv/ripple/shared/npm-cache"
# only root reads the environment files; the scripts that own them put them here later
install -d -m 0700 -o root -g root "$R/etc/ripple"

# ---------------------------------------------------------------- 9. our files
units_changed=0
caddy_changed=0
journal_changed=0
for unit in ripple-web.service ripple-backup.service ripple-backup.timer ripple-backup-check.service ripple-backup-check.timer; do
  if put 0644 "$unit" "/etc/systemd/system/$unit"; then units_changed=1; fi
done
if put 0644 caddy-ripple.conf /etc/systemd/system/caddy.service.d/ripple.conf; then units_changed=1; caddy_changed=1; fi
if put 0755 check-edge-secret.sh /usr/local/lib/ripple/check-edge-secret.sh; then caddy_changed=1; fi
if put 0755 backup.mjs /usr/local/lib/ripple/backup.mjs; then :; fi
if put 0755 backup-check.mjs /usr/local/lib/ripple/backup-check.mjs; then :; fi
if put 0644 Caddyfile /etc/caddy/Caddyfile; then caddy_changed=1; fi
if put 0644 journald-ripple.conf /etc/systemd/journald.conf.d/ripple.conf; then journal_changed=1; fi

if [ "$units_changed" = "1" ]; then systemctl daemon-reload; fi
if [ "$journal_changed" = "1" ]; then systemctl restart systemd-journald; fi
# the app starts at the first release (the unit has ConditionPathExists=/srv/ripple/current); enabled so it comes back after a restart of the machine
systemctl enable ripple-web.service >/dev/null
systemctl enable --now ripple-backup.timer ripple-backup-check.timer >/dev/null

# ---------------------------------------------------------------- 10. Caddy runs only behind a usable origin lock
systemctl enable caddy >/dev/null
if [ -f "$R/etc/caddy/edge.env" ] && grep -Eq '^EDGE_SECRET=[A-Za-z0-9_-]{32,}$' "$R/etc/caddy/edge.env"; then
  if [ "$caddy_changed" = "1" ] || [ "$(systemctl is-active caddy 2>/dev/null || true)" != "active" ]; then
    systemctl restart caddy
    say "Caddy restarted with the configuration above"
  fi
else
  systemctl stop caddy
  say "Caddy is stopped: there is no usable origin lock yet. push-secrets writes /etc/caddy/edge.env and starts it."
fi

# ---------------------------------------------------------------- 11. for the owner, by hand
say "done. Not changed by this script, for the owner to check and do by hand:"
say "  SSH server, as it is now:"
(sshd -T 2>/dev/null || true) | grep -Ei '^(passwordauthentication|permitrootlogin|pubkeyauthentication) ' | sed 's/^/ripple-provision:     /' || true
say "  recommended (hosting.md 5.6): key login only, no root login. To set it:"
say "    printf 'PasswordAuthentication no\\nPermitRootLogin no\\n' | sudo tee /etc/ssh/sshd_config.d/60-ripple.conf"
say "    sudo sshd -t && sudo systemctl reload ssh      (keep this session open and try a second login before closing it)"
say "  firewall on this machine, as it is now: $( (ufw status 2>/dev/null || echo 'ufw not available') | head -n 1)"
say "  Lighthouse console firewall: open TCP 80 and 443 to everyone (Caddy needs both for its certificate), TCP 22 only to the owner's own address; remove other default rules such as 3389."
say "  Lighthouse console: take a snapshot of this instance now."
if [ -f "$R/var/run/reboot-required" ]; then say "  an update asks for a restart of the machine: sudo reboot, when convenient."; fi
