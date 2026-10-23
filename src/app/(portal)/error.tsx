"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";
import { buttonClass } from "@/components/ui";

/**
 * Route error boundary for the portal. Database or network failures land here
 * instead of a blank screen; the digest is shown so the user can quote it to
 * support, and nothing about the failure is silently swallowed.
 */
export default function PortalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <AlertTriangle className="mx-auto size-8 text-amber-600" />
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">This page could not be loaded</h1>
      <p className="mt-2 text-sm text-slate-600">
        The portal could not read the data behind this page. This is usually a temporary connection or permission
        problem — your data has not been changed.
      </p>
      {error.digest && (
        <p className="num mt-3 text-xs text-slate-500">
          Reference: <span className="font-medium text-slate-700">{error.digest}</span>
        </p>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <button onClick={reset} className={buttonClass("primary")}>
          <RotateCw className="size-4" /> Try again
        </button>
        <Link href="/dashboard" className={buttonClass("secondary")}>
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
