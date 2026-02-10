# Security Constraints (Binding)

This document is a binding constraint for work in this repository.

## Data safety
- Do not commit secrets, tokens, or real user data.
- Databases and local data files are private and should be gitignored.

## Input handling
- Validate external inputs before use.
- Use parameterized SQL for all database access; never build SQL with raw values.

## Logging
- Avoid logging sensitive data or PII.
- Prefer structured, minimal logs.

## Storage and access
- Use least‑privilege file access.
- Keep migrations SQL‑only; avoid executing dynamic or untrusted SQL.

## Network
- Do not exfiltrate data.
- External calls must be explicit and justified.

## Static Analysis (Semgrep)
- Run `npm run security:semgrep` before release branches and deployment candidates.
- The command uses `.semgrep.yml` plus Semgrep `p/ci` rules.
- Preferred runtime order:
  1. local `semgrep` binary if installed
  2. Docker image `returntocorp/semgrep:latest`
  3. warning only (scan skipped) when neither is installed
- Treat findings as:
  - `ERROR`: block merge until fixed or explicitly risk-accepted.
  - `WARNING`: triage and track in `.ceres/core/todo.md`.
