"use server";

import { z } from "zod";
import { refresh } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { friendlyError } from "@/lib/errors";
import { CLEARANCE_CELL_LABELS, DOCUMENT_LABELS, REGION_LABELS, ROLE_LABELS } from "@/lib/labels";
import type { ActionState, AppRole, ClearanceCell, DocumentType, Region } from "@/lib/types";

const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const roles = Object.keys(ROLE_LABELS) as [AppRole, ...AppRole[]];
const regions = Object.keys(REGION_LABELS) as [Region, ...Region[]];
const docTypes = Object.keys(DOCUMENT_LABELS) as [DocumentType, ...DocumentType[]];
const clearanceCells = Object.keys(CLEARANCE_CELL_LABELS) as [ClearanceCell, ...ClearanceCell[]];

const scopeSchema = z
  .object({
    role: z.enum(roles, { message: "Choose a role" }),
    institution_id: z.preprocess(blankToNull, z.string().uuid().nullable()),
    region: z.preprocess(blankToNull, z.enum(regions).nullable()),
    clearance_cell: z.preprocess(blankToNull, z.enum(clearanceCells).nullable()),
    full_name: z.preprocess(blankToNull, z.string().trim().max(120).nullable()),
    designation: z.preprocess(blankToNull, z.string().trim().max(120).nullable()),
  })
  .refine((v) => v.role !== "institute_user" || v.institution_id, {
    message: "Institute users must be linked to an institution",
  })
  .refine((v) => v.role !== "regional_officer" || v.region, { message: "Regional officers need a region" })
  .refine((v) => v.role !== "release_officer" || v.clearance_cell, {
    message: "Release clearance officers must be assigned to a cell",
  });

// ---------------------------------------------------------------- users

export async function createUser(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  const raw = Object.fromEntries(formData);
  const scope = scopeSchema.safeParse(raw);
  if (!scope.success) return { error: scope.error.issues[0]?.message };
  const creds = z
    .object({
      email: z.string().trim().toLowerCase().email("Enter a valid email"),
      password: z.string().min(10, "Temporary password must be at least 10 characters").max(72),
    })
    .safeParse(raw);
  if (!creds.success) return { error: creds.error.issues[0]?.message };

  const s = scope.data;
  const { data: created, error } = await createAdminClient().auth.admin.createUser({
    email: creds.data.email,
    password: creds.data.password,
    email_confirm: true,
    app_metadata: {
      role: s.role,
      institution_id: s.role === "institute_user" ? s.institution_id : null,
      region: s.role === "regional_officer" ? s.region : null,
      clearance_cell: s.role === "release_officer" ? s.clearance_cell : null,
      full_name: s.full_name,
      designation: s.designation,
    },
  });
  if (error) {
    return { error: /already|registered|exists/i.test(error.message) ? "A user with this email already exists." : error.message };
  }
  const supabase = await createClient();
  // GoTrue writes app_metadata just after the auth.users row is inserted, so the
  // handle_new_user trigger cannot copy role/scope into the profile; assign it here.
  const { error: profileError } = await supabase.rpc("admin_update_profile", {
    p_id: created.user.id,
    p_role: s.role,
    p_institution: s.institution_id,
    p_region: s.region,
    p_full_name: s.full_name ?? "",
    p_designation: s.designation ?? "",
    p_active: true,
    p_clearance_cell: s.clearance_cell,
  });
  if (profileError) {
    return { error: `Account created, but assigning the role failed: ${friendlyError(profileError)}` };
  }
  await supabase.rpc("log_event", {
    p_action: "user.create",
    p_summary: `${creds.data.email} as ${ROLE_LABELS[s.role]}`,
  });
  refresh();
  return { ok: `Account created for ${creds.data.email}. Share the temporary password securely; they can change it after signing in.` };
}

export async function updateUser(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  const raw = Object.fromEntries(formData);
  const scope = scopeSchema.safeParse(raw);
  if (!scope.success) return { error: scope.error.issues[0]?.message };
  const s = scope.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_profile", {
    p_id: String(raw.id),
    p_role: s.role,
    p_institution: s.institution_id,
    p_region: s.region,
    p_full_name: s.full_name ?? "",
    p_designation: s.designation ?? "",
    p_active: raw.is_active === "on",
    p_clearance_cell: s.clearance_cell,
  });
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: "User updated." };
}

// --------------------------------------------------------- institutions

const institutionSchema = z.object({
  aicte_id: z.string().trim().min(3, "AICTE ID is required").max(40),
  name: z.string().trim().min(3, "Name is required").max(300),
  state: z.string().trim().min(2, "State is required").max(80),
  city: z.preprocess(blankToNull, z.string().trim().max(80).nullable()),
  region: z.enum(regions, { message: "Choose a region" }),
  address: z.preprocess(blankToNull, z.string().trim().max(500).nullable()),
  contact_email: z.preprocess(blankToNull, z.string().trim().email("Invalid contact email").nullable()),
  contact_phone: z.preprocess(blankToNull, z.string().trim().max(30).nullable()),
});

