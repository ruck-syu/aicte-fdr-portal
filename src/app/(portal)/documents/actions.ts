"use server";

import { z } from "zod";
import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/errors";
import { ALLOWED_MIME_TYPES, DOCUMENTS_BUCKET, MAX_UPLOAD_BYTES } from "@/lib/env";
import type { ActionState } from "@/lib/types";

const recordSchema = z
  .object({
    depositId: z.string().uuid().nullable(),
    releaseRequestId: z.string().uuid().nullable(),
    docType: z.enum([
      "fdr_scan",
      "affidavit",
      "loa",
      "payment_receipt",
      "bank_certificate",
      "clearance_certificate",
      "release_letter",
      "other",
    ]),
    path: z.string().min(10).max(300),
    fileName: z.string().trim().min(1).max(200),
    mimeType: z.string().refine((m) => ALLOWED_MIME_TYPES.includes(m), "Unsupported file type"),
    size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  })
  .refine((v) => v.depositId || v.releaseRequestId, "Document must belong to a deposit or release request");

/**
 * Records metadata for a file the browser has already uploaded to Storage.
 * RLS + the documents trigger enforce ownership, path prefix and versioning.
 */
export async function recordDocument(input: z.input<typeof recordSchema>): Promise<ActionState> {
  await requireUser();
  const parsed = recordSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid upload" };
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("deposit_documents").insert({
    deposit_id: v.depositId,
    release_request_id: v.releaseRequestId,
    doc_type: v.docType,
    storage_path: v.path,
    file_name: v.fileName,
    mime_type: v.mimeType,
    size_bytes: v.size,
  });
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: "Uploaded." };
}

export async function deleteDocument(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();
  const { data, error } = await supabase.from("deposit_documents").delete().eq("id", id).select("storage_path");
  if (error) return { error: friendlyError(error) };
  if (!data?.length) return { error: "Only your own uploads on a draft can be removed." };
  await supabase.storage.from(DOCUMENTS_BUCKET).remove([data[0].storage_path]);
  refresh();
  return { ok: "Document removed." };
}
