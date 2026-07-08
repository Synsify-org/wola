## 2026-07 — Foundation decisions
- Shared-schema multi-tenancy with FORCED RLS; DB-per-tenant rejected (ops surface). On-prem tier serves isolation demands.
- Two-role DB security model (admin vs app). App role has no DDL, no BYPASSRLS, append-only audit.
- postgres.js over an ORM for the core client; Drizzle may wrap it later for app queries.
- Host parsing lives in proxy.ts (Next 16 renamed middleware→proxy; see below), against an explicit WOLA_BASE_DOMAIN env, not label-counting. Edge runtime does zero DB work; slug passes to server components via x-tenant-slug header.
- .env auto-loads via dotenv (migrate script imports "dotenv/config"; test script uses --import dotenv/config). The Next app loads apps/web/.env.local (Next's own convention), NOT the root .env. Three environments read env three ways: scripts (dotenv), tests (--import), app (.env.local). apps/web/.env.local MUST be gitignored.
- Local compose credentials are throwaway and LOCAL-DEV-ONLY. Production uses secrets injection (SOPS/Doppler), never hardcoded values. Never copy the compose file toward prod.
- Only one project's Docker stack runs at a time on this machine (Wola and Soma both bind 5432/6379/1025/8025). `docker compose down` on one before `up` on the other. Durable fix later: per-project port blocks or compose profiles.

## 2026-07 — Next.js 16 conventions (cost a full session)
- middleware.ts is DEAD in Next 16. The file MUST be named proxy.ts AND export a function named `proxy` (not `middleware`). Symptom of getting it wrong: the tenant slug arrives EMPTY at server components (GUARD: { slug: '' }), because the deprecated middleware shim doesn't propagate modified request headers. Renaming file + export fixed it; proxy-set headers DO reach server components once named correctly.
- Server Actions need serverActions.allowedOrigins in next.config.ts listing every dev subdomain (testco.localhost:3000, other.localhost:3000, localhost:3000). Without it: "Invalid Server Actions request — x-forwarded-host does not match origin". Production needs a real strategy for *.wola.app.

## 2026-07 — Auth decisions
- Password auth: one identity, one password on global users; authorization per-tenant via memberships. Valid password + no membership in the subdomain's tenant = rejected identically to wrong password (no enumeration leak).
- Hashing: argon2id. argon2 is a NATIVE binary — the Node version must match across dev/CI or verify() throws. Standardize Node (pin via .nvmrc or Volta). CI currently warns Node 20 deprecated / forced to 24 — align this before it bites Willy.
- Sessions: cookie holds a random 256-bit token; DB stores only its SHA-256, so a DB leak can't be replayed. Session bound to (user_id, tenant_id).
- sessions table is deliberately NOT under RLS — looked up by token BEFORE a tenant context exists. Security is the unguessable token, not tenant scoping. Do NOT add RLS to it; it would break login.
- Login cookie sets NO `domain` attribute → scoped to the exact host (testco.localhost), never the parent. This is the browser-side half of isolation; verifySession's tenant-match check is the server-side half. Both required. (Proven: a testco session is refused by other.localhost.)
- CRITICAL: auth queries touching RLS tables (memberships) MUST run inside tenantTx(). Login resolves the tenant from the subdomain first, then reads membership in that context. Outside a tenant context, current_tenant_id() is NULL and RLS hides the rows — caused a "hasUser: false" bug where the user existed but the JOIN returned nothing.
- The dummy argon2 hash in login() (verify against a fake hash when the user is missing) is load-bearing: keeps login timing uniform against enumeration. Do NOT remove it.
- Import discipline: tenantTx and Tx come from @wola/db, NOT ./tenant (this bit twice). Fix applied/planned: lib/tenant re-exports { tenantTx, type Tx } from @wola/db so app code imports everything from ./tenant consistently.
- Query typing shortcut: postgres.js returns a generic Row; page.tsx casts results via `as unknown as Product[]`. This is an assertion, not validation — a column typo won't be caught at compile time. Durable fix later: a typed query layer (Drizzle).

## 2026-07 — Testing conventions (learned the hard way)
- DB test files share ONE Postgres. Each file MUST use file-scoped tenant slugs and delete ONLY its own data. NEVER blanket `DELETE FROM tenants` — it orphans other files' rows mid-run.
- `node --test` runs files CONCURRENTLY by default. Scoped slugs avoid collisions; if races persist, force `--test-concurrency=1`.
- Every new tenant table MUST add adversarial isolation tests in the same PR. Untested RLS is unproven RLS.
- Dev-login users MUST be seeded under a tenant the tests DON'T touch, AND a NON-RESERVED slug. Tests wipe acme/umoja/cfg-*/auth-*. Reserved slugs (rejected by the slug_reserved constraint): www, app, api, admin, docs, status, mail, staging, assets, cdn, auth, billing, support, demo. Use 'testco'/'other'. Seeding under 'demo' FAILS the constraint; seeding under 'acme' gets wiped by tests.
- Put dev seed data in a re-runnable scripts/seed-dev.sql, not retyped each time (cost several re-seeds this session).
- Don't paste $-containing strings (argon2 hashes) as PowerShell command args — the shell interpolates $ and mangles them. Use a psql prompt, not the -c flag or node -e.
- Debug console.logs that print tenant ids / session internals MUST be stripped before commit — they leak into production logs. Grep for console.log, GUARD, and "SESSION CHECK" before every auth-related commit.

## Known gaps / TODO
- approval_stages.pipeline_id has no same-tenant FK guarantee. RLS blocks cross-tenant reads; a composite (tenant_id, pipeline_id) FK would block cross-tenant writes too. Revisit before loan lifecycle depends on it.
- Repo lives under personal account (joshuakyayi256/wola); move to Synsify org once it exists. Transfer is lossless. Governed by the Synsify–Willy IP agreement, still unwritten.
- Node version not pinned across dev/CI (.nvmrc / Volta). CI warns Node 20 deprecated → forced to 24. Align before argon2 breaks on a mismatched runner.
- Auth unit tests assert on raw SQL, not the real auth.ts functions. Refactor pure auth logic into a Next-independent module tests can import and call.
- Create scripts/seed-dev.sql for repeatable dev seeding.
- Add .gitattributes with `* text=auto eol=lf` to stop the LF→CRLF warnings on every Windows commit (they'll make Willy's diffs noisy).