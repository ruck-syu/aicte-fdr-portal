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
| Administrator | Everything | Users, institutions (incl. CSV import), alert and document rules |

Access rules are enforced in Postgres with Row Level Security; the UI only mirrors them. Workflow transitions (submit, verify, release…) run through `SECURITY DEFINER` functions that check role and state. Every insert, update and delete is written to an append-only `audit_logs` table by triggers. Sign-ins, document views and report exports are logged there too.

## How it works

- **Demand → deposit.** An officer issues a *deposit demand* (approval case and amount). The institution furnishes one or more instruments against it. A demand with nothing furnished within the submission window is overdue.
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
- **Release.** The institution applies with the required documents (application letter and affidavit by default). An officer approves (the deposit becomes *Released*) or rejects.

## Deploy (Supabase + Vercel)

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Apply the schema, either:
   - in **SQL Editor**, by running `supabase/migrations/20261023000000_init.sql`; or
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
- **Bank confirmation.** `set_bank_check(deposit, status, ref)` is the single entry point for recording a bank's response. A future bank API or e-mail parser can call it with a service account.
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
