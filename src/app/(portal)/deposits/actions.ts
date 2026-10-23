"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireRole, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { bankVerifier } from "@/lib/bank";
import { friendlyError } from "@/lib/errors";
import type { ActionState } from "@/lib/types";

const optionalText = z
  .string()
  .trim()
  .max(500)
  .transform((v) => v || null)
  .nullable()
  .optional();
const optionalDate = z
  .string()
  .trim()
  .transform((v) => v || null)
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Invalid date")
  .nullable()
  .optional();
const money = z.coerce.number({ message: "Enter an amount" }).positive("Amount must be greater than zero").max(1e12);
const optionalMoney = z
  .string()
  .trim()
  .transform((v) => (v ? Number(v.replace(/,/g, "")) : null))
  .refine((v) => v === null || (Number.isFinite(v) && v > 0), "Enter a valid amount")
  .nullable()
  .optional();

const depositSchema = z
  .object({
    instrument_type: z.enum(["fdr", "jfdr", "bank_guarantee", "demand_draft"]),
    instrument_number: z.string().trim().min(1, "Instrument number is required").max(60),
    bank_name: z.string().trim().min(2, "Bank name is required").max(120),
    bank_branch: optionalText,
    ifsc: optionalText,
    amount: money,
    interest_rate: z
      .string()
      .trim()
      .transform((v) => (v ? Number(v) : null))
      .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v < 100), "Enter a valid interest rate")
      .nullable()
      .optional(),
    issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Issue date is required"),
    maturity_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Maturity date is required"),
    auto_renewal: z.boolean(),
    approval_case_id: optionalText,
    program: optionalText,
    approval_valid_until: optionalDate,
    required_amount: optionalMoney,
    remarks: z
      .string()
      .trim()
      .max(2000)
      .transform((v) => v || null)
      .nullable()
      .optional(),
    demand_id: z
      .string()
      .uuid()
      .or(z.literal(""))
      .transform((v) => v || null)
      .nullable()
      .optional(),
  })
  .refine((d) => d.maturity_date > d.issue_date, {
    message: "Maturity date must be after the issue date",
    path: ["maturity_date"],
  });

function parseDeposit(formData: FormData) {
  const raw = Object.fromEntries(
    [
      "instrument_type",
      "instrument_number",
      "bank_name",
      "bank_branch",
      "ifsc",
      "amount",
      "interest_rate",
      "issue_date",
      "maturity_date",
      "approval_case_id",
      "program",
      "approval_valid_until",
      "required_amount",
      "remarks",
      "demand_id",
    ].map((k) => [k, (formData.get(k) as string | null) ?? ""]),
  );
  return depositSchema.safeParse({
    ...raw,
    amount: String(raw.amount).replace(/,/g, ""),
    auto_renewal: formData.get("auto_renewal") === "on",
  });
}

function firstIssue(error: z.ZodError) {
  return error.issues[0]?.message ?? "Please check the form";
}

export async function createDeposit(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("institute_user");
  if (!user.institution_id) return { error: "Your account is not linked to an institution." };
  const parsed = parseDeposit(formData);
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const replaces = (formData.get("replaces_deposit_id") as string | null) || null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deposits")
    .insert({ ...parsed.data, institution_id: user.institution_id, replaces_deposit_id: replaces })
    .select("id")
    .single();
  if (error) return { error: friendlyError(error) };
  redirect(`/deposits/${data.id}?created=1`);
}

export async function updateDeposit(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("institute_user");
  const id = String(formData.get("id") ?? "");
  const parsed = parseDeposit(formData);
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.from("deposits").update(parsed.data).eq("id", id).select("id");
  if (error) return { error: friendlyError(error) };
  if (!data?.length) return { error: "Only draft or returned deposits can be edited." };
  redirect(`/deposits/${id}`);
}

