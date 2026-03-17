#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${BRIANHUB_BACKUP_HOST:-}"
REMOTE_DIR="${BRIANHUB_REMOTE_BACKUP_DIR:-/var/backups/brianhub/}"
LOCAL_DIR="${BRIANHUB_LOCAL_BACKUP_DIR:-$HOME/WorkingDir/BrianHubBackups/}"
SSH_KEY="${BRIANHUB_SSH_KEY:-}"

RSYNC_OPTS=(
  -az
  --human-readable
  --partial
)

usage() {
  cat <<'EOF'
Usage: sync-backups-from-host.sh [--dry-run] [--delete]

Pull encrypted BrianHub backups from the VPS to a local mirror.

Required env:
  BRIANHUB_BACKUP_HOST   SSH host, e.g. brianhub@203.0.113.10

Optional env:
  BRIANHUB_REMOTE_BACKUP_DIR  Defaults to /var/backups/brianhub/
  BRIANHUB_LOCAL_BACKUP_DIR   Defaults to ~/WorkingDir/BrianHubBackups/
  BRIANHUB_SSH_KEY            Optional SSH private key path
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      RSYNC_OPTS+=(--dry-run)
      shift
      ;;
    --delete)
      RSYNC_OPTS+=(--delete)
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

[[ -n "$REMOTE_HOST" ]] || {
  usage >&2
  exit 1
}

mkdir -p "$LOCAL_DIR"

SSH_CMD=(
  ssh
  -o BatchMode=yes
  -o ConnectTimeout=15
)
if [[ -n "$SSH_KEY" ]]; then
  SSH_CMD+=(-i "$SSH_KEY")
fi
printf -v RSYNC_RSH '%q ' "${SSH_CMD[@]}"

rsync -e "$RSYNC_RSH" "${RSYNC_OPTS[@]}" \
  "${REMOTE_HOST}:${REMOTE_DIR}" \
  "${LOCAL_DIR%/}/"
