# Gap Analysis & Recommended Changes

**Source spec:** `Executive Summary.pdf` (AICTE Security Deposit/FDR Management Portal — SIH proposal)
**Codebase:** `aicte-fdr-portal` @ `main` (no commits yet)
**Analysis date:** 2026-10-23
**Current alignment:** ~82% overall — ~90% mandatory/compliance, ~90% common, ~20% innovative.

**Legend:** ✅ = shipped and verified (`npm run db:verify` covers it where it is testable). An item with no tick is still open.

This document lists only changes **worth implementing**, ordered by demo/compliance value per unit of effort. Each item is self-contained: why it matters, what exists today, what to build, how to prove it works.

---

## 1. Priority summary

| ID | Change | Priority | Effort | Spec section |
|---|---|---|---|---|
| G1 | ✅ Release clearance workflow (Grievance / Vigilance / PGRC) + NOC record | **P0** | 2–3 d | §2.1 workflow, §3C |
| G2 | ✅ Automated refund / penalty calculator | **P0** | 1–1.5 d | §2.3, §8 penalty |
| G3 | ✅ Pluggable bank verification adapter (mock-first) | **P0** | 1–2 d | §2.3 bank API, §3A |
| G4 | ✅ KPI instrumentation (turnaround, renewal compliance, flag ageing) | **P0** | 0.5–1 d | §5 KPIs |
| G5 | Browser E2E tests (SQL regression + `npm run check` shipped) | **P0** | 0.5–1 d | §5 testing |
| G6 | ✅ APH rate card for demands (Table 1.4) | **P1** | 0.5–1 d | §1 background |
| G7 | ✅ PDF export + print stylesheet | **P1** | 1 d | §2.2 reporting |
| G8 | ✅ Region heatmap (region × status) | **P1** | 0.5–1 d | §2.2 analytics |
| G9 | ✅ Read-only Auditor role | **P1** | 0.5 d | §3 roles |
| G10 | ✅ Amount-threshold second approval for releases | **P1** | 1 d | §2.3 dynamic approvals |
| G11 | MFA (TOTP) for officials | **P1** | 1 d | §4 security |
| G12 | ✅ Bulk / drag-drop document upload | **P2** | 0.5–1 d | §2.2 documents |
| G13 | ✅ Retention & archival policy (in-place, no cold export) | **P2** | 1–2 d | §4 retention |
| G14 | ✅ SMS channel for alerts | **P2** | 1 d | §2.2 alerts |

**Quick wins (< 0.5 d each):** all four shipped — see §5.

**Explicitly deferred:** OCR/ML, blockchain, chatbot, native mobile app, Aadhaar eSign, payment rails. Rationale in §6.

---

## 2. P0 — implement before the next demo (G5 is the only open item)

### ✅ G1. Release clearance workflow (Grievance / Vigilance / PGRC) — shipped

**Why.** The spec makes this mandatory: release must enforce "clearances by PGRC/Vigilance, issuance of NOC" (§2.1, §3C). Today one reviewer can approve a release end to end — the single largest *mandatory* gap.

**Current.** `release_requests` has `status`, `decided_by`, `decided_at`, `decision_note` only (`supabase/migrations/20261023000000_init.sql:162-181`). `decide_release()` is a one-step approve/reject (`init.sql:1051-1092`). The release detail page renders one decision form (`src/app/(portal)/releases/[id]/page.tsx:223-235`).

**Change.**

1. New migration `supabase/migrations/<ts>_release_clearances.sql`:
   ```sql
   create type public.clearance_cell as enum ('grievance', 'vigilance', 'pgrc');
   create type public.clearance_status as enum ('pending', 'cleared', 'blocked');

   create table public.release_clearances (
     id                 uuid primary key default gen_random_uuid(),
     release_request_id uuid not null references public.release_requests (id) on delete cascade,
     cell               public.clearance_cell not null,
     status             public.clearance_status not null default 'pending',
     note               text,
     decided_by         uuid references public.profiles (id) on delete set null,
     decided_at         timestamptz,
     created_at         timestamptz not null default now(),
     unique (release_request_id, cell)
   );
   ```
