// Runs the Supabase migrations inside PGlite (in-process Postgres) with
// minimal stand-ins for Supabase's auth/storage schemas, then exercises the
// deposit lifecycle and RLS rules end to end. No Docker or Supabase needed.
//
//   npm run db:verify
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const db = new PGlite();
const migrationsDir = join(import.meta.dirname, "..", "supabase", "migrations");

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create schema storage;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_app_meta_data jsonb default '{}'::jsonb,
    raw_user_meta_data jsonb default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  create table storage.buckets (
    id text primary key, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text, name text, owner_id text
  );
  alter table storage.objects enable row level security;
  grant all on storage.objects to authenticated;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
  $$;
  grant execute on function storage.foldername(text) to authenticated;
`);

for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
  await db.exec(readFileSync(join(migrationsDir, file), "utf8"));
  console.log(`✓ applied ${file}`);
}

let step = 0;
const ok = (msg) => console.log(`✓ ${String(++step).padStart(2, "0")} ${msg}`);

async function as(userId, fn) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${userId ?? ""}', false);`);
  await db.exec(userId === "service" ? "set role service_role" : "set role authenticated");
  try {
    return await fn();
  } finally {
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
  }
}
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];
async function fails(promise, pattern) {
  try {
    await promise;
  } catch (e) {
    if (pattern) assert.match(e.message, pattern);
    return e.message;
  }
  throw new Error(`expected failure ${pattern ?? ""}`);
}

// --- fixtures (as superuser) -------------------------------------------------
const instA = (await one(`insert into institutions (aicte_id, name, state, region)
  values ('1-1000001', 'Alpha Institute of Technology', 'Uttar Pradesh', 'northern') returning id`)).id;
const instB = (await one(`insert into institutions (aicte_id, name, state, region)
  values ('1-2000002', 'Beta College of Engineering', 'Karnataka', 'south_western') returning id`)).id;

async function user(email, meta) {
  return (await one(`insert into auth.users (email, raw_app_meta_data) values ($1, $2) returning id`,
    [email, JSON.stringify(meta)])).id;
}
const admin = await user("admin@x", { role: "admin", full_name: "Admin" });
const verifier = await user("verifier@x", { role: "aicte_verifier" });
const roNorth = await user("ro.north@x", { role: "regional_officer", region: "northern" });
const roSouthWest = await user("ro.sw@x", { role: "regional_officer", region: "south_western" });
const userA = await user("a@x", { role: "institute_user", institution_id: instA });
const userB = await user("b@x", { role: "institute_user", institution_id: instB });
const sneaky = (await one(`insert into auth.users (email, raw_user_meta_data)
  values ('sneaky@x', '{"role":"admin"}') returning id`)).id;
assert.equal((await one(`select role from profiles where id = $1`, [sneaky])).role, null);
ok("profiles created from app_metadata; user_metadata role ignored");

// --- profile sync when app_metadata arrives after signup ----------------------
// GoTrue inserts the auth user and writes app_metadata in separate statements,
// so the insert trigger often runs before role/scope are known.
const late = (await one(`insert into auth.users (email) values ('late@x') returning id`)).id;
assert.equal((await one(`select role from profiles where id = $1`, [late])).role, null);
await db.query(`update auth.users set raw_app_meta_data = $2 where id = $1`,
  [late, JSON.stringify({ role: "institute_user", institution_id: instA, full_name: "Late User", designation: "Registrar" })]);
const lateProfile = await one(`select role, institution_id, region, full_name, designation
  from profiles where id = $1`, [late]);
assert.deepEqual(
  [lateProfile.role, lateProfile.institution_id, lateProfile.region, lateProfile.full_name, lateProfile.designation],
  ["institute_user", instA, null, "Late User", "Registrar"]);

// a later app_metadata write that omits role/name must not wipe them, and
// Supabase's own bookkeeping keys must never reach the profile
await db.query(`update auth.users set raw_app_meta_data = $2 where id = $1`,
  [late, JSON.stringify({ role: "institute_user", institution_id: instA, provider: "email" })]);
const kept = await one(`select role, institution_id, full_name from profiles where id = $1`, [late]);
assert.deepEqual([kept.role, kept.institution_id, kept.full_name], ["institute_user", instA, "Late User"]);
assert.ok((await q(`select 1 from audit_logs where entity_type = 'profiles' and entity_id = $1`, [late])).length >= 1);
ok("app_metadata written after signup syncs role + scope; unrelated keys leave the profile intact; audited");

