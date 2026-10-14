# Go-live checklist (owner steps)

Everything here needs your accounts (Vercel, GitHub, Supabase, Slack), so it is written
as steps you can follow in order. Each step ends with a check that proves it worked.
Do them in this order: the database first, then the settings, then the alarms.

Replace `<site>` below with the address you open Wola on (for example
`https://acme.wola.app`). The health check works on any host the app serves.

---

## 0. Before the NEXT deploy: migrations 0026 and 0027

- `0026_notifications.sql`: the bell reads a new `notifications` table on **every page**. If the
  new code goes live before it is applied, every signed-in page fails.
- `0027_platform_audit.sql`: the platform console records operator activity in a new table;
  without it the console's pages fail.

Apply both first (step 1 below, same two ways), and only then merge/deploy. Check with
`node scripts/migrate.mjs --dry-run` that it lists both as pending before you merge, and
`0 pending` after you apply them.

## 0b. Email does not get sent yet (found while building the platform console)

Invitations, password resets and approval alerts are written to a queue (`email_outbox`), but
**nothing sends them**: the sender is `scripts/process-email-outbox.mjs`, which has to be run
repeatedly by something, and no scheduler is set up. No email provider is configured either.
Until both exist, a person who clicks "Forgot password" receives nothing. The platform console's
"Platform checks" shows this (it warns when emails have waited more than 30 minutes).
What it takes: an email provider with SMTP (Resend, SES, Postmark...), a sender domain with
SPF/DKIM, and either (a) a scheduled job or (b) sending right after the action that queues the
email. Option (b) is recommended: no scheduler, and mail goes out in seconds.

## 1. Apply migrations 0023, 0024 and 0025 to production

They are additive (new tables and columns), so the version of the app that is live now
keeps working while they are applied, and the new version needs them. **Apply them
before the new code goes live.**

**Option A: automatic (recommended, once).** One-time setup:
GitHub -> `Synsify-org/wola` -> Settings -> Environments -> `production` -> add the secret
`PRODUCTION_DATABASE_ADMIN_URL` (the Supabase admin connection string, URI form, password
URL-encoded; use the NEW password). After that, merging to `main` applies pending
migrations by itself (Actions -> migrate-production). You can also run it by hand:
Actions -> migrate-production -> Run workflow.

**Option C: no connection needed (use this if connecting from your computer fails).**
`npm run migration:sql -- 0026 0027` copies the SQL for those migrations, plus the line that records
them as applied, to your clipboard. In the Supabase dashboard open SQL Editor -> New query, paste
(Ctrl+V), Run. It skips anything already recorded, applies everything or nothing, and ends by
listing the newest recorded migrations (yours should be at the top). Delete the query afterwards.

**Option B: by hand, from this repo.** PowerShell:

```powershell
$env:DATABASE_ADMIN_URL = "<the admin connection string>"
node scripts/migrate.mjs --dry-run      # read-only: lists what WOULD run
node scripts/migrate.mjs                # applies it
Remove-Item Env:DATABASE_ADMIN_URL
```

**Check:** the dry run first prints the target host (make sure it is production) and
lists `0023_money_loop.sql`, `0024_super_admin_mfa.sql`, `0025_employee_contact.sql`
(plus anything older you missed). The real run ends with `migrations complete`; a second
dry run says `0 pending`.

---

## 2. Set `ERROR_WEBHOOK_URL` (get told when something breaks)

1. Get a webhook URL. Without Slack, **Discord** is the easiest free option: create a
   server (the "+" button), make a channel such as `#wola-alerts`, then channel
   settings (gear) -> Integrations -> Webhooks -> New Webhook -> Copy Webhook URL
   (it starts `https://discord.com/api/webhooks/...`). Install the Discord phone app so
   alerts reach you. (Slack, Mattermost and anything else that accepts a JSON POST also
   work.) Treat the URL like a password.
2. In Vercel: the Wola project -> Settings -> Environment Variables -> Add
   `ERROR_WEBHOOK_URL`, value = that URL, environment = **Production**, tick
   **Sensitive**. Then Deployments -> Redeploy the latest production deployment (a
   variable only applies to new deployments).

**Check (proves the URL works):**

```powershell
$env:ERROR_WEBHOOK_URL = "<the url>"
npm run verify:production -- <site> --webhook
Remove-Item Env:ERROR_WEBHOOK_URL
```

