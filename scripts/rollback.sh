#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${BRIANHUB_APP_ROOT:-/opt/brianhub}"
RELEASES_DIR="${BRIANHUB_RELEASES_DIR:-$APP_ROOT/releases}"
CURRENT_LINK="${BRIANHUB_CURRENT_LINK:-$APP_ROOT/current}"
STATE_DIR="${BRIANHUB_STATE_DIR:-$APP_ROOT/.brianhub-state}"
ENV_FILE="${BRIANHUB_ENV_FILE:-/etc/brianhub.env}"
SERVICE_NAME="${BRIANHUB_SERVICE_NAME:-brianhub.service}"
HEALTHCHECK_PATH="${BRIANHUB_HEALTHCHECK_PATH:-/health}"

log() {
  printf '[rollback] %s\n' "$*"
}

fail() {
  printf '[rollback] ERROR: %s\n' "$*" >&2
  exit 1
}

systemctl_cmd() {
  if [[ "$(id -u)" -eq 0 ]]; then
    systemctl "$@"
    return 0
  fi
  if command -v sudo >/dev/null 2>&1; then
    if sudo -n systemctl "$@"; then
      return 0
    fi
  else
    fail "non-root rollback requires passwordless sudo for systemctl"
  fi
  fail "non-root rollback requires passwordless sudo for systemctl"
}

load_env_file() {
  [[ -f "$ENV_FILE" ]] || fail "env file not found: $ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

resolve_target_release() {
  local requested="${1:-}"
  if [[ -n "$requested" ]]; then
    if [[ -d "$requested" ]]; then
      printf '%s\n' "$(cd "$requested" && pwd)"
      return 0
    fi
    if [[ -d "$RELEASES_DIR/$requested" ]]; then
      printf '%s\n' "$RELEASES_DIR/$requested"
      return 0
    fi
    fail "release not found: $requested"
  fi

  if [[ -f "$STATE_DIR/previous-release.txt" ]]; then
    local previous
    previous="$(cat "$STATE_DIR/previous-release.txt")"
    [[ -d "$previous" ]] || fail "previous release missing: $previous"
    printf '%s\n' "$previous"
    return 0
  fi

  fail "no previous release recorded"
}

release_commit() {
  local meta_path="$1/.brianhub-release-meta"
  if [[ -f "$meta_path" ]]; then
    awk -F= '$1=="COMMIT_SHA"{print $2}' "$meta_path"
  fi
}

main() {
  command -v curl >/dev/null 2>&1 || fail "missing required command: curl"
  local current_release target_release tmp_link current_commit target_commit
  current_release="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
  [[ -n "$current_release" ]] || fail "current release is not set"
  target_release="$(resolve_target_release "${1:-}")"
  [[ "$target_release" != "$current_release" ]] || fail "target release is already active"

  current_commit="$(release_commit "$current_release")"
  target_commit="$(release_commit "$target_release")"

  tmp_link="${CURRENT_LINK}.next"
  ln -sfn "$target_release" "$tmp_link"
  mv -Tf "$tmp_link" "$CURRENT_LINK"

  printf '%s\n' "$current_release" >"$STATE_DIR/previous-release.txt"
  printf '%s\n' "$target_release" >"$STATE_DIR/current-release.txt"
  if [[ -n "$current_commit" ]]; then
    printf '%s\n' "$current_commit" >"$STATE_DIR/previous-commit.txt"
  fi
  if [[ -n "$target_commit" ]]; then
    printf '%s\n' "$target_commit" >"$STATE_DIR/current-commit.txt"
  fi

  load_env_file
  log "restarting $SERVICE_NAME"
  systemctl_cmd daemon-reload
  systemctl_cmd restart "$SERVICE_NAME"
  systemctl_cmd is-active --quiet "$SERVICE_NAME"

  : "${PORT:=3100}"
  curl --fail --silent --show-error --retry 10 --retry-delay 1 \
    "http://127.0.0.1:${PORT}${HEALTHCHECK_PATH}" >/dev/null

  log "rollback complete: $(basename "$target_release")"
}

main "$@"
