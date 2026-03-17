#!/usr/bin/env bash
set -euo pipefail

ROGER_USER="${BRIANHUB_ROGER_USER:-roger-admin}"
APP_ROOT="${BRIANHUB_APP_ROOT:-/opt/brianhub}"
REPO_DIR="${BRIANHUB_REPO_DIR:-$APP_ROOT/repo}"
INSTALL_PATH="${BRIANHUB_ROGER_ADMIN_BIN:-/usr/local/bin/brianhub-admin}"
SUDOERS_PATH="${BRIANHUB_ROGER_SUDOERS_PATH:-/etc/sudoers.d/brianhub-roger-admin}"
SSH_PUBLIC_KEY="${BRIANHUB_ROGER_SSH_PUBLIC_KEY:-}"
SSH_PUBLIC_KEY_FILE="${BRIANHUB_ROGER_SSH_PUBLIC_KEY_FILE:-}"

fail() {
  printf '[setup-roger-admin] ERROR: %s\n' "$*" >&2
  exit 1
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || fail "must run as root"
}

resolve_repo_dir() {
  if [[ -d "$REPO_DIR/.git" ]]; then
    printf '%s\n' "$REPO_DIR"
    return 0
  fi

  local script_dir repo_guess
  script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  repo_guess="$(git -C "$script_dir/.." rev-parse --show-toplevel 2>/dev/null || true)"
  if [[ -n "$repo_guess" && -d "$repo_guess/.git" ]]; then
    printf '%s\n' "$repo_guess"
    return 0
  fi

  fail "git repo not found; expected $REPO_DIR or a git checkout containing this script"
}

read_ssh_public_key() {
  if [[ -n "$SSH_PUBLIC_KEY" ]]; then
    printf '%s\n' "$SSH_PUBLIC_KEY"
    return 0
  fi
  if [[ -n "$SSH_PUBLIC_KEY_FILE" ]]; then
    [[ -f "$SSH_PUBLIC_KEY_FILE" ]] || fail "ssh public key file not found: $SSH_PUBLIC_KEY_FILE"
    cat "$SSH_PUBLIC_KEY_FILE"
    return 0
  fi
  return 1
}

main() {
  require_root

  local repo_dir
  repo_dir="$(resolve_repo_dir)"

  if ! id "$ROGER_USER" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash "$ROGER_USER"
  fi

  install -m 0755 "$repo_dir/scripts/ops/brianhub-admin.sh" "$INSTALL_PATH"
  install -d -m 0755 /etc/sudoers.d
  sed \
    -e "s|__ROGER_USER__|$ROGER_USER|g" \
    -e "s|__INSTALL_PATH__|$INSTALL_PATH|g" \
    "$repo_dir/scripts/sudoers/brianhub-roger-admin" >"$SUDOERS_PATH"
  chmod 0440 "$SUDOERS_PATH"

  if public_key="$(read_ssh_public_key 2>/dev/null)"; then
    install -d -m 0700 -o "$ROGER_USER" -g "$ROGER_USER" "/home/$ROGER_USER/.ssh"
    printf '%s\n' "$public_key" >>"/home/$ROGER_USER/.ssh/authorized_keys"
    chown "$ROGER_USER:$ROGER_USER" "/home/$ROGER_USER/.ssh/authorized_keys"
    chmod 0600 "/home/$ROGER_USER/.ssh/authorized_keys"
  fi

  visudo -cf "$SUDOERS_PATH"

  cat <<EOF
Roger admin access is ready.

User: $ROGER_USER
Wrapper: $INSTALL_PATH
Sudoers: $SUDOERS_PATH

Allowed remote command pattern:
  ssh $ROGER_USER@<brianhub-tailnet-hostname> sudo $INSTALL_PATH status
EOF
}

main "$@"