// --- demand by regional officer ---------------------------------------------
const demand = await as(roNorth, () => one(`insert into deposit_demands
  (institution_id, approval_case_id, program, required_amount, approval_valid_until, intimation_date)
  values ($1, 'APH-2026-NEW-0042', 'B.Tech CSE', 500000, current_date + 1000, current_date - 20)
  returning id, due_date, current_date - 5 as expected_due`, [instA]));
assert.equal(String(demand.due_date), String(demand.expected_due));
await as(roSouthWest, () => fails(q(`insert into deposit_demands
  (institution_id, approval_case_id, required_amount) values ($1, 'X', 1)`, [instA]), /row-level security/));
ok("officer creates demand in own region (due = intimation + 15d); other region blocked");

await as("service", () => one(`select run_alerts() as n`));
assert.equal((await one(`select count(*)::int n from notifications where kind = 'demand_overdue'`)).n, 1);
ok("overdue demand produces an alert");

// --- institute creates and submits a deposit --------------------------------
const dep = await as(userA, () => one(`insert into deposits
  (institution_id, demand_id, instrument_type, instrument_number, bank_name, ifsc, amount,
   issue_date, maturity_date, status)
  values ($1, $2, 'fdr', 'FDR-778899', 'State Bank of India', 'sbin0001234', 450000,
          current_date - 2, current_date + 700, 'verified')
  returning id, status, required_amount, approval_case_id, ifsc`, [instA, demand.id]));
assert.equal(dep.status, "draft");
assert.equal(Number(dep.required_amount), 500000);
assert.equal(dep.approval_case_id, "APH-2026-NEW-0042");
assert.equal(dep.ifsc, "SBIN0001234");
ok("institute draft: status forced to draft, demand terms copied, IFSC normalised");

await as(userB, () => fails(q(`insert into deposits
  (institution_id, instrument_number, bank_name, amount, issue_date, maturity_date)
  values ($1, 'X', 'Y', 1, current_date, current_date + 1)`, [instA]), /row-level security/));
assert.equal((await as(userB, () => q(`select id from deposits`))).length, 0);
ok("other institution cannot read or create deposits for institution A");

await as(userA, () => fails(q(`select submit_deposit($1)`, [dep.id]), /Required document missing: fdr scan/));
ok("submission blocked when mandatory documents are missing");

for (const t of ["fdr_scan", "affidavit", "loa"]) {
  await as(userA, () => q(`insert into deposit_documents (deposit_id, doc_type, storage_path, file_name, institution_id)
    values ($1, $2, $3, 'f.pdf', $4)`, [dep.id, t, `${instA}/${dep.id}/${t}-1.pdf`, instB]));
}
await as(userA, () => q(`insert into deposit_documents (deposit_id, doc_type, storage_path, file_name, institution_id)
  values ($1, 'fdr_scan', $2, 'f2.pdf', $3)`, [dep.id, `${instA}/${dep.id}/fdr_scan-2.pdf`, instA]));
const docs = await q(`select doc_type, version, is_current, institution_id from deposit_documents
  where deposit_id = $1 and doc_type = 'fdr_scan' order by version`, [dep.id]);
assert.deepEqual(docs.map((d) => [d.version, d.is_current]), [[1, false], [2, true]]);
assert.equal(docs[0].institution_id, instA);
await as(userA, () => fails(q(`insert into deposit_documents (deposit_id, doc_type, storage_path, file_name, institution_id)
  values ($1, 'other', $2, 'f.pdf', $3)`, [dep.id, `${instB}/evil.pdf`, instA]), /institution folder/));
ok("documents versioned per type; institution forced; foreign storage path rejected");

const submitted = await as(userA, () => one(`select (submit_deposit($1)).status`, [dep.id]));
assert.equal(submitted.status, "submitted");
const flags = (await q(`select code from discrepancies where deposit_id = $1 order by code`, [dep.id])).map((r) => r.code);
assert.deepEqual(flags, ["AMOUNT_BELOW_REQUIRED", "MATURITY_BEFORE_APPROVAL_END"]);
ok(`submitted with automatic flags: ${flags.join(", ")}`);

