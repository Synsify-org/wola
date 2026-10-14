# Onboarding a client

How to take a new organisation from "signed" to "staff are borrowing", step by step, with the
exact commands. The worked example is **MUA Insurance Uganda**. Nothing here needs a database
password on your machine: every production change is SQL you paste into the Supabase SQL Editor,
or something the client does inside Wola.

Rule for the whole process: **never paste a password, API key or connection string into chat,
email or a ticket.** The tools below are built so you never need to.

## The shape of it

| # | Step | Who | Tool |
| - | ---- | --- | ---- |
| 0 | Agree the web address and collect the client's data | you + client | this page |
| 1 | Create the organisation and invite its administrator | you | `npm run tenant:sql` |
| 2 | Administrator signs in, sets up two-step sign-in and interest rates | client admin | Wola |
| 3 | Clean the staff list; the client answers the questions | you + client HR | `npm run staff:prepare` |
| 4 | Load the staff | client HR | Settings -> Employees -> Import |
| 5 | Give everyone a login | client admin | Settings -> Roles & access -> Invite many people |
| 6 | Bring across running loans | you + client finance | not built yet (see step 6) |
| 7 | One payroll cycle in parallel, then cut over | everyone | [SPREADSHEET_MIGRATION.md](business/SPREADSHEET_MIGRATION.md), [PILOT.md](business/PILOT.md) |

## The trial first: MUA's real people, practice money

Before a client goes live, give them a **trial organisation**: their real names, departments and emails, with practice
pay, loans and repayments, so they experience Wola the way they would after buying it. It is a separate organisation
(slug `mua-trial`), flagged as a trial: every page carries a banner saying the money is practice data. The real
organisation (`mua`) is created clean later, so no made-up loan ever sits in the real ledger (the ledger and audit trail
are append-only: practice entries cannot be removed, so a trial is thrown away whole, never converted).

1. **Address.** A second Vercel project pinned to the trial (`WOLA_SINGLE_TENANT=mua-trial`): see step 0 below.
2. **Prepare the people.** From the client's HR export and the line-manager list:
   ```powershell
   npm run staff:prepare -- "<hr export.csv>" --managers "<line managers.xlsx>" --org "MUA Insurance Uganda (Trial)" --practice-pay --out onboarding-data\mua-trial
   ```
   `--practice-pay` fills in **invented** pay and probation status (scaled by seniority; recent joiners and fixed-term staff
   start on probation, so they cannot borrow). The review says so in capitals; never load that file into a real organisation.
3. **Create the organisation**, flagged as a trial, with yourself as its administrator (a trial holds no real money, so a
   Synsify administrator is fine here, unlike the real organisation):
   ```powershell
   npm run tenant:sql -- --trial --slug mua-trial --name "MUA Insurance Uganda (Trial)" --admin-email <your email> --admin-name "<your name>" --origin https://<the trial address>
   ```
   Paste into the Supabase SQL Editor, as in step 1 below.
4. **Load the people** the way a real client would: sign in from the invitation, then Settings -> Employees -> Import employees
   with `employees.csv`. The file carries each person's work email, status (a suspended person loads as suspended) and a
   note on every record that needs a decision: HR sees them on the dashboard and fixes them there.
5. **Load the practice book** (platform operator only): platform console -> Organisations -> the trial -> *Practice data* ->
   type its short name -> **Load practice loans and history**. It creates seven running loans with six months of payroll history
   (last month left with one missed and one short deduction), a loan waiting for disbursement, applications at every approval
   stage and a rejection. Approvals are attributed to "Practice ..." accounts that cannot sign in and are never emailed.
   It refuses anything that is not a trial, and anything that already has loans.
6. **Invite people when you choose to.** Nobody is invited automatically. Pick who sees it (decision-makers first) and use
   Settings -> Roles & access -> Invite many people from a list. Work emails are already on file.

## 0. Before you start

**The address.** Wola decides which organisation you are looking at in one of two ways. Pick one per deployment:

- **Pinned (one organisation per Vercel project).** `WOLA_SINGLE_TENANT=<short name>` makes every request
  resolve to that one organisation, whatever the address. This is how the live demo works today:
  `wola-pi.vercel.app` shows Kampala Steelworks Ltd and nothing else. It needs no domain setup, and the
  organisations stay separated by the database either way. The cost: **only that organisation is reachable
  on that address** (the other organisations exist, but only the platform console can see them).
