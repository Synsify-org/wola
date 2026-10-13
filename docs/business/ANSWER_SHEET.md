# Wola: the one-page answer sheet

For the meeting where a finance director asks the hard questions. Every answer is
either **true of the product today** (checked against the code, with where to see
it) or marked **[DECIDE]** for you to fill in before sending. Do not send it with
a [DECIDE] left in.

| They ask | Answer |
| --- | --- |
| **What does it do?** | Staff apply for loans online; the request goes through the approval chain you define; the loan, schedule, disbursement, repayments and balance are tracked in one place; HR and finance each get the view they need. |
| **Whose data is it?** | The organisation's. Wola is the processor; you are the controller. [DECIDE: confirm wording once the lawyer has reviewed the DPA.] |
| **Can we get our data out?** | Yes, at any time: the loan register, applications and approval audit trail export to CSV from Reports; employee data is importable and re-exportable from the Employee directory. [DECIDE: add a full-database export on request, within N days.] |
| **What if we leave?** | [DECIDE] Suggested: full export within 14 days of a written request, then deletion within 30 days, confirmed in writing; no exit fee. |
| **Who can see our data?** | Only your organisation's people, by role. Each organisation is isolated at the database level (row-level security); a software fault cannot show one company another's rows, and that is tested on every change. Wola staff have no routine access. [DECIDE: only keep this sentence if it is true of how you actually operate.] |
| **How do you protect accounts?** | Salted password hashes, sign-in rate limiting, expiring sessions, an audit log of every change, and two-step sign-in (authenticator app) that your administrator can *require* for finance and admin roles once it is switched on for the server (see `docs/OPERATIONS.md`). |
| **What if a deduction is wrong?** | Every figure traces to a ledger entry (who, when, what) and a schedule version; mistakes are corrected by a recorded adjustment, never by editing history. [DECIDE: liability. Suggested: Wola is responsible for calculation faults in the software and fixes them at no cost; payroll execution and the loan decision remain the employer's.] |
| **Is it backed up?** | Database backups are the hosting provider's [DECIDE/verify: confirm your Supabase plan actually includes daily backups or point-in-time recovery; the free plan does not], and a restore drill is rehearsed (see `docs/OPERATIONS.md`). [DECIDE: state your RPO and RTO as numbers.] |
| **What if it goes down?** | Uptime is monitored with an alert. [DECIDE: support hours, response times, and any uptime commitment, only promise what you can staff.] |
| **Who supports us?** | [DECIDE: name, phone, email, hours (e.g. Mon-Fri 8:00-17:00 EAT), and what happens out of hours.] |
| **What does it cost?** | [DECIDE: per employee per month, or per organisation per month; setup fee or none; what a pilot costs (suggested: free for one payroll cycle, then a written start date).] |
| **Do we need new hardware or payroll changes?** | No. It runs in a browser, including on basic phones. It does not connect to your payroll system today: finance exports expected deductions and records or imports what payroll took. [DECIDE: do not promise payroll integration unless a customer is paying for it.] |
| **Is the lender Wola?** | No: the employer (or its fund) lends; Wola is software. **[verify with a Ugandan lawyer]** whether employer-to-staff lending with interest triggers money-lending licensing, and who the lender of record should be. |

Facts you can show live: the rate on the apply form before applying; a rejected
application with its reason; the audit log; the loan book reconciling to the
shilling; the role matrix at Settings -> Roles & access.