await as(userA, () => fails(q(`update deposits set status = 'verified' where id = $1 returning id`, [dep.id]).then((r) => {
  if (r.length === 0) throw new Error("no rows (RLS)");
}), /no rows|Workflow fields/));
ok("institute cannot change status of a submitted deposit directly");

// --- review ------------------------------------------------------------------
await as(roSouthWest, () => fails(q(`select review_deposit($1, 'verify')`, [dep.id]), /not found/));
await as(roNorth, () => fails(q(`select review_deposit($1, 'verify')`, [dep.id]), /open discrepancy/));
await as(roNorth, () => q(`select review_deposit($1, 'return', 'Amount short by ₹50,000; extend tenure')`, [dep.id]));
assert.equal((await one(`select status from deposits where id = $1`, [dep.id])).status, "discrepancy");
ok("out-of-region officer blocked; flags block verification; officer returns deposit");

await as(userA, () => q(`update deposits set amount = 500000, maturity_date = current_date + 1200 where id = $1`, [dep.id]));
await as(userA, () => q(`select submit_deposit($1)`, [dep.id]));
const flags2 = await q(`select code, source, resolved_at is null as open from discrepancies
  where deposit_id = $1 and resolved_at is null order by code`, [dep.id]);
assert.deepEqual(flags2.map((f) => f.code), ["OFFICER_QUERY"]);
await as(roNorth, () => q(`select resolve_discrepancy(id, 'Corrected') from discrepancies where deposit_id = $1 and resolved_at is null`, [dep.id]));
await as(roNorth, () => q(`select set_bank_check($1, 'confirmed', 'SBI/CONF/123')`, [dep.id]));
await as(roNorth, () => q(`select review_deposit($1, 'verify', 'All good')`, [dep.id]));
const verified = await one(`select status, verified_by, bank_check from deposits where id = $1`, [dep.id]);
assert.equal(verified.status, "verified");
assert.equal(verified.verified_by, roNorth);
assert.equal((await one(`select status from deposit_demands where id = $1`, [demand.id])).status, "fulfilled");
ok("institute corrects + resubmits; officer resolves query, confirms with bank, verifies; demand fulfilled");

// --- maturity alerts ---------------------------------------------------------
const soon = await as(userA, () => one(`insert into deposits
  (institution_id, instrument_number, bank_name, amount, issue_date, maturity_date)
  values ($1, 'FDR-SOON', 'Canara Bank', 100000, current_date - 300, current_date + 25) returning id`, [instA]));
for (const t of ["fdr_scan", "affidavit", "loa"]) {
  await as(userA, () => q(`insert into deposit_documents (deposit_id, doc_type, storage_path, file_name, institution_id)
    values ($1, $2, $3, 'f.pdf', $4)`, [soon.id, t, `${instA}/${soon.id}/${t}.pdf`, instA]));
}
await as(userA, () => q(`select submit_deposit($1)`, [soon.id]));
await as(verifier, () => q(`select review_deposit($1, 'verify')`, [soon.id]));
const n1 = (await as("service", () => one(`select run_alerts() as n`))).n;
const n2 = (await as("service", () => one(`select run_alerts() as n`))).n;
const kinds = (await q(`select kind from notifications where deposit_id = $1 and kind like 'maturity%'`, [soon.id])).map((r) => r.kind);
assert.deepEqual(kinds, ["maturity_30"]);
assert.equal(n2, 0);
await as(userA, () => fails(q(`select run_alerts()`), /permission denied/));
ok(`alerts: 30-day reminder raised once (run1=${n1}, run2=${n2}); users cannot trigger job`);

// --- renewal -----------------------------------------------------------------
const renewal = await as(userA, () => one(`insert into deposits
  (institution_id, replaces_deposit_id, instrument_number, bank_name, amount, issue_date, maturity_date)
  values ($1, $2, 'FDR-SOON-R', 'Canara Bank', 100000, current_date, current_date + 1100) returning id`, [instA, soon.id]));
for (const t of ["fdr_scan", "affidavit", "loa"]) {
  await as(userA, () => q(`insert into deposit_documents (deposit_id, doc_type, storage_path, file_name, institution_id)
    values ($1, $2, $3, 'f.pdf', $4)`, [renewal.id, t, `${instA}/${renewal.id}/${t}.pdf`, instA]));
}
await as(userA, () => q(`select submit_deposit($1)`, [renewal.id]));
await as(verifier, () => q(`select review_deposit($1, 'verify')`, [renewal.id]));
assert.equal((await one(`select status from deposits where id = $1`, [soon.id])).status, "replaced");
ok("renewal verified -> original deposit marked replaced");

