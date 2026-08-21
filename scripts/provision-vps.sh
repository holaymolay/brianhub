#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${BRIANHUB_APP_ROOT:-/opt/brianhub}"
REPO_DIR="${BRIANHUB_REPO_DIR:-$APP_ROOT/repo}"
RUNTIME_USER="${BRIANHUB_RUNTIME_USER:-brianhub}"
RUNTIME_GROUP="${BRIANHUB_RUNTIME_GROUP:-$RUNTIME_USER}"
REPO_URL="${BRIANHUB_REPO_URL:-https://github.com/holaymolay/brianhub.git}"
DOMAIN="${BRIANHUB_DOMAIN:-brianhub.com}"
ENV_FILE="${BRIANHUB_ENV_FILE:-/etc/brianhub.env}"
INSTALL_TAILSCALE="${BRIANHUB_INSTALL_TAILSCALE:-true}"
TAILSCALE_AUTHKEY="${BRIANHUB_TAILSCALE_AUTHKEY:-}"
TAILSCALE_HOSTNAME="${BRIANHUB_TAILSCALE_HOSTNAME:-brianhub}"
TAILSCALE_TAGS="${BRIANHUB_TAILSCALE_TAGS:-tag:brianhub,tag:server}"
INSTALL_ROGER_ADMIN="${BRIANHUB_INSTALL_ROGER_ADMIN:-false}"
SERVICE_NAME="${BRIANHUB_SERVICE_NAME:-brianhub.service}"
RUNTIME_SUDOERS_PATH="${BRIANHUB_RUNTIME_SUDOERS_PATH:-/etc/sudoers.d/brianhub-runtime-systemctl}"

log() {
  printf '[provision] %s\n' "$*"
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || {
    printf '[provision] ERROR: must run as root\n' >&2
    exit 1
  }
}

install_base_packages() {
  export DEBIAN_FRONTEND=noninteractive
  apt update
  apt install -y git curl unzip rsync sudo ufw fail2ban caddy unattended-upgrades
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt install -y nodejs
}

configure_runtime_user() {
  if ! id "$RUNTIME_USER" >/dev/null 2>&1; then
    useradd --system --create-home --shell /bin/bash "$RUNTIME_USER"
  fi
  install -d -o "$RUNTIME_USER" -g "$RUNTIME_GROUP" \
    "$APP_ROOT" \
    "$APP_ROOT/releases" \
    /var/lib/brianhub \
    /var/backups/brianhub
}

sync_repo() {
  if [[ -d "$REPO_DIR/.git" ]]; then
    log "updating existing repo checkout"
    git -C "$REPO_DIR" fetch --prune --tags origin
    git -C "$REPO_DIR" reset --hard origin/main
  else
    log "cloning repo checkout"
    git clone "$REPO_URL" "$REPO_DIR"
  fi
  chown -R "$RUNTIME_USER:$RUNTIME_GROUP" "$APP_ROOT" /var/lib/brianhub /var/backups/brianhub
}

install_env_file() {
  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$REPO_DIR/.env.example" "$ENV_FILE"
  fi
  chown root:"$RUNTIME_GROUP" "$ENV_FILE"
  chmod 640 "$ENV_FILE"
}

install_runtime_sudoers() {
  sed \
    -e "s|__RUNTIME_USER__|$RUNTIME_USER|g" \
    -e "s|__SERVICE_NAME__|$SERVICE_NAME|g" \
    "$REPO_DIR/scripts/sudoers/brianhub-runtime-systemctl" >"$RUNTIME_SUDOERS_PATH"
  chmod 0440 "$RUNTIME_SUDOERS_PATH"
  visudo -cf "$RUNTIME_SUDOERS_PATH"
}

install_service_units() {
  cp "$REPO_DIR/scripts/systemd/brianhub.service" /etc/systemd/system/brianhub.service
  cp "$REPO_DIR/scripts/systemd/brianhub-backup.service" /etc/systemd/system/brianhub-backup.service
  cp "$REPO_DIR/scripts/systemd/brianhub-backup.timer" /etc/systemd/system/brianhub-backup.timer
  systemctl daemon-reload
}

install_caddy_config() {
  install -d -m 755 /etc/caddy/sites
  sed \
    -e "s/^www\\.brianhub\\.com {/www.${DOMAIN} {/" \
    -e "s/^brianhub\\.com {/${DOMAIN} {/" \
    "$REPO_DIR/scripts/caddy/brianhub.caddy" >/etc/caddy/sites/brianhub.caddy
  # This Caddy serves other sites too. Add the include if it is missing, but
  # never rewrite the main file — that drops their blocks and their certs.
  if ! grep -q '^import sites/\*\.caddy' /etc/caddy/Caddyfile 2>/dev/null; then
    printf '\nimport sites/*.caddy\n' >>/etc/caddy/Caddyfile
  fi
  caddy validate --config /etc/caddy/Caddyfile
  systemctl reload caddy
}

configure_firewall() {
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
}

configure_unattended_upgrades() {
  dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true
}

install_tailscale() {
  if [[ "$INSTALL_TAILSCALE" != "true" ]]; then
    return 0
  fi
  log "installing tailscale"
  curl -fsSL https://tailscale.com/install.sh | sh
  if [[ -n "$TAILSCALE_AUTHKEY" ]]; then
    log "bringing tailscale online"
    tailscale up \
      --auth-key="$TAILSCALE_AUTHKEY" \
      --hostname="$TAILSCALE_HOSTNAME" \
      --advertise-tags="$TAILSCALE_TAGS"
  else
    log "tailscale installed; join the tailnet with sudo tailscale up --hostname=$TAILSCALE_HOSTNAME --advertise-tags=$TAILSCALE_TAGS"
  fi
}

maybe_install_roger_admin() {
  if [[ "$INSTALL_ROGER_ADMIN" != "true" ]]; then
    return 0
  fi
  "$REPO_DIR/scripts/setup-roger-admin.sh"
}

print_next_steps() {
  cat <<EOF

Provisioning complete.

Next steps:
1. Edit $ENV_FILE with production values.
2. Run the first deploy:
   sudo -u $RUNTIME_USER BRIANHUB_REPO_DIR=$REPO_DIR BRIANHUB_ENV_FILE=$ENV_FILE $REPO_DIR/scripts/deploy.sh
3. Bootstrap the owner account:
   sudo -u $RUNTIME_USER bash -lc 'cd $APP_ROOT/current && set -a; source $ENV_FILE; set +a; node scripts/bootstrap-owner-auth.js "\$BRIANHUB_OWNER_EMAIL" "<password>" "Owner Name"'
4. Enable runtime services:
   sudo systemctl enable --now brianhub.service brianhub-backup.timer
EOF
}

main() {
  require_root
  install_base_packages
  configure_runtime_user
  sync_repo
  install_env_file
  install_runtime_sudoers
  install_service_units
  install_caddy_config
  configure_firewall
  configure_unattended_upgrades
  install_tailscale
  maybe_install_roger_admin
  print_next_steps
}

main "$@"