2. Add role `release_officer` to `public.app_role` (`init.sql:19`) and a `profiles.clearance_cell` column, constrained to `clearance_cell` when role = `release_officer`. Update `profile_scope` (`init.sql:82-87`).
3. Seed three clearance rows as `pending` in `create_release_request()` and on `submit_release_request()`.
4. `record_clearance(p_id, p_cell, p_status, p_note)` — only a `release_officer`/admin whose `clearance_cell = p_cell` may sign; writes audit.
5. `decide_release()`: refuse `approve` unless all three cells are `cleared`; refuse if any is `blocked` (admin override needs a note). Store `noc_reference` on the release row.
6. UI: 3-row clearance checklist on the release page with per-cell sign-off; decision buttons disabled until cleared.
7. `src/lib/labels.ts` + `src/lib/types.ts` + `ROLE_LABELS`, admin user-scope fields (`admin/users/scope-fields.tsx`), seed users for each cell.

**Acceptance.**
- `decide_release()` throws when any cell is pending/blocked.
- Each cell can only be signed by the matching officer.
- Auditor/admin can read the checklist; institution sees status only.
- All sign-offs appear in `/audit` with actor + note.
- `npm run db:verify` covers the happy path and each blocking path.

**Effort.** 2–3 days. **Risk.** New enum values require care with existing RLS helpers (`is_official`, `can_access_institution`, `is_reviewer`).

**Shipped 2026-10-23.** `20261023160000_release_officer_role.sql` adds `release_officer` (on its own, because a new enum value cannot be used in the transaction that creates it) and `20261023160001_release_clearances.sql` adds the `clearance_cell` / `clearance_status` types, `profiles.clearance_cell` (validated by `profile_scope`), the `release_clearances` table with RLS, `record_clearance()` (cell-scoped, block requires a note), the three-row checklist seeded on create/submit and backfilled, `decide_release()` gated on all three cells with an administrator override (note required) and a mandatory NOC reference, and `release_requests.noc_reference`. Institutions read statuses through `release_clearance_summary()`; cell notes stay with officials. The release page renders the checklist with per-cell sign-off and only offers **Approve** once every cell has cleared, the admin user form assigns the cell, the sidebar badges pending clearances, and `db:verify` covers each blocking path (pending, block, non-admin, admin without a note, missing NOC), the override success path, status-only institution view, direct-write denial and the audit trail.

---

### ✅ G2. Automated refund / penalty calculator — shipped

**Why.** The spec lists an "Automated Refund Calculator" and explicitly calls out 10% penalty scenarios (§2.3, §8). This is cheap, deterministic rules work with high demo value.

**Current.** Officer approves manually; no interest, penalty or eligibility computation anywhere. `interest_rate` is stored (`init.sql:140`) but never used.

**Change.**

1. `app_settings` additions: `min_holding_years int default 10`, `early_release_penalty_pct numeric(5,2) default 10`, `default_interest_rate numeric(5,2) default 6.5`.
2. Immutable SQL function `release_quote(p_deposit uuid) returns jsonb` returning:
   - `principal`, `holding_days`, `holding_years`;
   - `accrued_interest` (simple interest from `issue_date` to `current_date`, at `interest_rate` or default);
   - `penalty_pct`, `penalty_amount` (early release before `min_holding_years`, or shortfall);
   - `net_payable`, `eligible boolean`, `reasons text[]` (course closure, programme ended, excess deposit, etc.).
3. Persist the accepted quote on approval: `release_requests.quote jsonb`, `sanctioned_amount numeric`, `sanctioned_by`, `sanctioned_at` — so the number is auditable and never recomputed retroactively.
4. UI: "Estimate refund" panel on `/releases/[id]` with a line-item breakdown and a clear "indicative — final sanction by AICTE" caveat.
5. Report: add "Sanctioned refunds" to `src/lib/reports.ts`.

**Acceptance.**
- Quote is deterministic for a fixed `current_date` (test with PGlite).
- Approving stores the quote and sanctioned amount in the audit trail.
- Penalty appears when holding < 10 years; zero when eligible.
- Unit cases: before/after maturity, early encashment, amount shortfall, zero interest rate.

**Effort.** 1–1.5 days. **Note.** Confirm the real APH penalty wording before shipping the copy; keep the percentage configurable rather than hard-coded.

