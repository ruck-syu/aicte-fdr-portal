import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DOCUMENTS_BUCKET } from "@/lib/env";

/**
 * Opens a stored document through a short-lived signed URL. Both the row
 * lookup and the signing run as the caller, so RLS and storage policies
 * decide access; every view is written to the audit trail.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/documents/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: doc } = await supabase
    .from("deposit_documents")
    .select("id, storage_path, file_name, doc_type, deposit_id, release_request_id")
    .eq("id", id)
    .maybeSingle();
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: signed, error } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(doc.storage_path, 60);
  if (error || !signed) return NextResponse.json({ error: "Could not open document" }, { status: 404 });

  await supabase.rpc("log_event", {
    p_action: "document.view",
    p_summary: `${doc.file_name} (${doc.doc_type}) on ${doc.release_request_id ? `release ${doc.release_request_id}` : `deposit ${doc.deposit_id}`}`,
  });

  return NextResponse.redirect(signed.signedUrl, { headers: { "Cache-Control": "no-store" } });
}
