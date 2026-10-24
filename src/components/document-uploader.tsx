"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ALLOWED_MIME_TYPES, DOCUMENTS_BUCKET, MAX_UPLOAD_BYTES } from "@/lib/env";
import { formatBytes } from "@/lib/format";
import { DOCUMENT_LABELS } from "@/lib/labels";
import type { DocumentType } from "@/lib/types";
import { recordDocument } from "@/app/(portal)/documents/actions";
import { buttonClass } from "./ui";

type RowStatus = "staged" | "uploading" | "done" | "error" | "rejected";
type Row = { id: string; file: File; name: string; size: number; type: DocumentType; status: RowStatus; error?: string };

/**
 * Uploads straight from the browser to Supabase Storage (bypassing Vercel's
 * request-size limit; storage RLS restricts the folder), then records each
 * file through a server action. Files are sent one at a time so version numbers
 * for a document type stay ordered.
 *
 * Files are staged first, so one drop can carry a mixed batch: each row keeps
 * its own document type and can be retried after a failure without resending
 * the rest.
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
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function uploadOne(file: File, type: DocumentType): Promise<string | null> {
    const supabase = createClient();
    const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf";
    const folder = releaseRequestId ? `releases/${releaseRequestId}` : depositId;
    const path = `${institutionId}/${folder}/${type}-${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) return uploadError.message;

    const result = await recordDocument({
      depositId: releaseRequestId ? null : (depositId ?? null),
      releaseRequestId: releaseRequestId ?? null,
      docType: type,
      path,
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
    });
    if (result?.error) {
      await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
      return result.error;
    }
    return null;
  }

  function addFiles(files: File[]) {
    if (busy || files.length === 0) return;
    const added = files.map((file) => {
      const rejection = !ALLOWED_MIME_TYPES.includes(file.type)
        ? "Not a PDF, JPG or PNG"
        : file.size > MAX_UPLOAD_BYTES
          ? "Larger than 10 MB"
          : null;
      return {
        id: crypto.randomUUID(),
        file,
        name: file.name,
        size: file.size,
        type: docType,
        status: rejection ? ("rejected" as const) : ("staged" as const),
        error: rejection ?? undefined,
      };
    });
    setRows((prev) => [...prev, ...added].slice(-12));
    if (fileRef.current) fileRef.current.value = "";
  }

  function patch(id: string, change: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...change } : r)));
  }

  async function upload() {
    if (busy) return;
    const queue = rows.filter((r) => r.status === "staged" || r.status === "error");
    if (queue.length === 0) return;
    setBusy(true);
    for (const row of queue) {
      patch(row.id, { status: "uploading", error: undefined });
      const error = await uploadOne(row.file, row.type);
      patch(row.id, { status: error ? "error" : "done", error: error ?? undefined });
    }
    setBusy(false);
  }

  const pending = rows.filter((r) => r.status === "staged" || r.status === "error").length;
  const done = rows.filter((r) => r.status === "done").length;
  const failed = rows.filter((r) => r.status === "error").length;

  return (
    <div
      className={`rounded-md border border-dashed p-4 transition-colors ${
        dragging ? "border-brand-500 bg-brand-50/60" : "border-slate-300 bg-slate-50/60"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!busy) addFiles(Array.from(e.dataTransfer.files ?? []));
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-52 flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">Document type for new files</span>
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
          Add files
          <input
            ref={fileRef}
            type="file"
            multiple
            className="sr-only"
            accept=".pdf,.jpg,.jpeg,.png"
            disabled={busy}
            onChange={(e) => addFiles(Array.from(e.target.files ?? []))}
          />
        </label>
        {pending > 0 && (
          <button type="button" className={buttonClass("primary", "md")} disabled={busy} onClick={() => void upload()}>
            {busy ? (
              <>
                <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
                Uploading…
              </>
            ) : (
              `Upload ${pending} file${pending === 1 ? "" : "s"}`
            )}
          </button>
        )}
      </div>

      <p className="mt-2 text-xs text-slate-500">
        PDF, JPG or PNG up to 10 MB each. Drop several files at once — each row keeps its own type, so one batch can mix
        an FDR scan with an affidavit. Uploading the same type again keeps the earlier file as a previous version.
      </p>

      {rows.length > 0 && (
        <div className="mt-3 border-t border-slate-200 pt-2.5">
          <ul className="space-y-1.5">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-slate-700" title={row.name}>
                  {row.name}
                </span>
                <span className="num shrink-0 text-slate-400">{formatBytes(row.size)}</span>
                {row.status === "staged" || row.status === "error" || row.status === "rejected" ? (
                  <select
                    aria-label={`Document type for ${row.name}`}
                    className="shrink-0 rounded border border-slate-300 bg-white px-1 py-0.5 text-xs text-slate-700"
                    value={row.type}
                    disabled={busy || row.status === "rejected"}
                    onChange={(e) => patch(row.id, { type: e.target.value as DocumentType })}
                  >
                    {docTypes.map((t) => (
                      <option key={t} value={t}>
                        {DOCUMENT_LABELS[t]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="shrink-0 text-slate-500">{DOCUMENT_LABELS[row.type]}</span>
                )}
                {row.status === "uploading" && <span className="shrink-0 text-brand-700">Uploading…</span>}
                {row.status === "done" && <span className="shrink-0 font-medium text-emerald-700">Uploaded</span>}
                {(row.status === "error" || row.status === "rejected") && row.error && (
                  <span className="shrink-0 text-red-700">{row.error}</span>
                )}
                {row.status !== "uploading" && row.status !== "done" && !busy && (
                  <button
                    type="button"
                    aria-label={`Remove ${row.name}`}
                    className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                    onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!busy && (done > 0 || (failed > 0 && pending > 0)) && (
            <p className="mt-2 text-xs text-slate-500">
              {done} uploaded{failed > 0 ? ` · ${failed} failed — select a type and upload again to retry` : ""}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
