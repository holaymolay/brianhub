# BrianHub Push / Deploy Handover

This is the practical push/deploy path we have actually been using for BrianHub.

It is intentionally operational, not conceptual.

## Repo and branch

- Repo path on the laptop: `/home/holaymolay/WorkingDir/Code/brianhub`
- Branch: `main`
- Deploy source of truth: `origin/main`

The normal flow is:

1. commit locally on the laptop
2. push `main` to GitHub from the laptop
3. deploy from Roger's VPS through the restricted `roger-admin` path
4. verify `current-release` and `health`

## Why deploy happens from Roger's VPS

The laptop often does **not** have the BrianHub deploy SSH key installed.

The push and deploy paths are separate:

- GitHub push auth uses the laptop's GitHub key: `~/.ssh/id_ed25519`
- BrianHub deploy auth uses Roger's deploy key on Roger's VPS: `~/.ssh/roger_brianhub_ed25519`

So the reliable pattern has been:

- push from laptop
- deploy from Roger

## Push from the laptop

### Fish shell

When GitHub push fails because the Codex SSH agent socket is dead, use:

```fish
set -e SSH_AUTH_SOCK
eval (ssh-agent -c)
ssh-add ~/.ssh/id_ed25519
git -C /home/holaymolay/WorkingDir/Code/brianhub push origin main
```

### Bash equivalent

```bash
unset SSH_AUTH_SOCK
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
git -C /home/holaymolay/WorkingDir/Code/brianhub push origin main
```

### Typical failure mode

If push fails with:

```text
ssh_askpass: exec(/usr/lib/ssh/ssh-askpass): No such file or directory
git@github.com: Permission denied (publickey).
```

or:

```text
Error connecting to agent: Connection refused
```

the fix is almost always:

1. clear `SSH_AUTH_SOCK`
2. start a fresh agent
3. `ssh-add ~/.ssh/id_ed25519`
4. retry `git push`

## Deploy from Roger's VPS

Run this from Roger's VPS, not the laptop:

```bash
ssh -i ~/.ssh/roger_brianhub_ed25519 roger-admin@100.116.85.13 \
  'sudo /usr/local/bin/brianhub-admin deploy'
```

That deploys the current `origin/main`.

### Deploy a specific commit or ref

```bash
ssh -i ~/.ssh/roger_brianhub_ed25519 roger-admin@100.116.85.13 \
  'sudo /usr/local/bin/brianhub-admin deploy <git-ref>'
```

## Verify after deploy

Check current release:

```bash
ssh -i ~/.ssh/roger_brianhub_ed25519 roger-admin@100.116.85.13 \
  'sudo /usr/local/bin/brianhub-admin current-release'
```

Check health:

```bash
ssh -i ~/.ssh/roger_brianhub_ed25519 roger-admin@100.116.85.13 \
  'sudo /usr/local/bin/brianhub-admin health'
```

Expected healthy output:

```json
{"ok":true}
```

## Interpreting deploy output

During deploy, this can appear briefly:

```text
curl: (7) Failed to connect to 127.0.0.1 port 3100
```

That has been normal during service restart.

Do **not** treat that line alone as a failed deploy.

The deploy is considered successful if:

1. `brianhub-admin deploy` finishes
2. `brianhub-admin current-release` shows the expected release/commit
3. `brianhub-admin health` returns `{"ok":true}`

## Current admin wrapper commands

The restricted wrapper on the BrianHub host is:

- `deploy [git-ref]`
- `rollback [release]`
- `restart`
- `status`
- `logs [lines]`
- `health`
- `backup-now`
- `current-release`

## Quick rollback

If a release is bad:

```bash
ssh -i ~/.ssh/roger_brianhub_ed25519 roger-admin@100.116.85.13 \
  'sudo /usr/local/bin/brianhub-admin rollback'
```

Then re-check:

```bash
ssh -i ~/.ssh/roger_brianhub_ed25519 roger-admin@100.116.85.13 \
  'sudo /usr/local/bin/brianhub-admin current-release'
ssh -i ~/.ssh/roger_brianhub_ed25519 roger-admin@100.116.85.13 \
  'sudo /usr/local/bin/brianhub-admin health'
```

## Practical checklist

### Before pushing

```bash
git -C /home/holaymolay/WorkingDir/Code/brianhub status --short --branch
git -C /home/holaymolay/WorkingDir/Code/brianhub log --oneline origin/main..HEAD
```

This shows:

- whether the tree is clean
- which local commits are waiting to be pushed

### Standard release sequence

1. On laptop:

```fish
set -e SSH_AUTH_SOCK
eval (ssh-agent -c)
ssh-add ~/.ssh/id_ed25519
git -C /home/holaymolay/WorkingDir/Code/brianhub push origin main
```

2. On Roger:

```bash
ssh -i ~/.ssh/roger_brianhub_ed25519 roger-admin@100.116.85.13 \
  'sudo /usr/local/bin/brianhub-admin deploy'
```

3. Verify:

```bash
ssh -i ~/.ssh/roger_brianhub_ed25519 roger-admin@100.116.85.13 \
  'sudo /usr/local/bin/brianhub-admin current-release'
ssh -i ~/.ssh/roger_brianhub_ed25519 roger-admin@100.116.85.13 \
  'sudo /usr/local/bin/brianhub-admin health'
```

4. Browser:

- hard refresh BrianHub after deploy
- especially after frontend changes

## Known operational gotchas

- The laptop often has a dead SSH agent socket at:
  - `/home/holaymolay/.ssh/agent/codex-github.sock`
- The deploy key is often **not** present on the laptop, so trying to deploy directly from the laptop usually wastes time.
- The reliable deploy path has been Roger's VPS -> `roger-admin@100.116.85.13`.
- Frontend deploys often need a hard refresh to avoid stale JS.

## If Claude is taking over

Claude should assume:

1. push happens from the laptop repo clone
2. deploy happens from Roger's VPS
3. `current-release` + `health` are the real success checks
4. transient restart-time `curl: (7)` output is not enough to call the deploy failed
