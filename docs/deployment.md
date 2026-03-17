# BrianHub Deployment

BrianHub is deployed as a single Node.js service plus static frontend files.

## Production shape

- Host OS: Ubuntu 24.04 LTS
- Reverse proxy: Caddy
- Runtime: Node.js 22
- App service: `systemd`
- Data store: SQLite
- Private admin network: Tailscale
- Release layout:
  - Git checkout: `/opt/brianhub/repo`
  - Immutable releases: `/opt/brianhub/releases/<timestamp>-<sha>`
  - Active release symlink: `/opt/brianhub/current`
  - State files: `/opt/brianhub/.brianhub-state`
  - Env file: `/etc/brianhub.env`
  - SQLite DB: `/var/lib/brianhub/brianhub.sqlite`
  - Backups: `/var/backups/brianhub`

## First install

1. Provision the host packages:

```bash
sudo apt update
sudo apt install -y git curl unzip rsync sudo ufw fail2ban caddy unattended-upgrades
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Or use the bootstrap helper from the repo:

```bash
curl -L https://github.com/holaymolay/brianhub/archive/refs/heads/main.tar.gz | sudo tar -xz -C /opt
sudo /opt/brianhub-main/scripts/provision-vps.sh
```

2. Create the runtime user and directories:

```bash
sudo useradd --system --create-home --shell /bin/bash brianhub || true
sudo install -d -o brianhub -g brianhub /opt/brianhub /opt/brianhub/releases /var/lib/brianhub /var/backups/brianhub
sudo git clone https://github.com/holaymolay/brianhub.git /opt/brianhub/repo
sudo chown -R brianhub:brianhub /opt/brianhub /var/lib/brianhub /var/backups/brianhub
```

3. Install the env file from `.env.example`:

```bash
sudo cp /opt/brianhub/repo/.env.example /etc/brianhub.env
sudo chown root:brianhub /etc/brianhub.env
sudo chmod 640 /etc/brianhub.env
sudoedit /etc/brianhub.env
```

Recommended launch values:

- `NODE_ENV=production`
- `HOST=127.0.0.1`
- `PORT=3100`
- `BRIANHUB_DB=/var/lib/brianhub/brianhub.sqlite`
- `BRIANHUB_MIGRATIONS=/opt/brianhub/current/services/api/db/migrations`
- `BRIANHUB_APP_ORIGIN=https://brianhub.com`
- `BRIANHUB_CORS_ORIGINS=https://brianhub.com`
- `BRIANHUB_REQUIRE_AUTH=true`
- `BRIANHUB_ALLOW_HEADER_ACTOR_AUTH=false`
- `BRIANHUB_EMAIL_PROVIDER=log`
- `BRIANHUB_EXPOSE_INVITE_TOKEN=true`
- `BRIANHUB_BACKUP_DIR=/var/backups/brianhub`

Note:

- `BRIANHUB_MIGRATIONS` should stay pointed at `/opt/brianhub/current/...` for runtime.
- `scripts/deploy.sh` overrides it during deploy so migrations run from the new release before the symlink switch.

4. Install the service and Caddy config:

```bash
DOMAIN=brianhub.com
sudo cp /opt/brianhub/repo/scripts/systemd/brianhub.service /etc/systemd/system/brianhub.service
sudo cp /opt/brianhub/repo/scripts/systemd/brianhub-backup.service /etc/systemd/system/brianhub-backup.service
sudo cp /opt/brianhub/repo/scripts/systemd/brianhub-backup.timer /etc/systemd/system/brianhub-backup.timer
sudo sed \
  -e "s/^www\\.brianhub\\.com {/www.${DOMAIN} {/" \
  -e "s/^brianhub\\.com {/${DOMAIN} {/" \
  /opt/brianhub/repo/scripts/caddy/Caddyfile | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo sed \
  -e 's|__RUNTIME_USER__|brianhub|g' \
  -e 's|__SERVICE_NAME__|brianhub.service|g' \
  /opt/brianhub/repo/scripts/sudoers/brianhub-runtime-systemctl | sudo tee /tmp/brianhub-runtime-systemctl >/dev/null
sudo install -m 0440 /tmp/brianhub-runtime-systemctl /etc/sudoers.d/brianhub-runtime-systemctl
sudo visudo -cf /etc/sudoers.d/brianhub-runtime-systemctl
sudo systemctl daemon-reload
sudo systemctl reload caddy
```

5. Install Tailscale on the BrianHub VPS and join the tailnet:

```bash
curl -fsSL https://tailscale.com/install.sh | sudo sh
sudo tailscale up --hostname=brianhub --advertise-tags=tag:brianhub,tag:server
```

If you are provisioning with an auth key, add `--auth-key=<key>` to the `tailscale up` command.

6. Run the first deploy and bootstrap the owner account:

```bash
sudo -u brianhub BRIANHUB_REPO_DIR=/opt/brianhub/repo BRIANHUB_ENV_FILE=/etc/brianhub.env /opt/brianhub/repo/scripts/deploy.sh
sudo -u brianhub bash -lc 'cd /opt/brianhub/current && set -a; source /etc/brianhub.env; set +a; node scripts/bootstrap-owner-auth.js "$BRIANHUB_OWNER_EMAIL" "<password>" "Owner Name"'
sudo systemctl enable --now brianhub.service brianhub-backup.timer
```

