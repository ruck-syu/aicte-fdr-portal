"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import { buttonClass } from "@/components/ui";
import { logPrintExport } from "@/app/(portal)/print-actions";

/** Print / Save as PDF. The audit row is written first; printing never depends on it. */
export function PrintButton({ summary, label = "Print / Save as PDF" }: { summary: string; label?: string }) {
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      className={buttonClass("secondary", "md")}
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await logPrintExport(summary);
        } catch {
          /* the export is best-effort; the browser dialog must still open */
        } finally {
          setPending(false);
        }
        window.print();
      }}
    >
      <Printer className="size-4" /> {label}
    </button>
  );
}
