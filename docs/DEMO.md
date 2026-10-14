# The live demo

**What it is.** `https://wola-pi.vercel.app` shows **Kampala Steelworks Ltd** and nothing else: that Vercel project
is pinned to one organisation (`WOLA_SINGLE_TENANT=testco`, for Production **and** Preview). Never put a real
client on this address. The other demo organisation, Nile Textiles Ltd, exists but cannot be reached here (only the
platform console sees it); to prove isolation live you would need a second address.

> Preview deployments (the ones Vercel builds for pull requests) are pinned to the same organisation and, unless you
> gave Preview its own database, use the same database as Production. Treat a preview as live data.

## One-time preparation (about 20 minutes)

**1. Strong passwords for the demo accounts.** They began with the shared development password.

```powershell
npm run demo:passwords
```

It prints a random password per account **once** (save them in your password manager) and copies SQL. Paste it in
Supabase -> SQL Editor -> New query -> Run, then delete the query. It also signs those accounts out everywhere.
Accounts: `admin@`, `ceo@`, `cfo@`, `hr@`, `head@`, `staff@` `testco.io`.

**2. Switch email OFF for the demo organisation.** Its people have made-up addresses (`cfo@testco.io`). With email
now sending for real, every demo approval would try to mail them, bounce, and damage the sending domain's reputation.
In the SQL Editor:

```sql
UPDATE tenants
SET settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{email}', '{"enabled": false}'::jsonb)
WHERE slug = 'testco';
```

Nothing is queued for that organisation afterwards. (To show a real email arriving during a demo, use a real
organisation you control or run the laptop demo and invite your own address.) Turn it back on with
`UPDATE tenants SET settings = settings - 'email' WHERE slug = 'testco';`.

**3. Resend settings for Production only.** In Vercel, when you add `RESEND_API_KEY` and `EMAIL_FROM`, tick
**Production** only, not Preview, so a preview never sends mail from the live key.

**4. Build a believable collection history.** The live book shows almost nothing collected, which a finance person
reads as a failing collection rate. The platform console can record a payroll history for an organisation flagged as a
trial. Flag the demo company as a trial **with its banner off**, so the banner does not appear in a sales demo:

```sql
UPDATE tenants
SET settings = settings || '{"trial": true, "trialBanner": false}'::jsonb
WHERE slug = 'testco';
```

Then sign in to the platform console -> Organisations -> Kampala Steelworks Ltd -> *Practice data* -> type `testco` ->
**Payroll history only**. It records, month by month, that payroll deducted what the schedule said, up to the month before
last, and leaves last month with one missed and one short deduction to resolve. It refuses to run twice (it would
double-count deductions). Each recorded deduction is a permanent ledger entry, so do this once, deliberately.

(Doing it by hand also works: Payroll -> go back to the first month with loans -> *Record all due deductions*, month by
month, never the current month.)

**5. Rehearse.** Sign in as each role once, on the phone as well as the laptop, the day before.

## A 15-minute flow

1. **Staff member** (phone): apply for a Salary Advance and see the limit they are eligible for before submitting.
2. **Department head -> HR -> CFO -> CEO**: each sees only their own menu and only what waits at their step;
   approve, and show the **applicant can never approve their own** loan.
3. **CFO**: disburse; open **Payroll**: expected against actual, the missed and the short deduction, resolve them.
4. **HR**: the register issues list, **Fill in details** (pay, probation, work email), **Invite many people**.
5. **Administrator**: loan products, approval routing, roles and access, two-step sign-in.
6. **Auditor / audit log**: every action above is recorded with who and when; nothing can be edited.
7. **Platform console** (as a Wola operator): organisations, activity, security, what operators did.

## Do not show

- `.env` files, the Vercel environment page or the Supabase dashboard (keys have leaked in screenshots before).
- The capital pool, audit pack, contract-aware lending, billing, AI features: not built.
- The CFO dashboard as a finished design: it still leads with metric cards.
- Anything with a real client's names.