- **Subdomains (many organisations, one project).** Each organisation lives at `mua.<your domain>`. Needs a
  domain you control with a **wildcard** pointing at the project (`*.vercel.app` has no wildcard subdomains),
  and `WOLA_SINGLE_TENANT` must be **unset**: while it is set, every address shows that one organisation.

**Recommended path for MUA now: a second, pinned deployment.** Keep `wola-pi.vercel.app` as the demo and give
MUA its own address, so nothing real ever sits on the demo's address:

1. Vercel -> Add New -> Project -> import the same GitHub repository. Copy every setting from the existing
   project (Root Directory, framework, Node version, **Functions region = Dublin**).
2. Copy **all** environment variables from the existing project, then change/add: `WOLA_SINGLE_TENANT` = `mua`,
   `SITE_URL` = the new project's address. Keep `DATABASE_URL`, `MFA_ENCRYPTION_KEY`, `RESEND_API_KEY` and
   `EMAIL_FROM` **identical** to the existing project: both projects use the same database, and platform
   operators' two-step secrets are encrypted with that one key.
3. Deploy, then check `https://<the new address>/api/health` answers `{"ok":true}`.
4. Use that address as `--origin` in step 1 below. Give MUA the address only after the organisation exists.

**Later, when you have several client organisations:** switch to subdomains.

1. Choose the base domain, for example `wola.synsify.africa`, so MUA becomes `mua.wola.synsify.africa`.
2. Vercel -> Project -> Settings -> Domains -> add `*.wola.synsify.africa` (and the bare `wola.synsify.africa`).
   Vercel requires its own name servers for wildcard certificates: either move that domain's DNS to Vercel,
   or in Namecheap add `NS` records for the `wola` subdomain pointing at the name servers Vercel shows.
   Follow what Vercel's Domains page tells you; it checks each record.
3. Set `WOLA_BASE_DOMAIN` = `wola.synsify.africa`, **remove `WOLA_SINGLE_TENANT`**, redeploy. The demo
   then moves to its own subdomain too, so rename its short name first if you want a tidy address.

**From the client** (send this list on day one):

