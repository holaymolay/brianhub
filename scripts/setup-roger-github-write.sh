#!/usr/bin/env bash
set -euo pipefail

REPO_SLUG="${ROGER_BRIANHUB_REPO_SLUG:-holaymolay/brianhub}"
REPO_DIR="${ROGER_BRIANHUB_REPO_DIR:-$HOME/src/brianhub}"
SSH_DIR="${HOME}/.ssh"
KEY_PATH="${ROGER_GITHUB_KEY_PATH:-$SSH_DIR/roger_github_brianhub}"
SSH_CONFIG_PATH="${ROGER_GITHUB_SSH_CONFIG:-$SSH_DIR/config}"
HOST_ALIAS="${ROGER_GITHUB_HOST_ALIAS:-github-brianhub}"
GIT_USER_NAME="${ROGER_BRIANHUB_GIT_NAME:-Roger}"
GIT_USER_EMAIL="${ROGER_BRIANHUB_GIT_EMAIL:-roger@local}"

mkdir -p "${SSH_DIR}" "$(dirname "${REPO_DIR}")"
chmod 700 "${SSH_DIR}"

if [[ ! -f "${KEY_PATH}" ]]; then
  ssh-keygen -t ed25519 -N '' -f "${KEY_PATH}" -C "roger-github-brianhub"
fi

chmod 600 "${KEY_PATH}"
chmod 644 "${KEY_PATH}.pub"

if [[ ! -f "${SSH_CONFIG_PATH}" ]] || ! grep -q "^Host ${HOST_ALIAS}\$" "${SSH_CONFIG_PATH}"; then
  cat >> "${SSH_CONFIG_PATH}" <<EOF

Host ${HOST_ALIAS}
  HostName github.com
  User git
  IdentityFile ${KEY_PATH}
  IdentitiesOnly yes
EOF
fi

chmod 600 "${SSH_CONFIG_PATH}"

if [[ ! -d "${REPO_DIR}/.git" ]]; then
  git clone "${HOST_ALIAS}:${REPO_SLUG}.git" "${REPO_DIR}"
else
  git -C "${REPO_DIR}" remote set-url origin "${HOST_ALIAS}:${REPO_SLUG}.git"
  git -C "${REPO_DIR}" fetch origin
fi

git -C "${REPO_DIR}" config user.name "${GIT_USER_NAME}"
git -C "${REPO_DIR}" config user.email "${GIT_USER_EMAIL}"

cat <<EOF
Roger GitHub write path prepared.

Repository:
  ${REPO_DIR}

Deploy-key public key:
$(cat "${KEY_PATH}.pub")

Next steps:
1. In GitHub, open ${REPO_SLUG} -> Settings -> Deploy keys.
2. Add the public key above as a new deploy key with write access enabled.
3. Verify from Roger:
   ssh -T ${HOST_ALIAS} || true
   git -C "${REPO_DIR}" fetch origin
4. Roger can then push and deploy from ${REPO_DIR}.
EOF