// --- release -----------------------------------------------------------------
const rr = (await as(userA, () => one(`select create_release_request($1, 'course_closure', 'Programme closed in 2026') as id`, [dep.id]))).id;
await as(userA, () => fails(q(`select submit_release_request($1)`, [rr]), /release letter, affidavit/));
for (const t of ["release_letter", "affidavit"]) {
  await as(userA, () => q(`insert into deposit_documents (release_request_id, doc_type, storage_path, file_name, institution_id)
    values ($1, $2, $3, 'f.pdf', $4)`, [rr, t, `${instA}/releases/${rr}/${t}.pdf`, instA]));
}
await as(userA, () => q(`select submit_release_request($1)`, [rr]));
assert.equal((await one(`select status from deposits where id = $1`, [dep.id])).status, "release_requested");
await as(roNorth, () => fails(q(`select decide_release($1, 'reject')`, [rr]), /note/));
await as(roNorth, () => q(`select decide_release($1, 'approve', 'NOC issued')`, [rr]));
assert.equal((await one(`select status from deposits where id = $1`, [dep.id])).status, "released");
ok("release: docs enforced, submitted, approved -> deposit released");

// --- refund / penalty quote (G2) ---------------------------------------------
const quoteDep = (await as(userA, () => one(`insert into deposits
  (institution_id, instrument_number, bank_name, amount, interest_rate, issue_date, maturity_date)
  values ($1, 'FDR-QUOTE', 'Bank of Baroda', 100000, 8, '2020-04-01', '2025-04-01') returning id`,
  [instA]))).id;
const quote = (await as(userA, () => one(`select release_quote($1, '2024-04-01'::date) as q`, [quoteDep]))).q;
assert.equal(quote.holding_days, 1461);
assert.equal(quote.holding_years, 4);
assert.equal(quote.accrued_interest, 32021.92); // 100000 @ 8% for 1461 days
assert.equal(quote.penalty_pct, 10);
assert.equal(quote.penalty_amount, 10000);
assert.equal(quote.net_payable, 122021.92);
assert.equal(quote.eligible, false);
assert.deepEqual(quote.reasons, ["EARLY_RELEASE_BEFORE_MIN_HOLDING"]);

const later = (await as(userA, () => one(`select release_quote($1, '2031-01-01'::date) as q`, [quoteDep]))).q;
assert.equal(later.penalty_pct, 0);
assert.equal(later.net_payable, Number((later.principal + later.accrued_interest).toFixed(2)));
assert.equal(later.eligible, true);
assert.ok(later.reasons.includes("INSTRUMENT_ALREADY_MATURED"));

const zeroDep = (await as(userA, () => one(`insert into deposits
  (institution_id, instrument_number, bank_name, amount, interest_rate, issue_date, maturity_date)
  values ($1, 'FDR-NOINT', 'Bank of Baroda', 100000, 0, '2020-04-01', '2025-04-01') returning id`,
  [instA]))).id;
await db.query(`update deposits set required_amount = 150000 where id = $1`, [zeroDep]);
const zero = (await as(userA, () => one(`select release_quote($1, '2024-04-01'::date) as q`, [zeroDep]))).q;
assert.equal(zero.accrued_interest, 0);
assert.equal(zero.shortfall, 50000);
assert.ok(zero.reasons.includes("DEPOSIT_BELOW_REQUIRED"));

await as(userB, () => fails(q(`select release_quote($1, '2024-04-01'::date)`, [quoteDep]), /Deposit not found/));
ok("refund quote: 8% simple interest, 10% early-release penalty, zero-rate and shortfall cases, scoped");

const sanctioned = await one(`select quote, sanctioned_amount, sanctioned_by, sanctioned_at
  from release_requests where id = $1`, [rr]);