You should see `PASS  webhook: accepted the test message` and a "Wola TEST alert" message
in the Discord (or Slack) channel. (Real alerts look like `Wola error on GET /loans (ref 3234606282): ...`
and the ref is the number a person sees on the error page.)

---

## 3. Add an uptime monitor on `/api/health`

Use UptimeRobot or Better Stack (both have free tiers that check every few minutes; check their current limits).

1. Create a monitor of type **Keyword** (or "HTTP with response check").
2. URL: `<site>/api/health`. Keyword to find: `"ok":true`. (A plain 200 check is not
   enough: the keyword proves the database answered. The endpoint returns 503 when the
   database is down, which the monitor also catches.)
3. Alert contacts: your email, plus the Discord channel from step 2 (UptimeRobot has a Discord integration under
   My Settings -> Alert Contacts), plus their phone app for push alerts.
4. Name it "Wola production".

**Check:** `npm run verify:production -- <site>` prints all `PASS`. Then pause the
monitor's target for a minute or point a second test monitor at `<site>/api/nope` and
confirm that an alert arrives, so you know the alarm rings before you need it.

---

## 4. Set `MFA_ENCRYPTION_KEY` (turns on two-step sign-in)

**Read first.** This key encrypts everyone's authenticator secrets. If it is lost,
nobody enrolled can complete two-step sign-in (even with recovery codes) and they would
have to be re-enrolled by hand in the database. **Store a copy in your password manager
before you use it.** Never change it once people are enrolled.

Also: **the moment this key is set, the platform admin console requires two-step
sign-in.** Have your phone with an authenticator app ready before step 4.3.

1. Generate it and save it straight into your password manager:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

2. Vercel -> the Wola project -> Settings -> Environment Variables -> add
   `MFA_ENCRYPTION_KEY` = that value, **Production**, tick **Sensitive**. Redeploy.
3. Sign in to the platform console (`<site>/admin/login`). You are sent to
   "Platform security": scan/enter the key in an authenticator app, type the code,
   **save the recovery codes**.
4. In an organisation: Settings -> Security -> set up your own two-step sign-in, then
   choose which roles must use it (recommended: CFO, CEO/MD/COO, org admin). Those people
   are asked to enrol the next time they sign in.

**Check:** sign out and in again on `/admin/login`: after the password it asks for a
code. In Settings -> Security the "Who must use it" boxes are no longer greyed out.

---

## 5. Confirm backups

1. Supabase dashboard -> your project -> Database -> Backups. Note which plan you are
   on. **[verify on their pricing page: plans change]** At the time of writing the free
   plan has no backups, Pro keeps daily backups for 7 days, and point-in-time recovery is
   a paid add-on.
2. If there is no backup, upgrade before the pilot. A pilot with real loan balances on
   a database that cannot be restored is the one risk you cannot undo.
3. Write down your numbers (you will be asked): newest backup may be up to **24 hours**
   old on daily backups (that is your RPO) unless you buy point-in-time recovery; and how long
   a restore takes you (RTO), which you find by doing the drill once.
4. Do the drill once now: follow "Backups and the restore drill" in
   [OPERATIONS.md](OPERATIONS.md) step 2 (restore into a NEW Supabase project, compare,
   delete it). Record the date and result in `TASKS.md`.

**Check:** you can name the plan, the newest backup's timestamp, and the date you
last restored one.

---

## 6. Decide the policies

Open [business/POLICY_DECISIONS.md](business/POLICY_DECISIONS.md) and fill in the
**Decision** line of each. Defaults I'd start from, so you only have to disagree:

| # | Question | Suggested answer for the pilot |
| - | -------- | ------------------------------ |
| 3 | A person leaves mid-loan | "Ask for the balance": already Wola's default. The employer asks, finance records money received, nothing is written off. Confirm with the customer's lawyer that deducting from final pay is allowed. |
| 4 | Where the money comes from | **Your customer decides, not you.** Get four numbers from them in writing: who funds it, who carries a default, the maximum total exposure, the per-person limit. Wola can enforce the limits in product rules once you have them. |
| 5 | KYC | "None: the payroll record is the check" for a staff-only pilot. Revisit if they lend to non-employees or their regulator requires it. |

When #4 is decided, tell me the numbers and I will set them as product limits and make
the CFO dashboard show exposure against the cap.

---

## Final check

```powershell
npm run verify:production -- <site>
```

and look at: GitHub Actions (migrate-production green), Vercel (latest deployment
Ready), Slack (test alert arrived), the uptime monitor (Up), Supabase (a backup exists).
