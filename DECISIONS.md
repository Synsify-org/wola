## 2026-07 — Foundation decisions
- Shared-schema multi-tenancy with FORCED RLS; DB-per-tenant rejected (ops surface). On-prem tier serves isolation demands.
- Two-role DB security model (admin vs app). App role has no DDL, no BYPASSRLS, append-only audit.
- postgres.js over an ORM for the core client; Drizzle may wrap it later for app queries.
- Middleware parses hosts against an explicit WOLA_BASE_DOMAIN env, not label-counting; edge runtime does zero DB work, slug passes via x-tenant-slug header.
- .env auto-loads via dotenv (migrate script imports "dotenv/config"; test script uses --import dotenv/config). No manual $env: exports.
- Local compose credentials are throwaway and LOCAL-DEV-ONLY. Production uses secrets injection (SOPS/Doppler), never hardcoded values. Never copy this compose file toward prod.
- Only one project's Docker stack runs at a time on this machine (Wola and Soma both bind 5432/6379/1025/8025). `docker compose down` on one before `up` on the other. Durable fix later: per-project port blocks or compose profiles.

## 2026-07 — Testing conventions (learned the hard way)
- DB test files share ONE Postgres. Each file MUST use file-scoped tenant slugs (e.g. 'cfg-a', 'acme') and delete ONLY its own data. NEVER blanket `DELETE FROM tenants` — it orphans other files' rows mid-run.
- `node --test` runs files CONCURRENTLY by default, so DB tests can race. Scoped slugs avoid collisions today; if races persist, force `--test-concurrency=1` on the DB suite.
- Every new tenant table MUST add adversarial isolation tests in the same PR. Untested RLS is unproven RLS.

## Known gaps / TODO
- approval_stages.pipeline_id has no same-tenant FK guarantee. RLS blocks cross-tenant reads, but a composite (tenant_id, pipeline_id) FK would block cross-tenant writes too. Revisit before loan lifecycle depends on it.
- CI has not yet been proven green in GitHub Actions (only local). Confirm on first PR.
- Repo lives under personal account (joshuakyayi256/wola); move to Synsify org once it exists. Transfer is lossless. Governed by the Synsify–Willy IP agreement, which is still unwritten.