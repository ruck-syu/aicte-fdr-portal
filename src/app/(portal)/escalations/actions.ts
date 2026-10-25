"use server";

import { refresh } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/errors";
import type { ActionState } from "@/lib/types";

/**
 * Claim a lapsed-deposit escalation with a note. The database decides whether
 * this officer may sign for that region; the role check here only avoids an
 * action nobody can complete.
 */
export async function acknowledgeEscalation(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("regional_officer", "aicte_verifier", "admin");
  const supabase = await createClient();
  const { error } = await supabase.rpc("acknowledge_escalation", {
    p_id: String(formData.get("id")),
    p_note: String(formData.get("note") ?? ""),
  });
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: "Escalation acknowledged. The case stays open until the institution renews or releases." };
}
