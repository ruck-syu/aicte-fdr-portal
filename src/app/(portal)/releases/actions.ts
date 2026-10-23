"use server";

import { refresh } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/errors";
import type { ActionState } from "@/lib/types";

export async function submitRelease(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("institute_user");
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_release_request", { p_id: String(formData.get("id")) });
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: "Release request submitted for review." };
}

export async function withdrawRelease(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("institute_user");
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_release_request", { p_id: String(formData.get("id")) });
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: "Release request withdrawn." };
}

export async function decideRelease(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("regional_officer", "aicte_verifier", "admin");
  const decision = String(formData.get("decision") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_release", {
    p_id: String(formData.get("id")),
    p_decision: decision,
    p_note: String(formData.get("note") ?? ""),
    p_noc_reference: String(formData.get("noc_reference") ?? ""),
  });
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: decision === "approve" ? "Release approved and the NOC reference recorded." : "Release rejected." };
}

/** Grievance / Vigilance / PGRC sign-off on a submitted release. */
export async function recordClearance(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("release_officer", "admin");
  const status = String(formData.get("status") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_clearance", {
    p_id: String(formData.get("id")),
    p_cell: String(formData.get("cell")),
    p_status: status,
    p_note: String(formData.get("note") ?? ""),
  });
  if (error) return { error: friendlyError(error) };
  refresh();
  return {
    ok:
      status === "blocked"
        ? "Block recorded. The release stays on hold until the cell clears it."
        : "Clearance recorded.",
  };
}
