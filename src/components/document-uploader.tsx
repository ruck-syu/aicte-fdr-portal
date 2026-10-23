"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ALLOWED_MIME_TYPES, DOCUMENTS_BUCKET, MAX_UPLOAD_BYTES } from "@/lib/env";
import { DOCUMENT_LABELS } from "@/lib/labels";
import type { DocumentType } from "@/lib/types";
import { recordDocument } from "@/app/(portal)/documents/actions";
import { buttonClass } from "./ui";

/**
 * Uploads straight from the browser to Supabase Storage (bypassing Vercel's
 * request-size limit; storage RLS restricts the folder), then records the
 * file's metadata through a server action.
 */
export function DocumentUploader({
  institutionId,
  depositId,
  releaseRequestId,
  docTypes,
  defaultType,
}: {
  institutionId: string;
  depositId?: string;
  releaseRequestId?: string;
  docTypes: DocumentType[];
  defaultType?: DocumentType;
}) {
  const [docType, setDocType] = useState<DocumentType>(defaultType ?? docTypes[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setError(null);
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      setError("Only PDF, JPG or PNG files are accepted.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("File is larger than 10 MB.");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf";
    const folder = releaseRequestId ? `releases/${releaseRequestId}` : depositId;
    const path = `${institutionId}/${folder}/${docType}-${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) {
      setBusy(false);
      setError(uploadError.message);
      return;
    }
    const result = await recordDocument({
      depositId: releaseRequestId ? null : (depositId ?? null),
      releaseRequestId: releaseRequestId ?? null,
      docType,
      path,
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
    });
    if (result?.error) {
      await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
      setError(result.error);
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="rounded-md border border-dashed border-slate-300 bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-52 flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">Document type</span>
          <select
            className="input"
            value={docType}
            onChange={(e) => setDocType(e.target.value as DocumentType)}
            disabled={busy}
          >
            {docTypes.map((t) => (
              <option key={t} value={t}>
                {DOCUMENT_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className={buttonClass("secondary", "md", busy ? "pointer-events-none opacity-60" : "cursor-pointer")}>
          {busy ? (
            <>
              <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
              Uploading…
            </>
          ) : (
            "Choose file & upload"
          )}
          <input
            ref={fileRef}
            type="file"
            className="sr-only"
            accept=".pdf,.jpg,.jpeg,.png"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
        </label>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        PDF, JPG or PNG up to 10 MB. Uploading the same type again keeps the earlier file as a previous version.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