assert.equal(Number(sanctioned.sanctioned_amount), Number(sanctioned.quote.net_payable));
assert.equal(sanctioned.sanctioned_by, roNorth);
assert.ok(sanctioned.sanctioned_at);
assert.equal(Number(sanctioned.quote.principal), 500000);
assert.equal(Number(sanctioned.quote.penalty_pct), 10); // issued two days ago
const sanctionAudit = await one(`select changes from audit_logs
  where entity_type = 'release_requests' and entity_id = $1 order by id desc limit 1`, [rr]);
assert.ok(sanctionAudit.changes.sanctioned_amount);
// the overview view must expose the frozen sanction (it selects r.*)
const viaView = await as(userA, () => one(`select sanctioned_amount, quote, amount
  from release_overview where id = $1`, [rr]));
assert.equal(Number(viaView.sanctioned_amount), Number(sanctioned.quote.net_payable));
assert.equal(Number(viaView.quote.principal), 500000);
assert.equal(Number(viaView.amount), 500000);
ok(`approval freezes the quote: sanctioned ${sanctioned.quote.net_payable} recorded in the audit trail`);

// --- audit + visibility ------------------------------------------------------
const audit = await as(userA, () => q(`select action, entity_type, summary, actor_email from audit_logs
  where deposit_id = $1 and action = 'status_change' order by id`, [dep.id]));
assert.ok(audit.some((a) => a.summary.includes("verified") && a.actor_email === "ro.north@x"));
assert.ok(audit.some((a) => a.summary.includes("released — NOC issued")));
assert.equal((await as(userB, () => q(`select id from audit_logs where institution_id <> $1`, [instB]))).length, 0);
await as(userA, () => fails(q(`delete from audit_logs`), /permission denied/));
ok(`audit trail: ${audit.length} status changes with actor + notes; tamper-proof; scoped`);

const roSwView = await as(roSouthWest, () => q(`select id from deposit_overview`));
assert.equal(roSwView.length, 0);
const stats = await as(verifier, () => one(`select dashboard_stats() as s`));
assert.equal(stats.s.held_count, 1);
assert.equal(stats.s.released_value, 500000);
const statsB = await as(userB, () => one(`select dashboard_stats() as s`));
assert.equal(statsB.s.released_value, 0);
ok("dashboard stats and overview views respect scope");

// --- KPI metrics (G4) --------------------------------------------------------
// A dedicated region and officer keep the rates isolated from earlier fixtures
// (dashboard_stats is security invoker, so RLS scopes every sample).
const instC = (await one(`insert into institutions (aicte_id, name, state, region)
  values ('1-3000003', 'Gamma Polytechnic', 'Odisha', 'eastern') returning id`)).id;
const roEast = await user("ro.east@x", { role: "regional_officer", region: "eastern" });
await db.query(`insert into deposits
  (institution_id, instrument_number, bank_name, amount, issue_date, maturity_date,
   status, submitted_at, verified_at)
  values
    ($1, 'KPI-2', 'B', 1000, current_date - 500, current_date + 500, 'replaced',
     now() - interval '60 days', now() - interval '60 days' + interval '2 hours'),
    ($1, 'KPI-4', 'B', 1000, current_date - 500, current_date + 500, 'replaced',
     now() - interval '60 days', now() - interval '60 days' + interval '4 hours'),
    ($1, 'KPI-8', 'B', 1000, current_date - 500, current_date + 500, 'replaced',
     now() - interval '60 days', now() - interval '60 days' + interval '8 hours'),
    ($1, 'KPI-16', 'B', 1000, current_date - 500, current_date + 500, 'replaced',
     now() - interval '60 days', now() - interval '60 days' + interval '16 hours')`, [instC]);

// two renewals and one lapse: compliance = 2 / (2 + 1)
for (const n of [1, 2]) {
  const orig = (await one(`insert into deposits
    (institution_id, instrument_number, bank_name, amount, issue_date, maturity_date, status)
    values ($1, $2, 'B', 1000, current_date - 100, current_date + 10, 'verified') returning id`,
    [instC, `ORIG-${n}`])).id;
  await db.query(`insert into deposits
    (institution_id, instrument_number, bank_name, amount, issue_date, maturity_date, status, replaces_deposit_id)
    values ($1, $2, 'B', 1000, current_date, current_date + 1000, 'verified', $3)`,
    [instC, `RENEW-${n}`, orig]);
}
const lapsedDep = (await one(`insert into deposits
  (institution_id, instrument_number, bank_name, amount, issue_date, maturity_date, status)
  values ($1, 'LAPSED-1', 'B', 1000, current_date - 1000, current_date - 30, 'verified') returning id`,
  [instC])).id;
