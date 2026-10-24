import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { buttonClass, Card } from "@/components/ui";

/**
 * A record that does not exist (or is outside the signed-in user's scope —
 * row-level security makes those indistinguishable on purpose).
 */
export default function PortalNotFound() {
  return (
    <Card>
      <div className="py-10 text-center">
        <FileQuestion className="mx-auto size-8 text-slate-400" />
        <h1 className="mt-4 text-lg font-semibold tracking-tight text-slate-900">Record not found</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
          This record does not exist, or it is outside your jurisdiction. If a colleague can open it, ask an
          administrator to check your scope.
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
    </Card>
  );
}