**Shipped 2026-10-23.** `20261023130000_release_quote.sql` adds `release_quote(deposit, as_of)` (principal, holding days/years, interest at the deposit rate or the configured default, early-release penalty, shortfall, reasons, net payable, eligible), `app_settings.min_holding_years / early_release_penalty_pct / default_interest_rate`, and `release_requests.quote / sanctioned_amount / sanctioned_by / sanctioned_at`. `decide_release()` freezes the quote on approval, the release page shows an estimate panel (and the frozen sanction once approved), the admin settings page edits the rate card, the **Sanctioned refunds** report exports the stored figures, and `db:verify` covers interest maths, early-release, zero-rate, shortfall, scope and the stored sanction.

---

### ✅ G3. Pluggable bank verification adapter (mock-first) — shipped

**Why.** "Bank API Verification" is the spec's headline innovation (§2.3, §3A). Today it is a manual enum + reference (`set_bank_check`, `init.sql:952-969`). A mock adapter makes the feature real in the product flow without waiting on bank partnerships.

**Current.** `bank_check` enum (`not_requested | requested | confirmed | mismatch`) and `bank_check_ref`. Mismatch raises a `BANK_MISMATCH` discrepancy. No integration, no stored response.

**Change.**

1. `src/lib/bank/verifier.ts` — provider interface:
   ```ts
   export type BankVerdict = { status: "confirmed" | "mismatch" | "unavailable"; reference?: string; observed?: Record<string, unknown>; reasons?: string[] };
   export interface BankVerifier { verify(input: { bankName: string; ifsc: string | null; instrumentNumber: string; amount: number; maturityDate: string }): Promise<BankVerdict>; }
   ```
2. `src/lib/bank/mock.ts` — deterministic: instrument numbers ending in `0`/`5` → mismatch with a reason; contains `ERR` → unavailable; otherwise confirmed with a generated reference. No network, no secrets.
3. `src/lib/bank/index.ts` — select provider via `BANK_VERIFIER` env (`mock` default; `http` stub documented for a real FI).
4. New table `bank_verifications` (deposit_id, provider, request jsonb, response jsonb, verdict, created_by, created_at) — the raw exchange is evidence for audit.
5. Server action `verifyWithBank(depositId)` in `src/app/(portal)/deposits/actions.ts`, visible to reviewers on the deposit page. Calls the adapter, writes the row, updates `deposits.bank_check`/`bank_check_ref`, raises `BANK_MISMATCH` on mismatch.
6. Keep the manual override (`set_bank_check`) for when the provider is unavailable — the spec's §8 "integration fallback" scenario.

**Acceptance.**
- Works offline, no credentials required.
- Mismatch creates exactly one open `BANK_MISMATCH` discrepancy (no duplicates on retry).
- `unavailable` leaves status `requested` and surfaces a friendly retry message.
- Switching to a real provider requires only a new adapter + env var.
- `db:verify` asserts the mismatch path.

**Effort.** 1–2 days for mock; +3–5 days for a real bank/FI integration (out of scope now).

**Shipped 2026-10-23.** `20261023150000_bank_verifications.sql` adds the audited `bank_verifications` evidence table and `record_bank_verification()`, which is reviewer-only, applies `confirmed` / `mismatch` / `unavailable` atomically, dedupes the open `BANK_MISMATCH` flag and resolves it on a later confirmation. `src/lib/bank/` provides the provider interface, a deterministic offline mock and an HTTP adapter selected by `BANK_VERIFIER` (default `mock`); the deposit page has a **Verify with bank** action beside the manual fallback. `db:verify` covers the mismatch dedupe, confirmation clearing the flag, unavailable leaving the status alone, RLS scoping, direct-insert denial and the audit trail.

---

### ✅ G4. KPI instrumentation — shipped

**Why.** The spec defines measurable success criteria (§5): submission→verification under 1 hour, 95% renewal compliance, 100% auditability. The portal currently surfaces counts but not these rates.

**Current.** `dashboard_stats()` (`init.sql:1128-1165`) returns holdings, maturities, flags, queues, region totals, maturity timeline. Nothing time-based.

**Change.**

Extend `dashboard_stats()` with:
```sql
'avg_verification_hours',      -- avg(verified_at - submitted_at) over last 90 days
'p90_verification_hours',
'renewal_compliance_pct',      -- renewed before maturity / (renewed + lapsed)
'open_flag_p50_days', 'open_flag_p90_days',
```
Add a "Service levels" card to `/dashboard` for officials, and a **"KPIs"** report in `src/lib/reports.ts` for export.

