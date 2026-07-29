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

## 2026-07 — Approval workflow decisions
- Pipelines are TENANT CONFIG (approval_pipelines/approval_stages), never code. MUA's chain is one configuration; a SACCO seeds different rows. Never hardcode a customer's approval chain.
- NO SELF-APPROVAL: the applicant's role is stripped from their own pipeline, escalating upward. MUA's "special CEO pipeline" is this same rule applied at the top of the org — it generalizes, so every role gets it free.
- Rejection TERMINATES the application (mandatory reason, DB CHECK-enforced). Send-back-a-stage was rejected: it invalidates the frozen eligibility_snapshot and muddies the audit trail.
- dept_head routes to a PERSON (employees.department_head_id), not a role. An employee with no dept head has that stage dropped (same mechanism as self-approval) — which is why the CEO's pipeline has no dept_head stage.
- UNRESOLVED, BLOCKING: car-loan cap is 40%×take-home×30 (=96m for the spec's example) per the SIGNED benefit scheme, but the briefing example says 240m (no 40%). Built to the scheme. CAR_TAKEHOME_FACTOR in eligibility.ts is the one-line switch. MUST confirm with MUA — a 2.5× lending error rides on it.

## 2026-07 — More testing traps
- `users` is GLOBAL (no tenant_id). Deleting a tenant does NOT cascade to users. Any test creating users must delete them explicitly or the fixture isn't idempotent (cost a debugging round: FK violation on re-run).
- `node --test` counts an EMPTY or unloadable test file as ONE PASSING test. A green checkmark is not proof. Always check the test COUNT, not the absence of red.
- A passing local build does NOT mean files are committed. `dist/` survives branch switches while uncommitted source vanishes — the app kept running off stale compiled JS while the .ts source was gone from disk AND git. Verify with `git ls-files`, not by whether it runs.
- git push ≠ merge. The PR must be merged with a button click on GitHub, then pulled. This has been missed 5 times.

- `users` is GLOBAL (no tenant_id), so tests CANNOT scope user cleanup by tenant.
  Every test must delete ONLY users it created, matched by a distinctive
  file-scoped email domain (e.g. '%@appr.t', '%@sess.t'). A loose pattern like
  '%@test%' will destroy the dev login users (testco) and silently break login.
  Symptom: "login fails after running the test suite."

- NEVER write an unscoped DELETE in a test. `users`, `employees`, and `audit_log`
  were all being wiped globally by isolation.test.mjs, silently destroying the
  dev fixtures (testco) on EVERY test run. Symptom: login breaks after running
  tests; re-seeding "fixes" it until the next run. Scope every cleanup by the
  file's own tenant slugs or a file-specific email domain. Cost: several hours
  across multiple sessions.

  - Every workspace package that app code (or a transpiled package) imports MUST be
  listed in next.config.ts `transpilePackages`. @wola/engine was missing → server
  actions failed with the misleading "Invalid Server Actions request". Symptom
  points at origins/config; cause is module resolution.
- NEVER write an unscoped DELETE in a test. isolation.test.mjs had bare
  `DELETE FROM users` / `DELETE FROM employees`, silently wiping the dev fixtures
  (testco) on EVERY test run. Symptom: login "randomly" breaks; re-seeding fixes it
  until the next run. Scope all cleanup by the file's own tenant slugs / email domain.
- next.config.ts changes do NOT hot-reload. Restart the dev server.


## Auth / Next 16 traps (cost ~2h)
- redirect() inside a server action can DISCARD the Set-Cookie header. The cookie
  is only committed when the action RETURNS normally. Pattern: action returns
  {ok:true}, client component uses useActionState + router.replace(). Symptom:
  POST 303 → GET / 307 → back to /login, with valid sessions in the DB.
- Browsers do not reliably store host-only cookies on .localhost SUBDOMAINS
  (testco.localhost). Dev now uses .local hostnames via the Windows hosts file
  (127.0.0.1 testco.local / other.local) + WOLA_BASE_DOMAIN=local. Real hostnames
  get normal cookie scoping, which is what preserves cross-tenant isolation.
- next.config.ts needs allowedDevOrigins for custom dev hosts, AND every workspace
  package the app imports must be in transpilePackages (@wola/engine was missing →
  misleading "Invalid Server Actions request").

  - RESOLVED 2026-07-14: car cap is 40% × take-home × 30 (=96m for the spec example).
  Confirmed with MUA HR. The 240m briefing figure was an error in the briefing.
  CAR_TAKEHOME_FACTOR = 0.40. Do not change without written confirmation.

  ## 2026-07-14 — Isolation is RLS, not the app layer
- `inboxFor` had no tenant_id predicate. This was NOT exploitable: wola_app
  has no BYPASSRLS, and loan_applications RLS keys on current_tenant_id(),
  so the rows were already filtered. Diagnosed as a live leak; it wasn't.
- Predicate added anyway. No read of tenant data should depend on one control.
- CONSEQUENCE: tenant_leak.test.mjs passes with OR without the fix, because it
  runs on the app connection (the real runtime path). A test that proves the
  app-layer filter independently would need BYPASSRLS, which the app never has.
  Accepted: the test documents intent, RLS enforces it.
- wola_admin: Superuser, BYPASSRLS. wola_app: no attributes. Fixtures use admin;
  assertions use app. Never assert on admin — it proves nothing about runtime.

## 2026-07-14 — Car cap RESOLVED
- 40% × take-home × 30 = 96m. Confirmed with MUA. The 240m briefing figure was
  an error. CAR_TAKEHOME_FACTOR = 0.40. Do not change without written confirmation.

## 2026-07-14 — Known, unfixed
- inboxFor is N+1: routeApplication (3 queries) + a metadata query PER pending
  application. page.tsx calls it just for `inbox.length` — the dashboard's
  slowest query, for one integer. Fine at ~30 applications, not at 400.
- No unique constraint on approvals(application_id, stage_id). Concurrent
  approvers can double-insert one stage. Audit-trail defect, not a routing one.
- effectiveStages strips a stage by role; if an applicant is PROMOTED mid-flight
  into an approver role, an existing approval for that stage is orphaned.
  Mitigation would be to snapshot effective stage IDs at submission.

  ## 2026-07-14 — Product rules are TENANT CONFIG (migration 0008)
- Eligibility rules moved from code to loan_products columns: cap_method
  ('salary_multiple' | 'takehome_factor'), cap_basis, cap_multiple,
  takehome_factor, takehome_multiplier, max_tenor_months, interest_applies,
  and the gates (post-probation, final warning, external declaration).
  Concurrent-product bars live in product_exclusions. Same move as approval
  pipelines: the customer's policy is DATA. MUA is one row; a SACCO is another.
- COST OF THIS: it moved the lending rules OUT FROM UNDER the test suite.
  The engine tests now prove the ENGINE is right for any config — they no
  longer prove MUA's config is right. packages/db/test/eligibility.test.mjs
  exists solely to close that gap: it asserts the SEEDED car product yields
  96,000,000 for the spec employee. Any refactor that moves rules into data
  must be accompanied by a test that pins the data.

## 2026-07-14 — Car cap CONFIRMED
- 40% x take-home x 30 = 96m. Confirmed with MUA HR. The 240m briefing figure
  omitted the 40% and was wrong. Seeded as takehome_factor=0.4,
  takehome_multiplier=30. Pinned by test. Do not change without written
  confirmation from the customer.
## Next: Meridian-style dashboard rebuild
1. Consolidate globals.css @theme (kill duplicate blocks, circular vars, doubled --color-primary) FIRST
2. Coordinate recentLoans query with Willy (backend � borrower/next-due/status for the book table)
3. Then build Meridian layout: horizontal bars (not donut), delta chips, side-panel worklist

## NEXT SESSION (priority): Design-system consolidation pass
The recurring "looks amateur" + recurring token bugs (black button, serif font,
duplicate --color-primary) are all symptoms of an un-consolidated globals.css.
Do ONE focused pass, fresh, with the whole file in view:
1. Consolidate: kill duplicate @theme blocks + circular vars (--font-sans, leftover @theme inline)
2. Add an ELEVATION scale: 2-3 shadow levels so cards lift off the page (biggest "pro" win)
3. Define a SPACING rhythm + consistent radii, applied everywhere
4. Define THE table treatment (header/row/hover) as the one pattern all tables use
5. Add card shadows to dashboard + table cards
This fixes EVERY screen at once instead of reactive screen-by-screen tweaks.
Then: applications detail page (underwriting checklist + status timeline from LoanOrigin ref).
