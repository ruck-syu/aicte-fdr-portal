// Loads demo data into a Supabase project: users for every role, institutions,
// demands, and deposits in each workflow state with placeholder PDFs.
//
//   npm run seed          (reads .env.local)
//
// Safe to re-run: existing users / institutions are reused, and deposits are
// only created when the database has none.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) in .env.local");
  process.exit(1);
}
const PASSWORD = process.env.SEED_PASSWORD ?? "Demo@12345";
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};
const day = (offset) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const ts = (offset) => new Date(Date.now() + offset * 86400_000).toISOString();

/** A one-page PDF with a few lines of text (valid xref offsets). */
function placeholderPdf(lines) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const text = lines.map((l, i) => `BT /F1 ${i === 0 ? 16 : 11} Tf 60 ${760 - i * 22} Td (${esc(l)}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}

// ------------------------------------------------------------ institutions
const institutions = [
  { aicte_id: "1-1000000001", name: "Alpha Institute of Technology", state: "Uttar Pradesh", city: "Lucknow", region: "northern", contact_email: "registrar@alpha.demo.fdr" },
  { aicte_id: "1-1000000002", name: "Beta College of Engineering", state: "Uttar Pradesh", city: "Kanpur", region: "northern", contact_email: "office@beta.demo.fdr" },
  { aicte_id: "1-1000000003", name: "Gamma Polytechnic", state: "Maharashtra", city: "Pune", region: "western" },
  { aicte_id: "1-1000000004", name: "Delta School of Management", state: "Tamil Nadu", city: "Chennai", region: "southern" },
  { aicte_id: "1-1000000005", name: "Epsilon Institute of Pharmacy", state: "West Bengal", city: "Kolkata", region: "eastern" },
  { aicte_id: "1-1000000006", name: "Zeta College of Architecture", state: "Punjab", city: "Mohali", region: "north_western" },
];
const insts = must(
  await db.from("institutions").upsert(institutions, { onConflict: "aicte_id" }).select("id, aicte_id, name"),
  "institutions",
);
const inst = Object.fromEntries(insts.map((i) => [i.aicte_id.slice(-1), i]));
console.log(`✓ ${insts.length} institutions`);

// ------------------------------------------------------------------- users
const users = [
  { email: "admin@demo.fdr", role: "admin", full_name: "Asha Admin", designation: "Portal Administrator" },
  { email: "verifier@demo.fdr", role: "aicte_verifier", full_name: "Vikram Verifier", designation: "Deputy Director (Finance)" },
  { email: "ro.northern@demo.fdr", role: "regional_officer", region: "northern", full_name: "Neha Rao", designation: "Regional Officer, Kanpur" },
  { email: "ro.western@demo.fdr", role: "regional_officer", region: "western", full_name: "Rohan Desai", designation: "Regional Officer, Mumbai" },
  { email: "accounts@alpha.demo.fdr", role: "institute_user", institution_id: inst[1].id, full_name: "Arun Kumar", designation: "Accounts Officer" },
  { email: "accounts@beta.demo.fdr", role: "institute_user", institution_id: inst[2].id, full_name: "Bina Sharma", designation: "Accounts Officer" },
  { email: "accounts@gamma.demo.fdr", role: "institute_user", institution_id: inst[3].id, full_name: "Ganesh Patil", designation: "Finance Officer" },
];
const existing = new Map();
for (let page = 1; ; page++) {
  const { data } = await db.auth.admin.listUsers({ page, perPage: 1000 });
  for (const u of data?.users ?? []) existing.set(u.email, u.id);
  if (!data || data.users.length < 1000) break;
}
const uid = {};
for (const u of users) {
  if (existing.has(u.email)) {
    uid[u.email] = existing.get(u.email);
    continue;
  }
  const { email, ...meta } = u;
  const { data, error } = await db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, app_metadata: meta });
  if (error) throw new Error(`user ${email}: ${error.message}`);
  uid[email] = data.user.id;
}
// The auth trigger only sees app_metadata that is present when the auth.users
// row is inserted, and GoTrue applies it immediately after, so profiles can be
// left with a null role. Re-assert the fixtures on every run so re-seeding
// repairs existing accounts instead of skipping them.
for (const u of users) {
  const { email, ...profile } = u;
  must(
    await db.from("profiles").upsert(
      { id: uid[email], email, ...profile, institution_id: u.institution_id ?? null, region: u.region ?? null },
      { onConflict: "id" },
    ),
    `profile ${email}`,
  );
}
console.log(`✓ ${users.length} users (password: ${PASSWORD})`);

// ---------------------------------------------------------------- deposits
const { count } = await db.from("deposits").select("id", { count: "exact", head: true });
if (count) {
  console.log(`• ${count} deposits already present: skipping deposit data`);
  await db.rpc("run_alerts");
  process.exit(0);
}

const verifier = uid["verifier@demo.fdr"];
const ro = uid["ro.northern@demo.fdr"];

async function demand(i, d) {
  return must(
    await db
      .from("deposit_demands")
      .insert({ institution_id: inst[i].id, created_by: ro, ...d })
      .select("id, reference_no")
      .single(),
    "demand",
  );
}

async function deposit(i, d) {
  const by = uid[`accounts@${inst[i].name.split(" ")[0].toLowerCase()}.demo.fdr`] ?? null;
  const row = {
    institution_id: inst[i].id,
    created_by: by,
    instrument_type: "fdr",
    bank_branch: "Main Branch",
    interest_rate: 7.1,
    auto_renewal: false,
    ...d,
  };
  if (["submitted", "discrepancy", "verified", "release_requested", "released", "replaced"].includes(row.status)) {
    row.submitted_at ??= ts(-40);
    row.submitted_by ??= by;
  }
  if (["verified", "release_requested", "released", "replaced"].includes(row.status)) {
    row.verified_at ??= ts(-35);
    row.verified_by ??= verifier;
    row.bank_check ??= "confirmed";
    row.bank_check_ref ??= `BNK/CONF/${Math.floor(Math.random() * 90000 + 10000)}`;
  }
  return must(await db.from("deposits").insert(row).select("id, reference_no, institution_id, created_by").single(), "deposit");
}

async function attach(dep, types, { release } = {}) {
  for (const t of types) {
    const path = `${dep.institution_id}/${release ? `releases/${release}` : dep.id}/${t}-${crypto.randomUUID()}.pdf`;
    const pdf = placeholderPdf([
      "DEMO DOCUMENT - NOT A REAL INSTRUMENT",
      `Type: ${t}`,
      `Deposit: ${dep.reference_no}`,
      "Generated by scripts/seed.mjs for the AICTE FDR portal demo.",
    ]);
    must(await db.storage.from("deposit-documents").upload(path, pdf, { contentType: "application/pdf" }), `upload ${t}`);
    must(
      await db.from("deposit_documents").insert({
        deposit_id: release ? null : dep.id,
        release_request_id: release ?? null,
        institution_id: dep.institution_id,
        doc_type: t,
        storage_path: path,
        file_name: `${t.replace(/_/g, "-")}.pdf`,
        mime_type: "application/pdf",
        size_bytes: pdf.length,
        uploaded_by: release ? uid["accounts@beta.demo.fdr"] : (dep.created_by ?? null),
      }),
      `document ${t}`,
    );
  }
}

const allDocs = ["fdr_scan", "affidavit", "loa"];

// Alpha (Northern): healthy, maturing, lapsed, a draft and one awaiting verification.
const dA1 = await demand(1, { approval_case_id: "F.No. Northern/1-1000000001/2025/EOA", program: "B.Tech (CSE, ECE)", required_amount: 3500000, approval_valid_until: day(500), intimation_date: day(-420), status: "fulfilled" });
const dA2 = await demand(1, { approval_case_id: "F.No. Northern/1-1000000001/2026/EOA-MBA", program: "MBA", required_amount: 1500000, intimation_date: day(-10) });
const a1 = await deposit(1, { demand_id: dA1.id, instrument_number: "FDR/SBI/0045123", bank_name: "State Bank of India", ifsc: "SBIN0001234", amount: 2000000, issue_date: day(-400), maturity_date: day(330), status: "verified" });
const a2 = await deposit(1, { demand_id: dA1.id, instrument_number: "FDR/PNB/7781", bank_name: "Punjab National Bank", ifsc: "PUNB0123400", amount: 1500000, issue_date: day(-340), maturity_date: day(25), status: "verified" });
const a3 = await deposit(1, { instrument_number: "FDR/BOB/55102", bank_name: "Bank of Baroda", ifsc: "BARB0LUCKNO", amount: 500000, issue_date: day(-375), maturity_date: day(-10), status: "verified", approval_case_id: "F.No. Northern/1-1000000001/2024/EOA", required_amount: 500000 });
const a4 = await deposit(1, { demand_id: dA2.id, instrument_number: "FDR/HDFC/99120", bank_name: "HDFC Bank", ifsc: "HDFC0000456", amount: 1500000, issue_date: day(-3), maturity_date: day(1092), status: "draft" });
const a5 = await deposit(1, { instrument_number: "BG/ICICI/2026/311", instrument_type: "bank_guarantee", bank_name: "ICICI Bank", ifsc: "ICIC0000789", amount: 800000, issue_date: day(-12), maturity_date: day(1083), status: "submitted", submitted_at: ts(-2), approval_case_id: "F.No. Northern/1-1000000001/2026/INTAKE", required_amount: 800000 });
await attach(a1, allDocs);
await attach(a2, allDocs);
await attach(a3, allDocs);
await attach(a4, ["fdr_scan"]);
await attach(a5, allDocs);

// Renewal chain on Alpha: an older instrument replaced by a1.
const a0 = await deposit(1, { demand_id: dA1.id, instrument_number: "FDR/SBI/0031877", bank_name: "State Bank of India", ifsc: "SBIN0001234", amount: 2000000, issue_date: day(-765), maturity_date: day(-400), status: "verified", verified_at: ts(-760) });
must(await db.from("deposits").update({ replaces_deposit_id: a0.id }).eq("id", a1.id), "renewal link");
must(await db.from("deposits").update({ status: "replaced" }).eq("id", a0.id), "replace");
await attach(a0, allDocs);

// Beta (Northern): returned with discrepancies, maturing next quarter, release in review, released.
const dB1 = await demand(2, { approval_case_id: "F.No. Northern/1-1000000002/2025/EOA", program: "B.Tech (ME, CE)", required_amount: 2500000, approval_valid_until: day(300), intimation_date: day(-200) });
await demand(2, { approval_case_id: "F.No. Northern/1-1000000002/2026/DIPLOMA", program: "Diploma (Civil)", required_amount: 600000, intimation_date: day(-40) }); // overdue, nothing furnished
const b1 = await deposit(2, { demand_id: dB1.id, instrument_number: "FDR/CANARA/12093", bank_name: "Canara Bank", ifsc: "CNRB0004567", amount: 2200000, issue_date: day(-30), maturity_date: day(200), status: "discrepancy", submitted_at: ts(-20) });
const b2 = await deposit(2, { instrument_number: "FDR/UBI/33001", bank_name: "Union Bank of India", ifsc: "UBIN0530000", amount: 1000000, issue_date: day(-300), maturity_date: day(75), status: "verified", approval_case_id: "F.No. Northern/1-1000000002/2023/EOA", required_amount: 1000000 });
const b3 = await deposit(2, { instrument_number: "FDR/IOB/8812", bank_name: "Indian Overseas Bank", ifsc: "IOBA0001200", amount: 400000, issue_date: day(-1100), maturity_date: day(-5), status: "release_requested", approval_case_id: "F.No. Northern/1-1000000002/2022/MCA-CLOSURE", required_amount: 400000 });
const b4 = await deposit(2, { instrument_number: "DD/SBI/220341", instrument_type: "demand_draft", bank_name: "State Bank of India", ifsc: "SBIN0007788", amount: 300000, issue_date: day(-900), maturity_date: day(-500), status: "released", released_at: ts(-480), approval_case_id: "F.No. Northern/1-1000000002/2021/EOA", required_amount: 300000 });
await attach(b1, allDocs);
await attach(b2, allDocs);
await attach(b3, allDocs);
await attach(b4, ["fdr_scan", "affidavit"]);
must(
  await db.from("discrepancies").insert([
    { deposit_id: b1.id, institution_id: inst[2].id, code: "AMOUNT_BELOW_REQUIRED", severity: "error", source: "system", message: "Amount ₹22,00,000 is below the required ₹25,00,000." },
    { deposit_id: b1.id, institution_id: inst[2].id, code: "OFFICER_QUERY", severity: "error", source: "officer", raised_by: ro, message: "FDR scan is not legible; the lien in favour of AICTE is not visible. Upload a clearer copy." },
  ]),
  "discrepancies",
);
must(
  await db.from("comments").insert([
    { deposit_id: b1.id, institution_id: inst[2].id, author_id: ro, body: "[Return] Amount is short of the demand and the scan is unreadable. Please top up with an additional FDR or re-issue for the full amount." },
    { deposit_id: b1.id, institution_id: inst[2].id, author_id: uid["accounts@beta.demo.fdr"], body: "Noted. We are getting the FDR re-issued for ₹25 lakh and will upload by next week." },
  ]),
  "comments",
);
const rr = must(
  await db
    .from("release_requests")
    .insert({ deposit_id: b3.id, institution_id: inst[2].id, reason: "course_closure", details: "MCA programme closed from AY 2025-26 with AICTE approval; no students on roll.", status: "submitted", submitted_at: ts(-3), requested_by: uid["accounts@beta.demo.fdr"] })
    .select("id")
    .single(),
  "release request",
);
await attach(b3, ["release_letter", "affidavit", "clearance_certificate"], { release: rr.id });
must(
  await db.from("release_requests").insert({ deposit_id: b4.id, institution_id: inst[2].id, reason: "term_completion", status: "approved", submitted_at: ts(-500), decided_at: ts(-480), decided_by: verifier, decision_note: "All approvals closed; release authorised.", requested_by: uid["accounts@beta.demo.fdr"] }),
  "release approved",
);

// Gamma (Western), Delta, Epsilon, Zeta: spread across regions and maturities.
await demand(3, { approval_case_id: "F.No. Western/1-1000000003/2026/EOA", program: "Diploma (Mechanical)", required_amount: 700000, intimation_date: day(-30) }); // overdue, nothing furnished
const g1 = await deposit(3, { instrument_number: "FDR/BOM/44021", bank_name: "Bank of Maharashtra", ifsc: "MAHB0000123", amount: 700000, issue_date: day(-310), maturity_date: day(55), status: "verified", approval_case_id: "F.No. Western/1-1000000003/2024/EOA", required_amount: 700000 });
const g2 = await deposit(3, { instrument_number: "FDR/AXIS/77110", bank_name: "Axis Bank", ifsc: "UTIB0000999", amount: 900000, issue_date: day(-5), maturity_date: day(1090), status: "submitted", submitted_at: ts(-1), approval_case_id: "F.No. Western/1-1000000003/2026/INTAKE", required_amount: 900000 });
await attach(g1, allDocs);
await attach(g2, allDocs);
const others = [
  [4, { instrument_number: "FDR/IB/10023", bank_name: "Indian Bank", ifsc: "IDIB000C001", amount: 1200000, issue_date: day(-250), maturity_date: day(115), status: "verified" }],
  [4, { instrument_number: "FDR/IB/10024", bank_name: "Indian Bank", ifsc: "IDIB000C001", amount: 600000, issue_date: day(-200), maturity_date: day(165), status: "verified" }],
  [5, { instrument_number: "FDR/UCO/5003", bank_name: "UCO Bank", ifsc: "UCBA0000111", amount: 900000, issue_date: day(-330), maturity_date: day(35), status: "verified" }],
  [5, { instrument_number: "BG/SBI/2025/900", instrument_type: "bank_guarantee", bank_name: "State Bank of India", ifsc: "SBIN0000001", amount: 1100000, issue_date: day(-180), maturity_date: day(250), status: "verified" }],
  [6, { instrument_number: "FDR/PSB/7001", bank_name: "Punjab & Sind Bank", ifsc: "PSIB0000222", amount: 750000, issue_date: day(-360), maturity_date: day(6), status: "verified" }],
  [6, { instrument_number: "FDR/HDFC/7002", bank_name: "HDFC Bank", ifsc: "HDFC0000333", amount: 1300000, issue_date: day(-60), maturity_date: day(305), status: "verified" }],
];
for (const [i, d] of others) {
  const dep = await deposit(i, { approval_case_id: `F.No./1-100000000${i}/2025/EOA`, required_amount: d.amount, ...d });
  await attach(dep, allDocs);
}
console.log("✓ demands, deposits, documents, flags, comments and release requests");

const alerts = must(await db.rpc("run_alerts"), "run_alerts");
console.log(`✓ generated ${alerts} alerts`);
console.log("\nSign in with any of:");
for (const u of users) console.log(`  ${u.email.padEnd(26)} ${u.role}`);