1. The **name** to show, and who will be the **administrator** (a named person with a work email;
   not you: Wola staff must not hold a client's admin account).
2. The **staff list** (name, job title, department, line manager, employee number).
3. Each person's **gross and net monthly pay** and whether they are **past probation**. Without these nobody can borrow.
4. Each person's **work email**.
5. **Running loans** to bring across (borrower, product, amount, rate, start date, term, repaid so far), if any.
6. Who sits **above the CEO** (the `group_ceo` approver, used when the CEO applies for a loan).
7. Policy answers still open in [business/POLICY_DECISIONS.md](business/POLICY_DECISIONS.md).

## 1. Create the organisation

```powershell
npm run tenant:sql -- --slug mua --name "MUA Insurance Uganda" `
  --admin-email <the administrator's work email> --admin-name "<their name>" `
  --origin https://<the address from step 0>
```

It copies SQL to your clipboard. Then, **in this order**:

1. Supabase dashboard -> SQL Editor -> New query -> Ctrl+V -> Run.
2. One result row appears: `products 3, approval_stages 23, invitations 1, emails_queued 1`.
   An error means **nothing** was created (the usual cause: the short name is taken). Run the command again.
3. Delete that query from the SQL Editor's list.

It creates the organisation, the three staff-loan products and approval chains agreed with MUA HR
(limits, longest terms, post-probation and final-warning rules, "no car and development loan
together", the CEO-applies routes), and an **invitation** for the administrator. It creates no
password and no staff. `--template blank` makes only the organisation and the invitation.

The administrator receives the email within a few minutes (needs email set up: [GO_LIVE.md](GO_LIVE.md) step 0b;
if it is not working yet, add `--show-link` to the command and send them the link yourself).

## 2. The administrator's first session

They open the link, choose a password, and sign in. Then they should:

1. **Settings -> Security**: set up two-step sign-in, and decide which roles must use it (finance and administrators, at least).
2. **Settings -> Loan products**: set the **interest rate** for the Development and Car loans. Wola does not
   invent one: the products start with no rate index, and the setup checklist on Settings stays amber until it is set.
3. **Settings -> Approval routing**: confirm each chain is what the client wants.

## 3. Clean the staff list

```powershell
npm run staff:prepare -- "C:\path\to\staff list.xlsx" --org "MUA Insurance Uganda"
```

Writes three files to `onboarding-data\mua\` (git ignores this folder: it holds real names, so never commit it):

- `review.md`: the plain-language list of problems and questions. **Send this to the client's HR.**
- `employees.csv`: the file for step 4. Pay, probation and work email are blank unless the client's list had them (step 4 fills them in inside Wola).
- `accounts.csv`: the suggested Wola role for each person (the file for step 5).

What it does for you: tidies employee numbers (`MUA 029` -> `MUA029`), matches each person's line manager
to a real person (by name or job title) and refuses to guess when it is ambiguous, gives anyone with no
employee number a **temporary** one (`TEMP-001`, ...), writes a **note** on any record that needs a decision
(a line manager that matches nobody, two managers, two departments), catches doubled numbers, loops in
reporting lines and likely typos, and suggests a role from each job title and who manages whom.

**For MUA, the HR export plus the line-manager list gave:** 55 people in 6 departments, with real work emails. One is
suspended (loaded as suspended); eight new joiners have no line manager on file; one person's manager is a job title
(matched to the person holding it); one has two managers; one uses a personal email address; the CEO has no department.
Each is written into the file as a note that the HR dashboard shows until it is settled. There is no `group_ceo` yet:
see [business/MUA_MEETING.md](business/MUA_MEETING.md).

Run it again whenever the client sends a corrected list; it is safe to repeat.

## 4. Load the staff, then fill in the gaps inside Wola

Settings -> **Employees** -> *Import employees* -> choose `employees.csv`. The import checks everything first and
changes nothing if any row is wrong. Importing again later **updates** people by employee number (it is also how a
payroll refresh works), but it never re-flags a note HR already settled and never erases an email someone typed in.

You will not have the client's pay data, and you should not need it. **HR (or an administrator) types it in**, inside Wola:

- **HR dashboard -> Register issues** lists what is missing: staff with no salary, a temporary employee number,
  a record that needs a decision, no work email. Each has a **Fix** link.
- Settings -> Employees -> **Fill in details** is one table for everyone: gross pay, net pay, past/on probation,
  work email, and (for `TEMP-` people) the real employee number. Empty boxes are highlighted; **Save** writes only the
  rows you changed, and every change is recorded with who made it and the old and new values.
- Records that "need a look" (for example the unclear line manager) are fixed with **Edit** on that person: set the
  department head, then tick *I have settled this* to clear the flag.

Nobody can borrow until their pay is entered and they are marked past probation (everyone starts as on probation, the safe default).

## 5. Give everyone a login

Work emails are typed into the same **Fill in details** table (HR or an administrator can do it), or supplied in `accounts.csv`.
Then Settings -> **Roles & access** -> *Invite many people from a list* -> choose `accounts.csv` (its `suggested_role` column
sets each person's role: agree it with the client first) -> **Check the list**. An email missing from the file is taken from the
person's record; anyone with none is skipped. It shows who will be invited and, for anyone who will not be, why
(no such employee, bad email, already has a login...). Nothing is sent until you press **Send invitations**, so you can send in
stages and upload the file again later: people already invited are not emailed twice.

Each person gets an email, chooses their own password, and lands in their own role.

## 6. Running loans (not built yet)

If staff already have loans, they must be brought across so Wola's totals match the client's spreadsheet to the shilling
(that is the pilot's first success test). There is no loans import yet: build it from the client's **real file** once they
send it, as [SPREADSHEET_MIGRATION.md](business/SPREADSHEET_MIGRATION.md) says. Ask for the file early.

## 7. Parallel run, then cut over

Follow [SPREADSHEET_MIGRATION.md](business/SPREADSHEET_MIGRATION.md) and fill in [PILOT.md](business/PILOT.md): one payroll cycle
in parallel, Wola's expected deductions against the spreadsheet's, every difference explained, then switch.

## Day-one checklist

- [ ] `https://<client>.<base domain>/api/health` answers `{"ok":true}`
- [ ] The administrator has signed in and set up two-step sign-in
- [ ] Interest rates are set on every interest-bearing product
- [ ] Staff loaded, no warnings on Settings -> Employees
- [ ] A test application from a staff account goes through every approval stage (use a real person who agrees to be the test)
- [ ] A **Forgot password** email arrives within a minute
- [ ] Platform console -> Platform checks shows no warnings (email delivery, operators' two-step sign-in)
- [ ] The SQL Editor query from step 1 is deleted; `onboarding-data\` is not in git

## Who can see what (tell the client before they ask)

Each person sees only their own loans; a line manager sees their team; HR, finance and executives see the whole
organisation. Wola staff do not see loan-level data of any client. See [business/POLICY_DECISIONS.md](business/POLICY_DECISIONS.md).