export async function deleteDeposit(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("institute_user");
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();

  const { data: docs } = await supabase.from("deposit_documents").select("storage_path").eq("deposit_id", id);
  const { data, error } = await supabase.from("deposits").delete().eq("id", id).select("id");
  if (error) return { error: friendlyError(error) };
  if (!data?.length) return { error: "Only drafts can be deleted." };
  if (docs?.length) {
    await supabase.storage.from("deposit-documents").remove(docs.map((d) => d.storage_path));
  }
  redirect("/deposits");
}

export async function submitDeposit(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("institute_user");
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_deposit", { p_deposit: String(formData.get("id")) });
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: "Submitted for verification. Any automatic flags are listed for the reviewing officer." };
}

export async function reviewDeposit(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("regional_officer", "aicte_verifier", "admin");
  const decision = String(formData.get("decision") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_deposit", {
    p_deposit: String(formData.get("id")),
    p_decision: decision,
    p_note: String(formData.get("note") ?? ""),
    p_override: formData.get("override") === "on",
  });
  if (error) return { error: friendlyError(error) };
  refresh();
  return {
    ok: { verify: "Deposit verified.", return: "Returned to the institution.", reject: "Deposit rejected." }[decision],
  };
}

export async function resolveDiscrepancy(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("regional_officer", "aicte_verifier", "admin");
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_discrepancy", {
    p_id: String(formData.get("id")),
    p_note: String(formData.get("note") ?? ""),
  });
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: "Flag resolved." };
}

export async function verifyWithBank(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("regional_officer", "aicte_verifier", "admin");
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("deposits")
    .select("id, bank_name, ifsc, instrument_number, amount, maturity_date")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: friendlyError(error) };
  if (!data) return { error: "Deposit not found." };

  const request = {
    bankName: data.bank_name,
    ifsc: data.ifsc,
    instrumentNumber: data.instrument_number,
    amount: Number(data.amount),
    maturityDate: data.maturity_date,
  };

  const verifier = bankVerifier();
  let result;
  try {
    result = await verifier.verify(request);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "The bank verification service is unavailable." };
  }

  const { error: rpcError } = await supabase.rpc("record_bank_verification", {
    p_deposit: id,
    p_provider: verifier.name,
    p_verdict: result.status,
    p_reference: result.reference ?? "",
    p_request: request,
    p_response: result,
  });
  if (rpcError) return { error: friendlyError(rpcError) };
  refresh();
  return {
    ok: {
      confirmed: "Bank confirmed the instrument; the deposit's bank status is updated.",
      mismatch: "The bank reports a mismatch. A BANK_MISMATCH flag was raised for review.",
      unavailable: "The bank verification service is unavailable. Record the confirmation manually below.",
    }[result.status],
  };
}

export async function setBankCheck(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("regional_officer", "aicte_verifier", "admin");
  const status = String(formData.get("bank_check") ?? "");
  if (!["not_requested", "requested", "confirmed", "mismatch"].includes(status)) {
    return { error: "Choose a bank verification status." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_bank_check", {
    p_deposit: String(formData.get("id")),
    p_status: status,
    p_ref: String(formData.get("ref") ?? ""),
  });
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: "Bank verification updated." };
}

export async function addComment(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: "Write a comment first." };
  if (body.length > 4000) return { error: "Comments are limited to 4000 characters." };
  const depositId = (formData.get("deposit_id") as string) || null;
  const releaseId = (formData.get("release_request_id") as string) || null;
  const supabase = await createClient();
  const { error } = await supabase.from("comments").insert({
    deposit_id: depositId,
    release_request_id: releaseId,
    body,
  }); // institution_id and author_id are set by trigger
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: "Comment added." };
}

export async function requestRelease(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("institute_user");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_release_request", {
    p_deposit: String(formData.get("id")),
    p_reason: String(formData.get("reason") ?? ""),
    p_details: String(formData.get("details") ?? ""),
  });
  if (error) return { error: friendlyError(error) };
  redirect(`/releases/${data}`);
}