**Acceptance.**
- Numbers match hand-computed fixtures in `db:verify`.
- Institute dashboards do not show national metrics (RLS unchanged).
- Empty-state renders "—" rather than `NaN`.

**Effort.** 0.5–1 day.

**Shipped 2026-10-23.** `20261023140000_kpi_metrics.sql` extends `dashboard_stats()` with `avg_verification_hours`, `p90_verification_hours` (last 90 days), `renewal_compliance_pct` (renewed ÷ renewed + lapsed), and `open_flag_p50_days` / `open_flag_p90_days`; every value is null on an empty sample. The dashboard shows an officials-only **Service levels** card, and `src/lib/reports.ts` adds an exportable **KPIs & service levels** report. `db:verify` asserts 7.5 h average / 13.6 h p90 turnaround, 66.7% renewal compliance and 6 d / 9.2 d flag ageing on a dedicated scoped region, plus nulls for an institution with no data.

---

### G5. Regression + E2E tests for the new behaviour — partly shipped

**Why.** The existing PGlite suite is strong but only covers what was built before this list. Every P0 item above must be provable.

**Current.** `scripts/verify-sql.mjs` (~275 lines) covers lifecycle, RLS, alerts, release, audit, storage. No browser tests, no load tests.

**Change.**

1. Extend `verify-sql.mjs` with sections for G1 (clearance gating, wrong-cell rejection), G2 (quote math, stored sanction), G3 (mock mismatch/discrepancy dedupe), G4 (KPI maths).
2. Add Playwright: `@playwright/test`, `playwright.config.ts`, `e2e/smoke.spec.ts` — one flow: admin login → create user → institution registers deposit + uploads → officer verifies → release request → clearances → approve. Run against `npm run dev` with a dedicated seeded project.
3. Add `npm run test:e2e` and wire both suites into a single `npm run check` (`typecheck && lint && db:verify`).

**Acceptance.** `npm run check` is green locally; E2E fails loudly if a role can perform an action it shouldn't.

**Effort.** 1–2 days.

**Partly shipped 2026-10-25.** `npm run check` chains `typecheck && lint && db:verify`, so the SQL suite can no longer be skipped. `db:verify` gained a regression section for G9 (the auditor reads every register, clearance note, document and the national audit trail, and is refused by `review_deposit`, `set_bank_check`, `record_clearance`, `decide_release`, `admin_update_profile`, `log_event` and the direct-insert policies). Every earlier item's checks remain in the same run — 29 assertions total. **Still open:** the Playwright browser flow (login → create user → register → verify → release → clearances → approve), which needs a live seeded project and a browser in CI, neither of which this repo has.

---

## 3. P1 — worth doing next (open items)

### ✅ G6. APH rate card for demands — shipped (3 seeded rows)

**Why.** The spec anchors required amounts to APH Table 1.4 (₹15L Engineering Diploma, ₹35L Engineering UG, etc. — §1). Today `deposit_demands.required_amount` is free text, so nothing enforces the schedule.

**Change.** `aph_deposit_rates(program_key, level, amount, effective_from, effective_to)` seeded from the APH table; demand form pre-fills and shows the source row; overrides require a reason and are audited. Keep officer override — APH has exceptions (government colleges, leased land).

**Acceptance.** Creating a demand for a known programme pre-fills the APH amount; an override without a note is rejected. **Effort.** 0.5–1 day. **Caveat:** transcribe values from the current APH edition, not from this summary.

**Shipped 2026-10-23.** `20261023170000_aph_rate_card.sql` adds `aph_deposit_rates` (programme key, level, label, amount, effective window, source note; officials read it, only the service role maintains it), `deposit_demands.aph_rate_id` / `override_note`, and extends `demands_before_write()`: a demand priced from a card row must use that amount, or carry an override note, which the audit trigger records as `APH override: …`. The demand form picks a card row (pre-filling programme and amount), shows the rate source and effective date, and reveals a required reason when the amount is edited away from the card. Only the three Engineering & Technology rows quoted in the proposal are seeded — the rest still needs transcribing from the current APH edition. `db:verify` covers the scoped read, the accepted card amount, the rejected mismatch, the noted override and the audit entry.

