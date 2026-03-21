# Roger GitHub write access

Roger already has private SSH/Tailscale access to the BrianHub VPS for deploy and health operations. This doc adds an optional second capability: GitHub write access for the BrianHub repo so Roger can edit, test, push, and deploy without relying on a laptop session.

## Recommended shape

- Use Roger's VPS as the working machine, not the production BrianHub VPS.
- Give Roger a dedicated GitHub deploy key scoped only to `holaymolay/brianhub`.
- Clone the repo into a normal working directory such as `~/src/brianhub`.
- Keep Roger's GitHub key separate from the BrianHub admin key.

## One-time setup on Roger's VPS

Run:

```bash
~/src/brianhub/scripts/setup-roger-github-write.sh
```

If the repo is not available yet, copy the script there first or run it from a checked-out copy of BrianHub.

What it does:

- generates `~/.ssh/roger_github_brianhub` if missing
- creates an SSH host alias `github-brianhub`
- clones or re-points the repo remote to `github-brianhub:holaymolay/brianhub.git`
- sets local git identity defaults for Roger

## GitHub step

The script prints Roger's public key. Add it in GitHub:

1. Open `holaymolay/brianhub`
2. Go to `Settings -> Deploy keys`
3. Add the printed public key
4. Enable write access

## Verify

On Roger's VPS:

```bash
ssh -T github-brianhub || true
git -C ~/src/brianhub fetch origin
git -C ~/src/brianhub status -sb
```

The `ssh -T` call should authenticate and GitHub should reply that shell access is not provided.

## Normal Roger workflow

Once the deploy key is active:

```bash
cd ~/src/brianhub
git pull --ff-only origin main
npm test
git push origin HEAD:main
ssh -i ~/.ssh/roger_brianhub_ed25519 roger-admin@100.116.85.13 \
  'sudo /usr/local/bin/brianhub-admin deploy'
```

## Security notes

- This should be a dedicated key only for the BrianHub repo.
- Keep it on Roger's VPS only.
- Do not reuse the BrianHub admin SSH key for GitHub.
- If Roger no longer needs write access, remove the deploy key from GitHub and delete `~/.ssh/roger_github_brianhub*`.
