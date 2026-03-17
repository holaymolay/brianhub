#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${BRIANHUB_APP_ROOT:-/opt/brianhub}"
REPO_DIR="${BRIANHUB_REPO_DIR:-$APP_ROOT/repo}"
RELEASES_DIR="${BRIANHUB_RELEASES_DIR:-$APP_ROOT/releases}"
CURRENT_LINK="${BRIANHUB_CURRENT_LINK:-$APP_ROOT/current}"
STATE_DIR="${BRIANHUB_STATE_DIR:-$APP_ROOT/.brianhub-state}"
ENV_FILE="${BRIANHUB_ENV_FILE:-/etc/brianhub.env}"
SERVICE_NAME="${BRIANHUB_SERVICE_NAME:-brianhub.service}"
REMOTE_NAME="${BRIANHUB_DEPLOY_REMOTE:-origin}"
BRANCH_NAME="${BRIANHUB_DEPLOY_BRANCH:-main}"
TARGET_REF="${1:-${REMOTE_NAME}/${BRANCH_NAME}}"
KEEP_RELEASES="${BRIANHUB_KEEP_RELEASES:-5}"
HEALTHCHECK_PATH="${BRIANHUB_HEALTHCHECK_PATH:-/health}"
NEW_RELEASE_DIR=""
PREVIOUS_RELEASE_DIR=""
PENDING_LINK_PATH=""

log() {
  printf '[deploy] %s\n' "$*"
}

fail() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

systemctl_cmd() {
  if [[ "$(id -u)" -eq 0 ]]; then
    systemctl "$@"
    return 0
  fi
  if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    sudo -n systemctl "$@"
    return 0
  else
    fail "non-root deploy requires passwordless sudo for systemctl"
  fi
}

load_env_file() {
  [[ -f "$ENV_FILE" ]] || fail "env file not found: $ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
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

release_meta_path() {
  printf '%s/.brianhub-release-meta\n' "$1"
}

record_release_meta() {
  local release_dir="$1"
  local commit_sha="$2"
  local source_ref="$3"
  cat >"$(release_meta_path "$release_dir")" <<EOF
COMMIT_SHA=$commit_sha
SOURCE_REF=$source_ref
DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
}

prune_releases() {
  local keep_count="$1"
  local current_release previous_release release
  current_release="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
  previous_release="$(cat "$STATE_DIR/previous-release.txt" 2>/dev/null || true)"
  mapfile -t releases < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | awk '{print $2}')
  local kept=0
  for release in "${releases[@]}"; do
    if [[ "$release" == "$current_release" || "$release" == "$previous_release" ]]; then
      kept=$((kept + 1))
      continue
    fi
    if (( kept < keep_count )); then
      kept=$((kept + 1))
      continue
    fi
    rm -rf -- "$release"
  done
}

cleanup_on_error() {
  local active_release=""
  active_release="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
  if [[ -n "$NEW_RELEASE_DIR" && -n "$PREVIOUS_RELEASE_DIR" && "$active_release" == "$NEW_RELEASE_DIR" ]]; then
    log "deploy failed after switch; restoring previous release"
    if [[ -n "$PENDING_LINK_PATH" ]]; then
      ln -sfn "$PREVIOUS_RELEASE_DIR" "$PENDING_LINK_PATH"
      mv -Tf "$PENDING_LINK_PATH" "$CURRENT_LINK"
    fi
    systemctl_cmd restart "$SERVICE_NAME" || true
  fi
  if [[ -n "$NEW_RELEASE_DIR" && -d "$NEW_RELEASE_DIR" ]]; then
    active_release="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
    if [[ "$active_release" != "$NEW_RELEASE_DIR" ]]; then
      rm -rf -- "$NEW_RELEASE_DIR"
    fi
  fi
}

main() {
  require_cmd git
  require_cmd tar
  require_cmd npm
  require_cmd node
  require_cmd curl

  local repo_dir target_sha target_short timestamp release_name release_dir previous_release tmp_link
  repo_dir="$(resolve_repo_dir)"

  install -d -m 755 "$APP_ROOT" "$RELEASES_DIR" "$STATE_DIR"

  log "fetching GitHub state from $REMOTE_NAME"
  git -C "$repo_dir" fetch --prune --tags "$REMOTE_NAME"
  target_sha="$(git -C "$repo_dir" rev-parse --verify "$TARGET_REF")"
  target_short="$(git -C "$repo_dir" rev-parse --short=12 "$target_sha")"
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  release_name="${timestamp}-${target_short}"
  release_dir="$RELEASES_DIR/$release_name"

  [[ ! -e "$release_dir" ]] || fail "release dir already exists: $release_dir"

  previous_release="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
  PREVIOUS_RELEASE_DIR="$previous_release"
  if [[ -n "$previous_release" ]]; then
    printf '%s\n' "$previous_release" >"$STATE_DIR/previous-release.txt"
    if [[ -f "$(release_meta_path "$previous_release")" ]]; then
      awk -F= '$1=="COMMIT_SHA"{print $2}' "$(release_meta_path "$previous_release")" >"$STATE_DIR/previous-commit.txt"
    fi
  fi

  install -d -m 755 "$release_dir"
  NEW_RELEASE_DIR="$release_dir"
  trap cleanup_on_error ERR

  log "creating release $release_name from $target_sha"
  git -C "$repo_dir" archive --format=tar "$target_sha" | tar -xf - -C "$release_dir"
  record_release_meta "$release_dir" "$target_sha" "$TARGET_REF"

  cd "$release_dir"
  log "installing dependencies"
  npm ci
  log "running test suite"
  npm test
  log "pruning dev dependencies for runtime"
  npm prune --omit=dev

  load_env_file
  export BRIANHUB_MIGRATIONS="${BRIANHUB_DEPLOY_MIGRATIONS_DIR:-$release_dir/services/api/db/migrations}"
  log "running migrations"
  node services/api/src/migrate.js

  tmp_link="${CURRENT_LINK}.next"
  PENDING_LINK_PATH="$tmp_link"
  ln -sfn "$release_dir" "$tmp_link"
  mv -Tf "$tmp_link" "$CURRENT_LINK"
  printf '%s\n' "$release_dir" >"$STATE_DIR/current-release.txt"
  printf '%s\n' "$target_sha" >"$STATE_DIR/current-commit.txt"

  log "restarting $SERVICE_NAME"
  systemctl_cmd daemon-reload
  systemctl_cmd restart "$SERVICE_NAME"
  systemctl_cmd is-active --quiet "$SERVICE_NAME"

  : "${PORT:=3100}"
  log "waiting for healthcheck on http://127.0.0.1:${PORT}${HEALTHCHECK_PATH}"
  curl --fail --silent --show-error --retry 10 --retry-delay 1 \
    "http://127.0.0.1:${PORT}${HEALTHCHECK_PATH}" >/dev/null

  prune_releases "$KEEP_RELEASES"
  NEW_RELEASE_DIR=""
  PREVIOUS_RELEASE_DIR=""
  PENDING_LINK_PATH=""
  trap - ERR
  log "deploy complete: $release_name"
}

main "$@"