### ✅ G7. PDF export + print stylesheet — shipped

**Why.** Spec asks for Excel/PDF export (§2.2). Only CSV exists (`src/app/api/reports/[report]/route.ts`).

**Change.** Start with an `@media print` stylesheet + "Print / Save as PDF" button on `/reports` and deposit/release detail pages (zero dependencies, A4 header/footer, totals). Only add a server-side PDF library if a watermarked, non-editable artifact is required. Log `report.export` with `format=pdf`.

**Acceptance.** A4 output shows title, filters, generated-at, page numbers; audit row recorded. **Effort.** 1 day.

**Shipped 2026-10-23.** `globals.css` adds a `@media print` block (`size: A4`, sidebar/pills/actions and all forms removed, repeating table headers, no shadows) plus a `.print-only` header. `PrintButton` + `logPrintExport()` add **Print / Save as PDF** to `/reports` and the deposit and release pages, writing the export to the audit trail as `report.export` (`PDF · …`) before opening the browser dialog. No PDF dependency: the browser's own engine produces the file, and the report's existing totals row prints with the table. Page numbers are the browser's header/footer setting, not a CSS feature.

### ✅ G8. Region heatmap — shipped (page-side aggregation)

**Why.** Spec asks for a heatmap of deposit status by region (§2.2). The dashboard shows a plain table plus a bar chart.

**Change.** RPC `region_status_matrix()` → region × status/validity counts, scoped by RLS; SVG grid component with numeric labels in cells (accessible, no chart dependency); legend + click-through to filtered `/deposits`.

**Acceptance.** Officials see all regions; regional officers see only their region; empty cells render neutral. **Effort.** 0.5–1 day.

**Shipped 2026-10-23, without the RPC.** `region-heatmap.tsx` renders an SVG grid (cell counts printed inside, so it reads without colour) from the existing scoped `deposit_overview` rows the dashboard already pages through; each cell links to `/deposits?region=…&status=…`. Because the aggregation happens in the page, counts are exact only up to the paging cap (~5k rows) — the `region_status_matrix()` RPC stays the fix for a full register.

### ✅ G9. Read-only Auditor role — shipped

**Why.** Spec defines "Auditors/External Reviewers (read-only)" (§3). Currently `/audit` is visible to every authenticated user (scoped), and there is no read-only persona.

**Change.** Add `auditor` to `app_role`; extend read-side policies (`can_access_institution`, `is_official` read usage) but **exclude** from `is_reviewer` and all write paths. Update `ROLE_LABELS`, admin scope fields, sidebar. Add negative tests: auditor cannot submit/verify/decide.

**Acceptance.** Auditor can read deposits, documents, reports, audit; every write RPC raises. **Effort.** 0.5 day.

**Shipped 2026-10-25.** `20261025000000_auditor_role.sql` adds `auditor` on its own (the enum value cannot be used in the transaction that creates it) and `20261025000001_auditor_scope.sql` adds the role's scope: `can_access_institution()` and `is_official()` include it so every scoped read works unchanged, `is_reviewer()` still excludes it so every workflow function refuses it, and the one direct-insert policy that keyed on `can_access_institution()` alone — comments — now carries a `is_read_only()` guard. The auditor also reads the national audit trail, including the session events that carry no institution and are otherwise administrator-only. `ROLE_LABELS`, the role picker, the sidebar, reports and the demo seed carry the new role; the deposit and release pages hide the verify/decide/upload/comment controls from it instead of showing buttons that the server would reject. `db:verify` proves the reads and each refusal.

### ✅ G10. Amount-threshold second approval for releases — shipped

**Why.** Spec's "Dynamic Role-Based Approvals": above a threshold, a higher authority must approve (§2.3).

**Change.** `app_settings.release_second_approval_threshold numeric default 1000000`; add `pending_second_approval` to `release_status`; first approval by a reviewer, second by `aicte_verifier`/admin; both recorded with notes. Show the required approver level on the release page.

**Acceptance.** Releases ≥ threshold cannot reach `approved` on one signature; below threshold unchanged; both signatures audited. **Effort.** 1 day.