export async function saveInstitution(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  const parsed = institutionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const id = formData.get("id");
  // A checkbox is absent when unchecked, so it is read here rather than coerced
  // by the schema (which also parses CSV rows as text).
  const data = { ...parsed.data, sms_opt_in: formData.get("sms_opt_in") === "on" };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("institutions").update(data).eq("id", String(id))
    : await supabase.from("institutions").insert(data);
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: id ? "Institution updated." : `${parsed.data.name} added.` };
}

/** Minimal RFC 4180 parser (quoted fields, escaped quotes, CRLF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

const regionAliases: Record<string, Region> = Object.fromEntries(
  Object.entries(REGION_LABELS).flatMap(([k, label]) => [
    [k, k],
    [k.replace(/_/g, " "), k],
    [k.replace(/_/g, "-"), k],
    [label.toLowerCase(), k],
    [label.split(" (")[0].toLowerCase(), k],
  ]),
) as Record<string, Region>;

export async function importInstitutions(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file." };
  if (file.size > 2 * 1024 * 1024) return { error: "CSV must be under 2 MB." };

  const rows = parseCsv((await file.text()).replace(/^﻿/, ""));
  if (rows.length < 2) return { error: "The file has no data rows." };
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const missing = ["aicte_id", "name", "state", "region"].filter((h) => !header.includes(h));
  if (missing.length) return { error: `Missing column(s): ${missing.join(", ")}` };

  const records: z.infer<typeof institutionSchema>[] = [];
  const seen = new Set<string>();
  for (let r = 1; r < rows.length; r++) {
    const obj = Object.fromEntries(header.map((h, i) => [h, rows[r][i]?.trim() ?? ""]));
    obj.region = regionAliases[String(obj.region).toLowerCase()] ?? obj.region;
    const parsed = institutionSchema.safeParse(obj);
    if (!parsed.success) return { error: `Row ${r + 1}: ${parsed.error.issues[0]?.message}` };
    if (seen.has(parsed.data.aicte_id)) return { error: `Row ${r + 1}: duplicate AICTE ID ${parsed.data.aicte_id}` };
    seen.add(parsed.data.aicte_id);
    records.push(parsed.data);
  }
  if (records.length > 5000) return { error: "Import at most 5,000 institutions at a time." };

  const supabase = await createClient();
  const { error } = await supabase.from("institutions").upsert(records, { onConflict: "aicte_id" });
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: `Imported ${records.length} institution${records.length === 1 ? "" : "s"} (new rows added, existing AICTE IDs updated).` };
}

// ------------------------------------------------------------- settings

export async function saveSettings(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  const alertDays = String(formData.get("alert_days") ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  const parsed = z
    .object({
      alert_days: z
        .array(z.number().int().min(1).max(365), { message: "Alert days must be whole numbers between 1 and 365" })
        .min(1, "Enter at least one alert threshold")
        .max(6),
      escalation_days: z.coerce.number().int().min(0).max(90),
      submission_window_days: z.coerce.number().int().min(1).max(180),
      min_holding_years: z.coerce.number().int().min(0).max(50),
      early_release_penalty_pct: z.coerce.number().min(0).max(100),
      default_interest_rate: z.coerce.number().min(0).max(50),
      release_second_approval_threshold: z.coerce.number().min(0).max(1e12),
      retention_years: z.coerce.number().int().min(1).max(50),
      required_documents: z.array(z.enum(docTypes)),
      release_required_documents: z.array(z.enum(docTypes)),
    })
    .safeParse({
      alert_days: alertDays,
      escalation_days: formData.get("escalation_days"),
      submission_window_days: formData.get("submission_window_days"),
      min_holding_years: formData.get("min_holding_years"),
      early_release_penalty_pct: formData.get("early_release_penalty_pct"),
      default_interest_rate: formData.get("default_interest_rate"),
      release_second_approval_threshold: formData.get("release_second_approval_threshold"),
      retention_years: formData.get("retention_years"),
      required_documents: formData.getAll("required_documents"),
      release_required_documents: formData.getAll("release_required_documents"),
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  if (alertDays.some((d) => !Number.isInteger(d))) return { error: "Alert days must be whole numbers." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("app_settings")
    .update({ ...parsed.data, alert_days: [...new Set(parsed.data.alert_days)].sort((a, b) => b - a) })
    .eq("id", true);
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: "Settings saved. New thresholds apply from the next daily alert run." };
}
