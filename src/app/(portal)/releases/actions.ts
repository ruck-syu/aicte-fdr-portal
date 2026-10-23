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
  });
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: decision === "approve" ? "Release approved. The deposit is marked as released." : "Release rejected." };
}