**Shipped 2026-10-24.** `20261024000000_second_approval_status.sql` adds `pending_second_approval` on its own (a new enum value cannot be used in the transaction that creates it) and `20261024000001_second_approval.sql` adds the settings threshold (default ₹10,00,000, editable under **Admin → Settings**), `release_requests.first_approved_by / _at / _note`, and a two-stage `decide_release()`: at or above the threshold the first approval parks the request with its NOC and refund quote frozen, and the second must come from an `aicte_verifier` or administrator who is not the officer who signed first, with a recorded note. The release page shows who approved first, what is still required, and only offers **Give second approval** to an eligible, different officer; the list badges the status and its waiting time, the pending-releases report includes both stages, and `dashboard_stats()` counts parked releases in `release_pending` with a separate `release_second_approval`. `db:verify` asserts the below-threshold single-signature path, the first-signature park, rejection of a regional officer and of the same officer, the required note, the frozen quote surviving the second signature, the release itself, and both status-change audit rows.

### G11. MFA (TOTP) for officials — open

**Why.** Spec asks for "strong authentication (ideally MFA)" (§4). Not implemented.

**Change.** Supabase Auth TOTP enrolment page (`/account/security`), recovery codes, and an AAL2 gate in middleware for `regional_officer` / `aicte_verifier` / `admin` when `REQUIRE_MFA=true`. Document the project-level setting in the README.

**Acceptance.** Official without AAL2 is redirected to enrolment; institute users unaffected; disable/re-enrol works. **Effort.** 1 day. **Note.** Cannot be covered by PGlite; verify manually in a staging project.

### ✅ G12. Bulk / drag-drop document upload — shipped

**Why.** Spec asks for "bulk or drag-drop upload" (§2.2).

**Change.** Extend `src/components/document-uploader.tsx` to accept multiple files and a drop zone; upload sequentially with per-file status; keep versioning semantics (one version bump per doc type, earlier file retained); clean up storage objects on metadata failure (already done for single file).

**Acceptance.** 5 files in one gesture; one failed upload does not abort the rest; versions and audit rows correct. **Effort.** 0.5–1 day.

**Shipped 2026-10-25.** The uploader stages a batch instead of sending it file by file on arrival: the picker and the drop zone add rows, each row keeps its own document type (editable before upload, since one drop often mixes an FDR scan with an affidavit), and a single **Upload N files** sends them sequentially so version numbers stay ordered. A failure marks only that row, names the reason, and leaves the attachment on the file input for a retry — the rest of the batch is unaffected. Invalid files (wrong MIME, over 10 MB) are held as `rejected` rows that never reach storage, with remove buttons on every unfinished row.

---

## 4. P2 — both shipped

### ✅ G13. Retention & archival — shipped (in place, no cold export)

**Why.** The spec asks for a retention rule (§4). The risk is deleting evidence; the answer is a frozen record, not a purge.

**Change.** `app_settings.retention_years` (default 10, editable under **Admin → Settings**); `deposits.archived_at`; an `archival_due` view of settled deposits past maturity + the window; `archive_deposit()` / `unarchive_deposit()` (administrator only, audited); and a trigger guard that refuses any API write to an archived row.

**Shipped 2026-10-26.** `20261026000000_retention_archive.sql` adds the setting, `archived_at` (exposed through `deposit_overview`, which is rebuilt because a view binds its column list), and `archival_due` (released / replaced / rejected rows with `retain_until` and `days_overdue`). The deposit list hides archived rows, the detail page shows an **Archived record** banner with a restore control for administrators, and **Archival due** joins the reports with a CSV export and a link to each record. `db:verify` covers the window, the due list, the administrator-only gate, the frozen row, the restore path and the audit entry. **Deviation:** records are frozen in place; there is no copy to cold object storage, because that would create a second copy of evidence without adding a restore guarantee.

**Effort.** 1 day.

### ✅ G14. SMS channel — shipped (mock + MSG91 adapter)

**Why.** Email is optional and often unread; a maturity date is time-critical (§2.2 alerts).

**Change.** Opt-in per institution contact (`institutions.sms_opt_in`) over the existing `contact_phone`; a provider interface with a deterministic mock (default) and a MSG91 Flow adapter; a service-role-only `sms_queue()`; and a delivery log that dedupes, retries failures and records the provider response.

