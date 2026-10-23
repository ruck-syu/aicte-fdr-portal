# AICTE Security Deposit & FDR Management Portal

A central register of the security deposits (FDRs, joint FDRs, bank guarantees and demand drafts) that institutions furnish to AICTE. It covers:

- submission with mandatory documents;
- automatic discrepancy checks and officer verification;
- bank confirmation;
- maturity alerts and escalation;
- renewal chains;
- release / refund requests;
- compliance reports;
- a full audit trail.

**Stack:** Next.js 16 (App Router) on **Vercel** · Postgres, Auth and Storage on **Supabase**.

## Roles

| Role | Scope | Can |
|---|---|---|
| Institute Accounts Officer | Own institution | Register deposits and renewals, upload documents, respond to discrepancies, request release |
| Regional Officer | Own region | Issue demands, verify / return / reject deposits, record bank confirmation, decide releases, reports |
| AICTE Verifier | All regions | Same as Regional Officer, nationally |
| Release Clearance Officer | One clearance cell (Grievance / Vigilance / PGRC) | Sign off or block releases for their cell; read access across institutions |
| Administrator | Everything | Users, institutions (incl. CSV import), alert and document rules |

Access rules are enforced in Postgres with Row Level Security; the UI only mirrors them. Workflow transitions (submit, verify, release…) run through `SECURITY DEFINER` functions that check role and state. Every insert, update and delete is written to an append-only `audit_logs` table by triggers. Sign-ins, document views and report exports are logged there too.

A profile is created for every auth user. Role, institution and region come from `app_metadata` — the one place only the service role can write — and a trigger keeps them in sync when GoTrue writes `app_metadata` after the insert (users created from the Supabase dashboard, for example). Keys absent from `app_metadata` leave the profile untouched, so a portal edit is never clobbered by unrelated Supabase bookkeeping.

## How it works

- **Demand → deposit.** An officer issues a *deposit demand* (approval case and amount), picking the programme from the **APH rate card** (Table 1.4) where it is listed: the card fills the amount and shows its source and effective date. A different amount — APH exceptions such as government colleges — needs a recorded reason, which lands in the audit trail. The institution furnishes one or more instruments against it. A demand with nothing furnished within the submission window is overdue.
- **Discrepancy detection.**
  - On submission, `deposit_checks()` validates the deposit. It checks:
    - mandatory documents;
    - maturity before issue, an instrument that has already matured, or maturity before the approval period ends;
    - amount shortfall against the demand;
    - duplicate instrument numbers;
    - a malformed IFSC.
  - Blockers (missing documents) stop submission. Errors and warnings become flags the officer resolves or overrides.
- **Verification.** The officer verifies, returns (with comments) or rejects the deposit, and can record the bank's confirmation reference.
- **Renewals.** "Submit renewal" on a verified deposit creates a linked successor. When the successor is verified, the original becomes *Replaced* and the chain shows up as version history.
- **Alerts.** A daily Vercel Cron job (`/api/cron/alerts`) runs `run_alerts()`, which raises:
  - maturity reminders (60 / 30 / 7 days by default);
  - lapse notices;
  - escalations after the configured number of days;
  - overdue-demand notices.

  Alerts are always shown in-app. They are emailed through Resend if you configure it.
