# Roger remote ops

Roger should manage the BrianHub VPS over a private tailnet path, not over the public internet.

## Recommended shape

- install Tailscale on the BrianHub VPS
- install Tailscale on Roger's VPS
- join both to the same tailnet
- use a dedicated `roger-admin` Unix account on the BrianHub VPS
- allow `roger-admin` to run only the BrianHub admin wrapper with `sudo`

This keeps Roger able to deploy, roll back, inspect logs, and trigger backups without giving it unrestricted root access.

## BrianHub VPS steps

1. Install Tailscale and join the tailnet:

```bash
curl -fsSL https://tailscale.com/install.sh | sudo sh
sudo tailscale up --hostname=brianhub --advertise-tags=tag:brianhub,tag:server
```

2. Install Roger's restricted admin path:

```bash
sudo BRIANHUB_ROGER_SSH_PUBLIC_KEY_FILE=/path/to/roger_ed25519.pub \
  /opt/brianhub/repo/scripts/setup-roger-admin.sh
```

3. Verify the wrapper:

```bash
ssh roger-admin@<brianhub-tailnet-hostname> sudo /usr/local/bin/brianhub-admin status
```

## Allowed commands

The wrapper at `/usr/local/bin/brianhub-admin` supports:

- `deploy [git-ref]`
- `rollback [release]`
- `restart`
- `status`
- `logs [lines]`
- `health`
- `backup-now`
- `current-release`

## Roger VPS steps

1. Install Tailscale and join the same tailnet:

```bash
curl -fsSL https://tailscale.com/install.sh | sudo sh
sudo tailscale up --hostname=roger --advertise-tags=tag:roger,tag:server
```

2. Create or copy an SSH key that Roger can use for BrianHub admin access.
3. Add that public key when running `setup-roger-admin.sh`, unless you are using Tailscale SSH instead of OpenSSH.

Example remote command from Roger's VPS:

```bash
ssh roger-admin@<brianhub-tailnet-hostname> sudo /usr/local/bin/brianhub-admin deploy
```

## Why this is the default

- Roger gets private-network access only.
- SSH stays off the public path if you choose to close it later.
- Root privileges stay behind a narrow wrapper instead of a full shell.
- BrianHub remains upgradeable from GitHub through the same deploy script used by humans.

## Related doc

For the current production API auth model, allowed route categories, and the reasons Roger should not yet automate a human workspace through the product API, see `docs/roger-api-brief.md`.
