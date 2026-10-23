"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/errors";
import type { ActionState } from "@/lib/types";

export async function markRead(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const id = formData.get("id");
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_notifications_read", { p_ids: id ? [String(id)] : null });
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: "Marked as read." };
}