- **Service levels.** Officials see average and 90th-percentile submission→verification time (last 90 days), renewal compliance (renewed ÷ renewed + lapsed) and the median / p90 age of open discrepancy flags on the dashboard, and can export the same figures from the **KPIs & service levels** report. With no sample yet every measure renders as “—”, not zero.
- **Release.** The institution applies with the required documents (application letter and affidavit by default). A submitted request then needs three clearances — Grievance, Vigilance and PGRC. Each is signed (cleared / blocked, with a note) by an officer of that cell; a block stops approval and only an administrator can override it, with a recorded reason. Once every cell has cleared, a reviewer approves with the NOC reference, the deposit becomes *Released* and the reference is stored on the request. Institutions see the cell statuses but not the cells' internal notes.
- **Refund quote.** Every release request shows an indicative refund: principal, simple interest accrued from the issue date (the deposit's own rate, or the configured default), and an early-release penalty when the deposit has not been held for the minimum period. Approving freezes that quote on the request as the sanctioned amount, so the figure is auditable and never recomputed retroactively. The rate card lives under **Admin → Settings**.
- **Print / Save as PDF.** Reports and the deposit and release pages have a **Print / Save as PDF** button. The print stylesheet renders an A4 document: navigation, report filters and action controls are dropped, table headers repeat across pages, and a header line carries the record label and generation time. Printing is recorded in the audit trail as `report.export` with a `PDF · …` summary, so paper output is traceable like a CSV download.
- **Queue ageing.** Pending verification, release requests and open demands carry a "Waiting 3d" badge from their submission date (amber at two days, red at five), and the dashboard's verification queue shows the same counter — so the oldest item is visible without opening each record.
- **Documents.** The uploader takes several files at once and accepts a drag-and-drop onto the page: each file is validated (PDF/JPEG/PNG, up to 10 MB), listed with its type and progress, and uploaded as one audited version per file. A partial failure names the files that did not upload and leaves the successful ones in place.
- **Clearance progress.** The releases list shows how many of the three cells have cleared ("Clearances 2/3", flagged red when a cell has blocked), and a release officer can switch the queue to only the releases waiting on their own cell.
- **Search.** The sidebar search box queries deposits, release requests, demand notices and (for officials) institutions in one go, matching references, instrument numbers, approval cases and institution names, and links each hit to its record. Row-level security still applies, so a search never reveals a record outside your scope.
- **Audit trail.** `/audit` filters by record type, action, user or free text and by date range, and **Export CSV** downloads exactly the filtered rows (capped at 10,000) as a `report.export` audit entry.

## Deploy (Supabase + Vercel)

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Apply the schema, either:
   - in **SQL Editor**, by running each file in `supabase/migrations/` in filename order; or
   - with the Supabase CLI: `supabase link --project-ref <ref> && supabase db push`.

   This creates the tables, RLS policies, functions and the private `deposit-documents` storage bucket.
3. Under **Authentication → Sign In / Providers**, turn off **Allow new users to sign up**. Administrators create accounts from the portal.
4. Under **Authentication → URL Configuration**, set the Site URL to your Vercel domain.

### 2. Vercel

1. Import the repository into Vercel (framework preset: Next.js).
2. Add the environment variables from `.env.example`:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`. The Vercel ↔ Supabase integration can set these. The legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` names also work.
   - `CRON_SECRET`: any long random string. Vercel sends it to the cron route automatically.
   - Optional: `RESEND_API_KEY`, `ALERT_FROM_EMAIL` and `APP_URL` for email alerts.
3. Deploy. `vercel.json` schedules the alert job daily at 07:00 IST.

### 3. First administrator

Either load the demo data (below), or create a user in **Supabase → Authentication → Users** and then run:

```sql
update public.profiles set role = 'admin' where email = 'you@example.org';
```

## Demo data

```bash
cp .env.example .env.local   # fill in the Supabase URL and secret key
npm install
npm run seed
```

The migrations seed the APH rate card with the Engineering & Technology rows quoted in the proposal (Diploma ₹15L, UG ₹35L, PG ₹15L, APH 2024-27 Table 1.4). Add the remaining programmes from the current APH edition as dated rows in `aph_deposit_rates` — a new edition is a new row, never an edit, so issued demands keep their figures.

This creates the following, all with the password `Demo@12345`:

- six institutions across regions;
- demands, including overdue ones;
- deposits in every state, with placeholder PDFs: active, maturing, lapsed, draft, pending, returned with flags, release under review, released, and a renewal chain;
- these users:

| Email | Role |
|---|---|
| admin@demo.fdr | Administrator |
| verifier@demo.fdr | AICTE Verifier |
| ro.northern@demo.fdr | Regional Officer (Northern) |
| ro.western@demo.fdr | Regional Officer (Western) |
| grievance@demo.fdr | Release Clearance Officer — Grievance |
| vigilance@demo.fdr | Release Clearance Officer — Vigilance |
| pgrc@demo.fdr | Release Clearance Officer — PGRC |
| accounts@alpha.demo.fdr | Institute: Alpha Institute of Technology |
| accounts@beta.demo.fdr | Institute: Beta College of Engineering |
| accounts@gamma.demo.fdr | Institute: Gamma Polytechnic |

Change or delete these accounts before using a real deployment.

## Local development

```bash
npm install
cp .env.example .env.local   # point at a Supabase project
npm run dev                  # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run typecheck` | Generate route types and run `tsc` |
| `npm run lint` | ESLint |
| `npm run db:verify` | Apply the migration to an in-memory Postgres (PGlite) and exercise the workflow and RLS rules end to end. No Docker needed |
| `npm run build` | Production build |

## Integration hooks

- **Reports / CSV.** `GET /api/reports/<report>` returns any report as CSV. Reports: `expiring-next-quarter`, `missing-deposits`, `lapsed`, `flagged`, `pending-releases` and `deposits` (the last accepts the Deposits list filters as query parameters). It needs a signed-in official and is audited.
- **Bank confirmation.** `set_bank_check(deposit, status, ref)` records a manual response. Reviewers can also press **Verify with bank** on a deposit under review: `src/lib/bank/` picks a provider from `BANK_VERIFIER` — `mock` by default (offline, deterministic: numbers ending in 0/5 mismatch, containing `ERR` are unavailable), or `http` which POSTs to `BANK_VERIFIER_URL`. `record_bank_verification()` applies the verdict, stores the raw request and response in the audited `bank_verifications` table, raises at most one open `BANK_MISMATCH` flag and resolves it on a later confirmation. If the provider is down, the manual form stays available as the fallback.
- **AICTE approval systems.** Institutions upsert on `aicte_id` (CSV import, or `institutions` via the API with the service key). Demands carry the `approval_case_id`, ready for a feed from the approval process.

## Project layout

```
supabase/migrations/    schema, RLS, workflow functions, alert job, storage bucket
scripts/verify-sql.mjs  database test-suite (PGlite)
scripts/seed.mjs        demo data
src/proxy.ts            session refresh + auth gate
src/app/(portal)/       dashboard, deposits, demands, releases, alerts, reports, audit, admin
src/app/api/            document viewer (signed URLs), CSV reports, cron
src/lib/                auth, Supabase clients, labels, report definitions
```