await db.query(`insert into discrepancies (deposit_id, institution_id, code, severity, message, created_at)
  values ($1, $2, 'TEST_FLAG', 'warning', 'ageing fixture', now() - interval '2 days'),
         ($1, $2, 'TEST_FLAG', 'warning', 'ageing fixture', now() - interval '6 days'),
         ($1, $2, 'TEST_FLAG', 'warning', 'ageing fixture', now() - interval '10 days')`, [lapsedDep, instC]);

const kpi = (await as(roEast, () => one(`select dashboard_stats() as s`))).s;
assert.equal(kpi.avg_verification_hours, 7.5); // (2 + 4 + 8 + 16) / 4
assert.equal(kpi.p90_verification_hours, 13.6);
assert.equal(kpi.renewal_compliance_pct, 66.7);
assert.equal(kpi.open_flag_p50_days, 6);
assert.equal(kpi.open_flag_p90_days, 9.2);

const instD = (await one(`insert into institutions (aicte_id, name, state, region)
  values ('1-4000004', 'Delta Institute', 'Assam', 'eastern') returning id`)).id;
const userD = await user("d@x", { role: "institute_user", institution_id: instD });
const emptyKpi = (await as(userD, () => one(`select dashboard_stats() as s`))).s;
assert.equal(emptyKpi.avg_verification_hours, null);
assert.equal(emptyKpi.renewal_compliance_pct, null);
assert.equal(emptyKpi.open_flag_p50_days, null);
ok("KPI metrics: 7.5h average / 13.6h p90 verification, 66.7% renewal compliance, 6d / 9.2d flag ageing, null when empty");

// storage policies
await as(userA, () => q(`insert into storage.objects (bucket_id, name, owner_id) values ('deposit-documents', $1, $2)`, [`${instA}/x/y.pdf`, userA]));
await as(userA, () => fails(q(`insert into storage.objects (bucket_id, name, owner_id) values ('deposit-documents', $1, $2)`, [`${instB}/x/y.pdf`, userA]), /row-level security/));
assert.equal((await as(userB, () => q(`select id from storage.objects`))).length, 0);
assert.equal((await as(roNorth, () => q(`select id from storage.objects`))).length, 1);
ok("storage: upload only into own institution folder; reads scoped");

await as(admin, () => q(`select log_event('login')`));
assert.equal((await one(`select count(*)::int n from audit_logs where action = 'login'`)).n, 1);
ok("login events logged");

await as(userA, () => fails(q(`select admin_update_profile($1, 'admin', null, null, 'x', null, true)`, [userA]), /Only administrators/));
await as(admin, () => fails(q(`select admin_update_profile($1, 'institute_user', null, null, 'x', null, true)`, [userB]), /profile_scope/));
await as(admin, () => q(`select admin_update_profile($1, 'regional_officer', null, 'eastern', 'Bee', 'RO', true)`, [userB]));
const changed = await one(`select role, region, institution_id from profiles where id = $1`, [userB]);
assert.deepEqual([changed.role, changed.region, changed.institution_id], ["regional_officer", "eastern", null]);
assert.equal((await one(`select actor_id from audit_logs where entity_type = 'profiles' and entity_id = $1 order by id desc limit 1`, [userB])).actor_id, admin);
ok("admin profile changes validated and attributed in audit log");

const feedA = await as(userA, () => q(`select title, kind from notification_feed(100)`));
const feedRO = await as(roNorth, () => q(`select title, kind from notification_feed(100)`));
assert.ok(feedA.some((n) => /verified/.test(n.title)) && !feedA.some((n) => /submitted for verification/.test(n.title)));
assert.ok(feedRO.some((n) => /submitted for verification/.test(n.title)) && !feedRO.some((n) => / verified$/.test(n.title)));
const unread = (await as(userA, () => one(`select unread_notification_count() n`))).n;
await as(userA, () => q(`select mark_notifications_read()`));
assert.equal((await as(userA, () => one(`select unread_notification_count() n`))).n, 0);
ok(`notification feeds split by audience (institute ${feedA.length}, officer ${feedRO.length}); ${unread} marked read`);

console.log("\nAll database checks passed.");
