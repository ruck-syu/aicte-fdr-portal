"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ALLOWED_MIME_TYPES, DOCUMENTS_BUCKET, MAX_UPLOAD_BYTES } from "@/lib/env";
import { formatBytes } from "@/lib/format";
import { DOCUMENT_LABELS } from "@/lib/labels";
import type { DocumentType } from "@/lib/types";
import { recordDocument } from "@/app/(portal)/documents/actions";
import { buttonClass } from "./ui";

type ItemStatus = "queued" | "uploading" | "done" | "error";
type Item = { id: string; name: string; size: number; status: ItemStatus; error?: string };

/**
 * Uploads straight from the browser to Supabase Storage (bypassing Vercel's
 * request-size limit; storage RLS restricts the folder), then records each
 * file through a server action. Files are sent one at a time so version numbers
 * for a document type stay ordered.
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
  const [items, setItems] = useState<Item[]>([]);
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

  async function addFiles(files: File[]) {
    if (busy || files.length === 0) return;
    const type = docType;
    const queued: { file: File; id: string }[] = [];
    const rejected: Item[] = [];
    for (const file of files) {
      const id = crypto.randomUUID();
      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        rejected.push({ id, name: file.name, size: file.size, status: "error", error: "Not a PDF, JPG or PNG" });
      } else if (file.size > MAX_UPLOAD_BYTES) {
        rejected.push({ id, name: file.name, size: file.size, status: "error", error: "Larger than 10 MB" });
      } else {
        queued.push({ file, id });
      }
    }
    if (queued.length === 0) {
      setItems((prev) => [...prev, ...rejected].slice(-12));
      return;
    }

    setItems((prev) =>
      [
        ...prev,
        ...queued.map(({ file, id }) => ({ id, name: file.name, size: file.size, status: "queued" as const })),
        ...rejected,
      ].slice(-12),
    );
    setBusy(true);
    for (const { file, id } of queued) {
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status: "uploading" } : i)));
      const error = await uploadOne(file, type);
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status: error ? "error" : "done", error: error ?? undefined } : i)));
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  const done = items.filter((i) => i.status === "done").length;
  const failed = items.filter((i) => i.status === "error").length;

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
        if (!busy) void addFiles(Array.from(e.dataTransfer.files ?? []));
      }}
    >
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
            "Choose files & upload"
          )}
          <input
            ref={fileRef}
            type="file"
            multiple
            className="sr-only"
            accept=".pdf,.jpg,.jpeg,.png"
            disabled={busy}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) void addFiles(files);
            }}
          />
        </label>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        PDF, JPG or PNG up to 10 MB each. Drop several files — they upload one after another with the type selected
        above. Uploading the same type again keeps the earlier file as a previous version.
      </p>

      {items.length > 0 && (
        <div className="mt-3 border-t border-slate-200 pt-2.5">
          <ul className="space-y-1.5">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-slate-700" title={item.name}>
                  {item.name}
                </span>
                <span className="num shrink-0 text-slate-400">{formatBytes(item.size)}</span>
                {item.status === "queued" && <span className="shrink-0 text-slate-500">Queued</span>}
                {item.status === "uploading" && <span className="shrink-0 text-brand-700">Uploading…</span>}
                {item.status === "done" && <span className="shrink-0 font-medium text-emerald-700">Uploaded</span>}
                {item.status === "error" && <span className="shrink-0 text-red-700">{item.error}</span>}
              </li>
            ))}
          </ul>
          {!busy && (done > 0 || failed > 0) && (
            <p className="mt-2 text-xs text-slate-500">
              {done} uploaded{failed > 0 ? ` · ${failed} failed` : ""}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
