import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { buttonClass } from "@/components/ui";
import { Logo } from "@/components/logo";

/**
 * Unknown URL. Rendered outside the portal shell because an unmatched path is
 * not necessarily signed in; the links still take a signed-in user home.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <div className="mb-6 flex items-center justify-center gap-2">
          <Logo />
          <span className="text-sm font-semibold text-slate-800">AICTE FDR Portal</span>
        </div>
        <FileQuestion className="mx-auto size-8 text-slate-400" />
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">Page not found</h1>
        <p className="mt-2 text-sm text-slate-600">
          That address does not exist in the portal. A deposit or release reference may have been mistyped.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Link href="/dashboard" className={buttonClass("primary")}>
            Go to dashboard
          </Link>
          <Link href="/search" className={buttonClass("secondary")}>
            Search the register
          </Link>
        </div>
      </div>
    </div>
  );
}
