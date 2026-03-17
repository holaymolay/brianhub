#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${BRIANHUB_APP_ROOT:-/opt/brianhub}"
REPO_DIR="${BRIANHUB_REPO_DIR:-$APP_ROOT/repo}"
CURRENT_LINK="${BRIANHUB_CURRENT_LINK:-$APP_ROOT/current}"
STATE_DIR="${BRIANHUB_STATE_DIR:-$APP_ROOT/.brianhub-state}"
ENV_FILE="${BRIANHUB_ENV_FILE:-/etc/brianhub.env}"
SERVICE_NAME="${BRIANHUB_SERVICE_NAME:-brianhub.service}"
BACKUP_TIMER_NAME="${BRIANHUB_BACKUP_TIMER_NAME:-brianhub-backup.timer}"
BACKUP_SERVICE_NAME="${BRIANHUB_BACKUP_SERVICE_NAME:-brianhub-backup.service}"
RUNTIME_USER="${BRIANHUB_RUNTIME_USER:-brianhub}"
HEALTHCHECK_PATH="${BRIANHUB_HEALTHCHECK_PATH:-/health}"

usage() {
  cat <<'EOF'
Usage: brianhub-admin <command> [args]

Commands:
  deploy [git-ref]     Deploy a new release from GitHub
  rollback [release]   Roll back to the previous or named release
  restart              Restart the BrianHub service
  status               Show BrianHub and backup unit status
  logs [lines]         Show recent BrianHub service logs (default 200 lines)
  health               Check the local health endpoint
  backup-now           Trigger a backup immediately
  current-release      Show active and previous releases
EOF
}

fail() {
  printf '[brianhub-admin] ERROR: %s\n' "$*" >&2
  exit 1
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || fail "must run as root (via sudo)"
}

run_as_runtime_user() {
  local cmd=("$@")
  runuser -u "$RUNTIME_USER" -- "${cmd[@]}"
}

load_env() {
  [[ -f "$ENV_FILE" ]] || fail "env file not found: $ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

cmd_deploy() {
  local ref="${1:-}"
  if [[ -n "$ref" ]]; then
    run_as_runtime_user env \
      BRIANHUB_APP_ROOT="$APP_ROOT" \
      BRIANHUB_REPO_DIR="$REPO_DIR" \
      BRIANHUB_ENV_FILE="$ENV_FILE" \
      BRIANHUB_SERVICE_NAME="$SERVICE_NAME" \
      "$REPO_DIR/scripts/deploy.sh" "$ref"
    return 0
  fi
  run_as_runtime_user env \
    BRIANHUB_APP_ROOT="$APP_ROOT" \
    BRIANHUB_REPO_DIR="$REPO_DIR" \
    BRIANHUB_ENV_FILE="$ENV_FILE" \
    BRIANHUB_SERVICE_NAME="$SERVICE_NAME" \
    "$REPO_DIR/scripts/deploy.sh"
}

cmd_rollback() {
  local release="${1:-}"
  if [[ -n "$release" ]]; then
    run_as_runtime_user env \
      BRIANHUB_APP_ROOT="$APP_ROOT" \
      BRIANHUB_ENV_FILE="$ENV_FILE" \
      BRIANHUB_SERVICE_NAME="$SERVICE_NAME" \
      "$CURRENT_LINK/scripts/rollback.sh" "$release"
    return 0
  fi
  run_as_runtime_user env \
    BRIANHUB_APP_ROOT="$APP_ROOT" \
    BRIANHUB_ENV_FILE="$ENV_FILE" \
    BRIANHUB_SERVICE_NAME="$SERVICE_NAME" \
    "$CURRENT_LINK/scripts/rollback.sh"
}

cmd_status() {
  systemctl status "$SERVICE_NAME" "$BACKUP_TIMER_NAME" --no-pager
}

cmd_logs() {
  local lines="${1:-200}"
  journalctl -u "$SERVICE_NAME" -n "$lines" --no-pager
}

cmd_health() {
  load_env
  : "${PORT:=3100}"
  curl --fail --silent --show-error "http://127.0.0.1:${PORT}${HEALTHCHECK_PATH}"
  printf '\n'
}

cmd_current_release() {
  printf 'current release: %s\n' "$(cat "$STATE_DIR/current-release.txt" 2>/dev/null || printf 'unknown')"
  printf 'current commit: %s\n' "$(cat "$STATE_DIR/current-commit.txt" 2>/dev/null || printf 'unknown')"
  printf 'previous release: %s\n' "$(cat "$STATE_DIR/previous-release.txt" 2>/dev/null || printf 'unknown')"
  printf 'previous commit: %s\n' "$(cat "$STATE_DIR/previous-commit.txt" 2>/dev/null || printf 'unknown')"
}

main() {
  require_root
  local command="${1:-}"
  shift || true

  case "$command" in
    deploy)
      cmd_deploy "$@"
      ;;
    rollback)
      cmd_rollback "$@"
      ;;
    restart)
      systemctl restart "$SERVICE_NAME"
      systemctl is-active --quiet "$SERVICE_NAME"
      ;;
    status)
      cmd_status
      ;;
    logs)
      cmd_logs "$@"
      ;;
    health)
      cmd_health
      ;;
    backup-now)
      systemctl start "$BACKUP_SERVICE_NAME"
      ;;
    current-release)
      cmd_current_release
      ;;
    -h|--help|help|'')
      usage
      ;;
    *)
      fail "unknown command: $command"
      ;;
  esac
}

main "$@"