7. If Roger should operate the VPS, install the restricted admin path:

```bash
sudo BRIANHUB_ROGER_SSH_PUBLIC_KEY_FILE=/path/to/roger_ed25519.pub \
  /opt/brianhub/repo/scripts/setup-roger-admin.sh
```

That creates `roger-admin`, installs `/usr/local/bin/brianhub-admin`, and grants `sudo` access only to that wrapper.

## Upgrades from GitHub

Production tracks GitHub manually.

```bash
sudo -u brianhub BRIANHUB_REPO_DIR=/opt/brianhub/repo BRIANHUB_ENV_FILE=/etc/brianhub.env /opt/brianhub/current/scripts/deploy.sh
```

To deploy a specific Git ref instead of `origin/main`:

```bash
sudo -u brianhub BRIANHUB_REPO_DIR=/opt/brianhub/repo BRIANHUB_ENV_FILE=/etc/brianhub.env /opt/brianhub/current/scripts/deploy.sh <git-ref>
```

The deploy script:

- fetches `origin`
- resolves the target commit
- creates a new immutable release directory
- runs `npm ci`
- runs `npm test`
- prunes dev dependencies
- runs migrations using `/etc/brianhub.env`
- switches `/opt/brianhub/current`
- restarts `brianhub.service`
- verifies `http://127.0.0.1:$PORT/health`

Non-root deploys require passwordless `sudo` access to restart the system service. The restricted Roger admin path handles this through the wrapper described above.
The runtime user also needs restricted passwordless access to `systemctl daemon-reload`, `systemctl restart brianhub.service`, and `systemctl is-active --quiet brianhub.service`. `scripts/provision-vps.sh` installs that sudoers file automatically.

## Rollback

Rollback switches the symlink back to the prior release and restarts the service.

```bash
sudo -u brianhub BRIANHUB_ENV_FILE=/etc/brianhub.env /opt/brianhub/current/scripts/rollback.sh
```

Optional explicit target:

```bash
sudo -u brianhub BRIANHUB_ENV_FILE=/etc/brianhub.env /opt/brianhub/current/scripts/rollback.sh 20260316T010203Z-deadbeefcafe
```

## Runtime checks

```bash
systemctl status brianhub.service brianhub-backup.timer --no-pager
journalctl -u brianhub.service -n 100 --no-pager
curl -I https://brianhub.com/
curl https://brianhub.com/health
```

Expected behavior:

- `/` redirects to `/apps/web/`
- `/apps/web/*` is served by Caddy from `/opt/brianhub/current`
- API traffic is reverse proxied to `127.0.0.1:3100`

Roger operator checks:

```bash
ssh roger-admin@<brianhub-tailnet-hostname> sudo /usr/local/bin/brianhub-admin status
ssh roger-admin@<brianhub-tailnet-hostname> sudo /usr/local/bin/brianhub-admin health
```

## Manual invite beta

For the v1 human beta:

- keep `BRIANHUB_EMAIL_PROVIDER=log`
- keep `BRIANHUB_EXPOSE_INVITE_TOKEN=true`
- create invites from the admin API/UI
- manually share the returned tokenized invite URL

Do not use `X-Actor-Email` in production. Keep `BRIANHUB_ALLOW_HEADER_ACTOR_AUTH=false`.

## Backups

Nightly backups run through `brianhub-backup.timer` and `scripts/backup-db.js`.

To test manually:

```bash
sudo systemctl start brianhub-backup.service
journalctl -u brianhub-backup.service -n 50 --no-pager
```

To pull encrypted backups off-host to a local machine:

```bash
BRIANHUB_BACKUP_HOST=brianhub@your-vps \
BRIANHUB_SSH_KEY=~/.ssh/your_key \
bash scripts/sync-backups-from-host.sh
```

To automate that pull on the local machine:

```bash
mkdir -p ~/.config/systemd/user ~/.config
cp scripts/systemd-local/brianhub-backups-pull.service ~/.config/systemd/user/
cp scripts/systemd-local/brianhub-backups-pull.timer ~/.config/systemd/user/
cat > ~/.config/brianhub-backups.env <<'EOF'
BRIANHUB_BACKUP_HOST=brianhub@<brianhub-tailnet-hostname>
BRIANHUB_REMOTE_BACKUP_DIR=/var/backups/brianhub/
BRIANHUB_LOCAL_BACKUP_DIR=/home/<local-user>/WorkingDir/BrianHubBackups/
BRIANHUB_SSH_KEY=/home/<local-user>/.ssh/brianhub_backup_ed25519
EOF
systemctl --user daemon-reload
systemctl --user enable --now brianhub-backups-pull.timer
```

Use a separate SSH identity for backup pulls if you do not want the local machine to reuse the BrianHub runtime account key elsewhere.

## Phase 2 notes

Roger integration should not use public internet access or `X-Actor-Email`.

Phase 2 should add:

- private networking between the BrianHub VPS and Roger over Tailscale on both machines
- bearer-token or service-account auth
- workspace-scoped machine access
- a dedicated Roger workspace before any access to a human workspace
