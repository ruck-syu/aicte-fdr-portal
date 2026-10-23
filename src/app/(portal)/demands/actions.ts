"use server";

import { z } from "zod";
import { refresh } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/errors";
import type { ActionState } from "@/lib/types";

const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

const demandSchema = z.object({
  institution_id: z.string().uuid("Choose an institution"),
  approval_case_id: z.string().trim().min(3, "Approval case / LOA reference is required").max(80),
  program: z.preprocess(blankToNull, z.string().trim().max(200).nullable()),
  required_amount: z.coerce.number({ message: "Enter the required amount" }).positive("Enter the required amount"),
  approval_valid_until: z.preprocess(blankToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()),
  intimation_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Intimation date is required"),
  notes: z.preprocess(blankToNull, z.string().trim().max(2000).nullable()),
  aph_rate_id: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? v : null),
    z.string().uuid().nullable(),
  ),
  override_note: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? v : null),
    z.string().trim().max(500).nullable(),
  ),
});

export async function createDemand(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("regional_officer", "aicte_verifier", "admin");
  const raw = Object.fromEntries(formData);
  const parsed = demandSchema.safeParse({ ...raw, required_amount: String(raw.required_amount ?? "").replace(/,/g, "") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { data, error } = await supabase.from("deposit_demands").insert(parsed.data).select("reference_no").single();
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: `Demand ${data.reference_no} issued. The institution can now furnish the deposit against it.` };
}

export async function setDemandStatus(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("regional_officer", "aicte_verifier", "admin");
  const status = String(formData.get("status"));
  if (!["open", "waived", "fulfilled"].includes(status)) return { error: "Invalid status" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deposit_demands")
    .update({ status })
    .eq("id", String(formData.get("id")))
    .select("id");
  if (error) return { error: friendlyError(error) };
  if (!data?.length) return { error: "Demand not found." };
  refresh();
  return { ok: "Demand updated." };
}