**Shipped 2026-10-26.** `20261026000001_sms_alerts.sql` adds `notification_deliveries` (notification, institution, channel, masked destination, provider, status, provider ref, error; unique per notice/channel/number), `institutions.sms_opt_in` and `sms_queue(p_since)`, which returns warning / critical notices for opted-in institutions that have no successful SMS yet. `src/lib/sms/` provides the interface, the mock and the MSG91 adapter selected by `SMS_PROVIDER`; `/api/cron/alerts` runs the SMS pass independently of Resend, so a missing email key no longer stops the texts, and a failed send stays queued for the next run (the upsert updates the previous attempt). **Admin → Institutions** carries the opt-in checkbox. `db:verify` covers opt-in gating, the critical-only queue, service-role-only execution, duplicate suppression, retry visibility and scoped reads. **Deviation:** the channel lives on the delivery row rather than on `notifications`, because one notice can go out in-app, by email and by text, and each attempt needs its own record.

**Effort.** 1 day.
- **Full-text search.** If ILIKE becomes slow: `pg_trgm` GIN indexes now (see QW4), `tsvector` later. Keep the current filter UX.
- **AICTE system integration / payment rails.** Requires external access and agreements; not a code-only task.

---

## 5. Quick wins (< 0.5 day each)

| ID | Change | Detail |
|---|---|---|
| QW1 | ✅ Harden profile provisioning at the DB level | `handle_new_user` cannot see `app_metadata` for admin-created users (GoTrue writes it just after the insert), so the app repaired it by hand in `seed.mjs` and `admin/actions.ts`. `supabase/migrations/20261023120000_profile_app_metadata_sync.sql` adds an `after update of raw_app_meta_data on auth.users` trigger that mirrors role/scope/name into `profiles`, applying only the keys present in `app_metadata` so Supabase's own keys never clobber a portal assignment. `db:verify` covers the late write, the partial update, and the audit row. Shipped 2026-10-23. |
| QW2 | ✅ Turnaround badge in queues | `AgeBadge` (from `daysSince()`) now shows "Waiting 3d" on the deposits, releases and demands queues and on the dashboard's verification queue, escalating amber at 2 days and red at 5. Shipped 2026-10-23. |
| QW3 | ✅ Trigram indexes | `20261026000002_search_trgm.sql` enables `pg_trgm` and indexes the columns the ILIKE paths actually scan: institution name / city / AICTE ID, deposit instrument / bank / reference, demand approval case / programme, and release reference. `db:verify` asserts the indexes exist. Shipped 2026-10-26. |
| QW4 | ✅ Demo-mode docs | `NEXT_PUBLIC_DEMO_MODE` documented in `.env.example`, alongside the SMS variables. Shipped 2026-10-26. |

### ✅ Shipped 2026-10-24 (no schema change)

Work that needed no migration, delivered on top of the existing views, RPCs and RLS:

- per-record institution profile (`/institutions/[id]`) with counts and latest rows from all three registers, linked from the deposit and release lists, search and **Admin → Institutions**;
- global search in the sidebar (`/search`) with a `/` keyboard shortcut;
- sortable deposit and release registers whose order flows into the CSV and the printed page;
- filtered total value and match count on the deposit register (lower bound past 1,000 rows);
- CSV exports for the release and demand registers, alongside the existing deposit export;
- print / Save as PDF on the deposit, release and demand lists, with page number and filters in the printed header;
- severity filters on the alert feed with an unread-critical count;
- the latest audit entries on the dashboard and date presets on `/audit`;
- portal error boundary, inside-shell and outside-shell 404 pages, and table-shaped loading states on every list route.

---

## 6. Explicitly deferred (and why)

