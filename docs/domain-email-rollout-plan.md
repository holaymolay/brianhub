# BrianHub Domain + Email Rollout Plan

## Purpose
Define a production rollout plan for hosting BrianHub at `brianhub.com` with reliable transactional email (invites, notifications) and minimal rework.

## Scope
- Web app public host: `brianhub.com`
- API host: `api.brianhub.com`
- TLS everywhere
- Invite email delivery + sender domain authentication
- Production-ready config and operational checks

## Non-goals (for this rollout)
- Full enterprise auth/SSO
- Complex email marketing workflows
- Multi-region deployment

## Current baseline
- Web client currently calls a hardcoded API base (`http://localhost:3000`) in `apps/web/api.js`.
- API already has owner-gated admin invite endpoints and pluggable email sender (`services/api/src/email.js`).
- Backup scripts exist with retention and restore-check support.

## Current deployment stance
- The first production launch uses manual invite sharing, not transactional email.
- Keep `BRIANHUB_EMAIL_PROVIDER=log` and `BRIANHUB_EXPOSE_INVITE_TOKEN=true` for the initial invited beta.
- Once a real email provider is enabled, disable invite-token exposure in the admin API.

## Decisions to lock before implementation
1. Hosting target:
   - Single VM with reverse proxy (fastest)
   - Container platform (later)
2. Email provider:
   - `resend` (already partially wired)
   - Alternative provider (Postmark/SES) if needed later
3. Auth approach for first internet release:
   - Passwordless magic link
   - Token invite + one-time account setup
   - Third-party auth (Clerk/Auth0/Supabase Auth)

Recommended now: single VM + Resend + invite-based account setup.

## Architecture (target)
- Reverse proxy terminates TLS and routes:
  - `brianhub.com` -> web frontend
  - `api.brianhub.com` -> Fastify API
- API process runs behind process supervisor (`systemd`/PM2).
- SQLite persists on server disk with scheduled encrypted offsite backups.
- Email provider handles outbound transactional mail.

## Implementation phases

### Phase 1: Domain + DNS
1. Add DNS records:
   - `A`/`AAAA` for `brianhub.com` -> server IP
   - `A`/`AAAA` for `api.brianhub.com` -> same server IP (or API host)
2. Set low TTL during cutover (300s), then increase after stabilization.
3. Confirm DNS resolution from multiple resolvers.

Exit criteria:
- Both hosts resolve globally.

### Phase 2: TLS + reverse proxy
1. Install Caddy (recommended for automatic TLS) or Nginx + Certbot.
2. Configure virtual hosts:
   - `brianhub.com` serves web app.
   - `api.brianhub.com` proxies to API process port.
3. Enforce HTTPS redirect and secure headers.
4. Verify valid cert chain and auto-renew.

Exit criteria:
- HTTPS works on both hosts with auto-renewing certs.

### Phase 3: Frontend runtime API config (remove localhost dependency)
1. Replace hardcoded `API_BASE` in `apps/web/api.js`.
2. Add runtime config pattern (example):
   - `window.__BRIANHUB_CONFIG__ = { apiBase: "https://api.brianhub.com" }`
   - Fallback to localhost only in local dev.
3. Confirm no `localhost` references in production bundle/page source.

Exit criteria:
- Production frontend targets `https://api.brianhub.com` without code edits per environment.

### Phase 4: Production API config
Set and validate env vars:
- `NODE_ENV=production`
- `BRIANHUB_APP_ORIGIN=https://brianhub.com`
- `BRIANHUB_OWNER_EMAIL=brian@pipecaminc.com`
- `BRIANHUB_EMAIL_PROVIDER=resend` (or `log` for manual-invite staging/beta)
- `BRIANHUB_EMAIL_FROM=noreply@brianhub.com`
- `RESEND_API_KEY=<secret>`
- `BRIANHUB_DB=/path/to/data/brianhub.sqlite`
- `BRIANHUB_EXPOSE_INVITE_TOKEN=0` after transactional invite email is live

Also verify:
- CORS origin strictness aligns with `BRIANHUB_APP_ORIGIN`.
- Secrets are injected via environment, never committed.

Exit criteria:
- API runs with production env and no secret leakage.

### Phase 5: Email domain auth + invite delivery
1. Configure sender domain in provider (`brianhub.com`).
2. Add required DNS records from provider:
   - SPF
   - DKIM
   - Return-path/bounce if required
3. Add DMARC policy (start with monitoring mode, then tighten).
4. Send test emails:
   - Owner invite
   - Non-owner invite
   - Failure path (invalid email)
5. Confirm link uses correct app origin and token flow.

Exit criteria:
- Invites are delivered to inbox (not spam) with authenticated sender domain.

### Phase 6: Auth hardening for multi-user internet access
1. Add explicit account bootstrap and invite acceptance flow:
   - `invite_token` verification endpoint
   - account creation endpoint
   - invite state transition to accepted
2. Add session mechanism:
   - HTTP-only secure session cookie (recommended)
   - CSRF protection for browser-authenticated routes
3. Keep owner-only admin gate server-side (already present) and remove client-side trust assumptions.

Exit criteria:
- Invited users can create accounts and authenticate securely.

### Phase 7: Ops safety (backup, restore, alerting)
1. Enable scheduled backup job (`scripts/backup-db.js`) with encryption key.
2. Keep retention policy:
   - 7 daily snapshots
   - 52 weekly snapshots
   - quarterly snapshots beyond one year
3. Enable periodic restore checks (`scripts/restore-check.js`) and alert on failure.
4. Add basic monitoring:
   - API health endpoint check
   - disk usage and backup success/failure logs

Exit criteria:
- Backup + restore checks are automated and verifiably working.

## Security checklist
- [ ] No secrets in repo or client-side source
- [ ] Parameterized SQL only
- [ ] CORS restricted to production origin
- [ ] `BRIANHUB_EXPOSE_INVITE_TOKEN=0` once email delivery replaces manual invite sharing
- [ ] HTTPS-only cookies for authenticated sessions
- [ ] Audit logging for invite create/accept/fail events

## Test checklist before go-live
- [ ] `npm test` passes
- [ ] Migration run succeeds on clean DB
- [ ] Owner admin page can issue invite
- [ ] Invite email arrives and link is valid
- [ ] Non-owner cannot access admin invite endpoints
- [ ] Workflow/task/notices core paths still work on production hostnames
- [ ] Backup + restore-check pass on production-like data

## Rollout sequence (recommended)
1. Staging deploy on temporary subdomain.
2. Validate all checklists above.
3. Production deploy with low DNS TTL.
4. Smoke test critical flows.
5. Raise DNS TTL.

## Rollback plan
- Keep previous deployment artifacts/config.
- If release fails:
  - revert app process to last known good version
  - keep DB intact
  - disable invite sends if needed (`BRIANHUB_EMAIL_PROVIDER=log`)
- Restore from latest verified backup only if data integrity issue is confirmed.

## Open follow-ups (post-rollout)
- Add dedicated `status.brianhub.com`.
- Add provider failover for email.
- Add org-level domain verification and sender identity per organization.
- Add rate limiting and abuse controls for invite endpoints.
