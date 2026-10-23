"use server";

import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/errors";
import type { ActionState } from "@/lib/types";

/**
 * The browser renders the PDF; this records that it happened. `report.export`
 * is the audited action for both CSV and print output.
 */
export async function logPrintExport(summary: string): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("log_event", {
    p_action: "report.export",
    p_summary: `PDF · ${String(summary).slice(0, 460)}`,
  });
  if (error) return { error: friendlyError(error) };
  return { ok: "Export recorded." };
}
