# Wola — staff loan management SaaS (working title)

Multi-tenant core. The rule that governs this repo: **no query runs outside
`tenantTx()`**, and the isolation suite is merge-blocking in CI.

## Quick start
```bash
docker compose up -d          # postgres + redis + minio + mailpit
cp .env.example .env
npm install
npm run migrate               # admin role applies packages/db/migrations/*.sql
npm run test:isolation        # 10 adversarial tests must pass
```

## Layout
```
apps/            # web (Next.js) and worker land here — phase 2+
packages/db/     # migrations, tenant-scoped client, isolation tests
scripts/         # migrate runner, initdb roles
```

## Non-negotiables
1. Two DB roles: `wola_admin` (migrations, DDL) and `wola_app` (runtime,
   RLS-bound, no DDL, audit log append-only). The app never sees admin creds.
2. Every tenant table: `tenant_id` NOT NULL + FORCED RLS + composite index
   led by `tenant_id`. Copy the `employees` table as the pattern.
3. New tenant tables MUST add cases to `packages/db/test/isolation.test.mjs`.
4. Reserved subdomains live in the `slug_reserved` constraint — extend there,
   not in application code.
5. Migrations are forward-only plain SQL. No destructive change without a
   rehearsed restore.

## Decisions
Record every non-obvious choice in `DECISIONS.md` — future us will thank
present us.
