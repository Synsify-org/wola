# Operating Wola

> Going live? Follow [GO_LIVE.md](GO_LIVE.md): migrations, alerts, uptime monitor, MFA key, backups, policies, in order.

Everything someone needs to run, demo, back up and recover Wola. Each section
ends with how you know it worked.

## One database per purpose

| Database | What for | Who touches it |
| --- | --- | --- |
| `wola` (local) | Development and the demo | `npm run dev`, `npm run demo:reset` |
| `wola_test` (local) | The automated test suite (it inserts and deletes whole fixture tenants) | `npm run test:isolation` only |
| Supabase project | Production | the app (role `wola_app`) and migrations (admin role, from GitHub Actions) |

The test suite refuses to run against a database whose name doesn't contain
"test" (outside CI), and `demo:reset` refuses any non-local host.

## Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | app (Vercel + local) | Runtime role `wola_app` (row-level-security bound). |
| `DATABASE_ADMIN_URL` | GitHub environment secret `PRODUCTION_DATABASE_ADMIN_URL`; local `.env` | Migrations only. **Never in Vercel.** |
| `WOLA_BASE_DOMAIN` | app | Apex domain tenants live under. |
| `SITE_URL` | app | Fallback public origin. |
| `MFA_ENCRYPTION_KEY` | app | Enables two-step sign-in. Back it up. |
| `ERROR_WEBHOOK_URL` | app (optional) | Receives one JSON message per server error (Slack-compatible). |

`.env` at the repo root is for scripts and tests; `apps/web/.env.local` is what
the Next app reads. They are separate files on purpose; keep the database URLs in
both pointing at the same local database.

## Cold start (laptop just booted)

```bash
docker compose up -d postgres        # or: docker start wola-postgres-1
npm run migrate                      # no-op if current
npm run demo:reset                   # known-good demo data
npm run dev --workspace @wola/web
```

Or have the machine do the whole drill and check every page for every role:

```bash
npm run rehearse            # database -> migrate -> reset -> server -> click-through
npm run rehearse -- --cold  # also stops the database first
```

**Worked when:** it prints `REHEARSAL PASSED` and the grid shows only `.` and `r`
(ok / redirect). If the database is down when you start the app you get a friendly
error page with a reference number, and the server log says
`Database unreachable: Postgres refused or timed out`, not a bare `AggregateError`.

## Demo reset

`npm run demo:reset` rebuilds the local database: tenant `testco` ("Test Co") with
all eight roles (`cfo@`, `ceo@`, `coo@`, `hr@`, `head@`, `staff@`, `admin@`,
`auditor@testco.io`, password `test1234`), three products with approval chains, a
CBR rate, applications in every state and a book of loans, plus a second tenant
for isolation checks. **Worked when:** it ends with `Known-good.`

## Backups and the restore drill

Production backups are Supabase's (daily; point-in-time recovery on paid plans).
A backup is only real once you have restored it, so:

1. **Locally, any time:** `npm run restore:check` dumps the dev database, restores
   it into a scratch database, and compares row counts, every RLS policy and flag,
   every `wola_app` grant, and tenant isolation behaviour. **Worked when:** it
   prints `RESTORE CHECK PASSED`.
2. **Production, once a quarter (and before any risky migration):**
   - Supabase dashboard -> Database -> Backups -> restore the latest backup into a
     **new** project (never over the live one).
   - Point a scratch `.env` at it and run the same comparisons from
     `scripts/restore-check.mjs` (policies, flags, grants, `count(*)` per table)
     against the live database vs the restored one.
   - Sign in to a copy of the app pointed at the restored database as one user per
     role and open the dashboard.
   - Write the date, the backup timestamp and the result in `TASKS.md`.
3. **Know your numbers:** write down how old the newest backup may be (RPO) and how
   long you'd take to restore (RTO) *before* a customer asks.

## Phone-width layout check

`npm run audit:mobile` (add `-- --width=360 --roles=cfo,employee --routes=/,/loans`
to narrow it) opens every page as each demo role in headless Chrome at phone width and
reports any page that scrolls sideways and any element sticking out past the screen or
cut off by its container. Add `-- --shots=<folder>` to save screenshots in readable
slices. It needs the demo database (`npm run demo:reset`) and Chrome or Edge.

## Monitoring

- **Uptime alert:** create a monitor (UptimeRobot, Better Stack, or similar) on
  `https://<your-domain>/api/health` (any host works, including the bare domain). It
  returns `200 {"ok":true}` only if the app is running AND the database answers, and
  `503` otherwise; it reveals nothing about any organisation. Check the response
  contains `"ok":true` (not just a 200). Alert by email and phone (SMS or push) with a
  1-minute interval.
- **Errors:** every server failure is logged as one JSON line (`level":"error"`,
  with `digest`, `kind`, `route`). The digest is the "Reference" number the person
  sees. In Vercel -> Logs, search for it. Set `ERROR_WEBHOOK_URL` to a Slack
  incoming webhook (or any endpoint that accepts JSON) to be told as it happens.
- **Migrations:** the `migrate-production` workflow runs on any merge that touches
  `packages/db/migrations`. Check Actions after such a merge.

## Releasing

Merge to `main` -> Vercel deploys. If the change has a migration it must be
backward compatible with the previous release (add, never drop or rename in the
same release). Roll back with Vercel -> Deployments -> promote the previous one.
