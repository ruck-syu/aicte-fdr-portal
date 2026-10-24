import type { Metadata } from "next";
import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { Skeleton } from "@/components/ui";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const DEMO_ACCOUNTS = [
  ["admin@demo.fdr", "Administrator"],
  ["verifier@demo.fdr", "AICTE Verifier (all regions)"],
  ["ro.northern@demo.fdr", "Regional Officer, Northern"],
  ["auditor@demo.fdr", "Auditor (read-only)"],
  ["accounts@alpha.demo.fdr", "Institute (Alpha Institute)"],
  ["accounts@beta.demo.fdr", "Institute (Beta College)"],
];

export default function LoginPage() {
  const demo = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-brand-900 p-12 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, #fff 0 1px, transparent 1px 22px), repeating-linear-gradient(-45deg, #fff 0 1px, transparent 1px 22px)",
          }}
        />
        <div className="relative flex items-center gap-3">
          <Logo className="size-10" />
          <div>
            <div className="text-sm font-semibold tracking-wide">AICTE</div>
            <div className="text-xs text-brand-200">All India Council for Technical Education</div>
          </div>
        </div>
        <div className="relative max-w-lg">
          <h1 className="text-4xl leading-tight font-semibold tracking-tight">Security Deposit &amp; FDR Management Portal</h1>
          <p className="mt-4 text-brand-100">
            One record for every deposit an institution furnishes, from first submission through verification,
            maturity alerts and renewal to release.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-brand-100">
            {[
              "Submit FDRs with scanned instruments and affidavits",
              "Automatic discrepancy checks against approval terms",
              "60/30/7-day maturity reminders and escalation",
              "Full audit trail of every action",
            ].map((t) => (
              <li key={t} className="flex gap-2.5">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-saffron-500" />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-brand-300">Authorised users only. All access is logged.</p>
      </div>

      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Logo />
            <div className="text-sm font-semibold">AICTE FDR Portal</div>
          </div>
          <h2 className="text-xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 mb-6 text-sm text-slate-600">
            Use the credentials issued by your AICTE administrator.
          </p>
          <Suspense fallback={<Skeleton className="h-52" />}>
            <LoginForm />
          </Suspense>
          {demo && (
            <div className="mt-8 rounded-md border border-slate-200 bg-white p-4 text-xs text-slate-600">
              <div className="mb-2 font-medium text-slate-800">Demo accounts (password: Demo@12345)</div>
              <ul className="space-y-1">
                {DEMO_ACCOUNTS.map(([email, label]) => (
                  <li key={email} className="flex justify-between gap-3">
                    <code className="text-slate-800">{email}</code>
                    <span className="text-right">{label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