| Spec item | Decision | Rationale |
|---|---|---|
| OCR/ML document validation (§2.3) | **Defer** | Needs a model/vendor and a labelled corpus; error rate would undermine trust. Manual officer review + discrepancy flags already cover the risk. |
| Blockchain audit trail (§2.3) | **Defer** | The audit log is already append-only at the DB privilege level (`revoke insert, update, delete, truncate`). If "tamper-evidence" optics are needed, anchor a daily SHA-256 Merkle root of `audit_logs` in a signed file/object — a fraction of the effort, no chain. |
| Chatbot (§2.3) | **Defer** | No clear user need in a 4-role workflow; support burden is better solved by the notification feed and status pages. |
| Native mobile app (§2.3) | **Defer** | The UI is already responsive (mobile drawer nav). A PWA manifest is the cheapest upgrade if mobile is judged. |
| Aadhaar eSign / DSC (§2.1, §2.3) | **Defer** | Requires an ASP/vendor agreement and legal review; cannot be meaningfully demoed without it. Design the affidavit upload to accept a signed PDF in the meantime. |
| Payment gateway / RTGS-UPI (§4) | **Defer** | Out of prototype scope; refunds are sanctioned, not executed, by this portal. |
| Microservices / Kafka / Kubernetes (§5) | **Reject** | The spec itself allows flexible stacks; serverless Next.js + Postgres is the correct trade for this scale. Document the deviation rather than re-architecting. |
| Keycloak / Aadhaar login (§5) | **Defer** | Supabase Auth covers email/password + TOTP; SSO is an integration task with AICTE IT. |

---

## 7. Suggested sequence (2 weeks, 1–2 devs)

| Day | Work |
|---|---|
| 1–3 | G1 clearances (schema → functions → UI → tests) |
| 4–5 | G2 refund calculator + stored sanction |
| 6–7 | G3 bank adapter (mock) + evidence table |
| 8 | G4 KPI metrics + dashboard card |
| 9 | G5 extend `db:verify`; set up Playwright |
| 10 | G5 E2E smoke; QW1–QW2 |
| 11 | G6 APH rate card |
| 12 | G7 PDF/print export |
| 13 | G8 heatmap + G9 auditor role |
| 14 | G10 threshold approval, G11 MFA, buffer |

Ship P0 before any judging round; treat P1 as the "completeness" story.

---

## 8. Definition of done (apply to every item)

- [ ] Migration added under `supabase/migrations/` and applied to the deployed project (or documented as pending).
- [ ] RLS/`SECURITY DEFINER` rules enforced in Postgres, not only in React.
- [ ] Audit entry written for every state change, with actor and note.
- [ ] `npm run typecheck && npm run lint && npm run db:verify` green.
- [ ] Negative test: wrong role / wrong scope is rejected.
- [ ] UI empty, loading and error states handled.
- [ ] README updated (roles, env vars, behaviour).

---

## 9. Traceability (spec → status → gap)

| Spec area | Status | Gap |
|---|---|---|
| ✅ §2.1 repository | Built | — |
| ✅ §2.1 workflow | Built (3-cell clearance + NOC + threshold approval) | — (G10 done) |
| §2.1 secure documents | Partial (e-sign) | G12; eSign deferred |
| ✅ §2.1 audit | Built (non-blockchain) | — (QW1 done) |
| ✅ §2.1 RBAC | Built (auditor is read-only, enforced in RLS) | — (G9 done) |
| ✅ §2.2 dashboard | Built | G4 |
| ✅ §2.2 document mgmt | Built (staged bulk upload, per-file type, retry) | — (G12 done) |
| ✅ §2.2 search/filter | Built (global search, institution profile, trigram-backed ILIKE) | — (QW3 done) |
| ✅ §2.2 alerts | Built (in-app, email, SMS opt-in; ageing visible) | — (G14 done; auto-escalation still G4) |
| ✅ §2.2 reporting | Built (CSV on every register + print/PDF) | — |
| ✅ §2.3 bank API | Built (mock adapter + evidence) | — (G3 done) |
| §2.3 OCR/ML | Missing | Deferred |
| §2.3 blockchain | Missing | Deferred (hash anchor option) |
| §2.3 smart escalation | Partial (ageing visible) | G4 (auto-escalation) |
| ✅ §2.3 dynamic approvals | Built (two signatures at or above the threshold) | — (G10 done) |
| §2.3 mobile/chatbot | Partial | Deferred |
| §2.3 eSign | Missing | Deferred |
| ✅ §2.3 refund calculator | Built (stored sanction) | — (G2 done) |
| ✅ §3 roles | Built (4 operational roles + clearance officer + read-only auditor) | — (G9 done) |
| §4 security | Partial (retention done; MFA open) | G11 |
| ✅ §5 KPIs | Built (90-day turnaround, renewal, flag ageing) | — (G4 done) |
| §5 testing | Partial (SQL regression + `npm run check`; no browser E2E) | G5 |
| §6 roadmap Bank/E-Pay | Missing | Deferred |
