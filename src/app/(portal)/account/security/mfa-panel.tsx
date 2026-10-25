"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Badge, Field, buttonClass } from "@/components/ui";

export type FactorSummary = {
  id: string;
  name: string;
  status: "verified" | "unverified";
  createdAt: string;
};

type Enrolment = { factorId: string; qr: string; secret: string };

/** Friendly text for the errors GoTrue returns when MFA is not available. */
function explain(message: string) {
  if (/mfa_totp_enroll_not_enabled|mfa.*not enabled/i.test(message)) {
    return "TOTP is not enabled on this Supabase project. An administrator must turn on Authentication → Multi-Factor Authentication (TOTP) before anyone can enrol.";
  }
  if (/invalid.*code|mfa_verification_failed/i.test(message)) {
    return "That code was not accepted. Codes change every 30 seconds — use the current one.";
  }
  return message;
}

export function MfaPanel({
  factors,
  currentLevel,
  nextLevel,
  required,
  email,
}: {
  factors: FactorSummary[];
  currentLevel: string | null;
  nextLevel: string | null;
  required: boolean;
  email: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const verified = factors.filter((f) => f.status === "verified");
  const unverified = factors.filter((f) => f.status === "unverified");
  const steppedUp = currentLevel === "aal2";
  const pendingFactor = verified[0] ?? null;
  // A verified factor the session has not satisfied yet: ask for the code.
  const needsCode = !steppedUp && pendingFactor !== null;

  async function startEnrolment() {
    setBusy(true);
    setError(null);
    const { data, error: enrolError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Authenticator · ${new Date().toISOString().slice(0, 10)}`,
    });
    setBusy(false);
    if (enrolError) {
      setError(explain(enrolError.message));
      return;
    }
    setEnrolment({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    setCode("");
  }

  async function submitCode(factorId: string) {
    setBusy(true);
    setError(null);
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError) {
      setBusy(false);
      setError(explain(challengeError.message));
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: code.replace(/\s/g, ""),
    });
    setBusy(false);
    if (verifyError) {
      setError(explain(verifyError.message));
      return;
    }
    setEnrolment(null);
    setCode("");
    router.refresh();
  }

  async function removeFactor(factorId: string) {
    if (!window.confirm("Remove this authenticator? The account will sign in with a password only until a new factor is enrolled.")) {
      return;
    }
    setBusy(true);
    setError(null);
    const { error: unenrolError } = await supabase.auth.mfa.unenroll({ factorId });
    setBusy(false);
    if (unenrolError) {
      setError(explain(unenrolError.message));
      return;
    }
    router.refresh();
  }

  if (enrolment) {
    // GoTrue returns the QR as SVG markup, not a data URI.
    const qrSrc = enrolment.qr.startsWith("data:")
      ? enrolment.qr
      : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(enrolment.qr)}`;
    return (
      <div className="space-y-4" data-testid="mfa-enrolment">
        <p className="text-sm text-slate-600">
          Scan this code with your authenticator app, then enter the six digits it shows. The setup is not active until
          the code is verified.
        </p>
        <div className="flex flex-wrap items-start gap-5">
          {/* A data-URI SVG from Supabase; next/image cannot optimise it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrSrc} alt="TOTP QR code" className="size-40 rounded-md border border-slate-200 bg-white p-1" />
          <div className="min-w-0 flex-1 space-y-3">
            <Field label="Manual entry key" hint="Use this when the app cannot scan the code.">
              <code className="block break-all rounded-md bg-slate-100 px-2 py-1.5 text-xs">{enrolment.secret}</code>
            </Field>
            <Field label="Verification code" htmlFor="mfa-code">
              <input
                id="mfa-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                className="input num w-32 tracking-[0.3em]"
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => submitCode(enrolment.factorId)}
                disabled={busy || code.replace(/\s/g, "").length < 6}
                className={buttonClass("primary")}
              >
                {busy ? "Checking…" : "Verify and turn on"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEnrolment(null);
                  setCode("");
                  setError(null);
                  // The unverified factor exists on the server already; refresh
                  // so it shows up with its discard action.
                  router.refresh();
                }}
                className={buttonClass("secondary")}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
        {error && <ErrorLine>{error}</ErrorLine>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {steppedUp && verified.length > 0 ? (
          <Badge tone="green">
            <ShieldCheck className="size-3.5" /> Two-factor active for this session
          </Badge>
        ) : verified.length > 0 ? (
          <Badge tone="amber">
            <KeyRound className="size-3.5" /> Code required
          </Badge>
        ) : (
          <Badge tone="slate">
            <ShieldOff className="size-3.5" /> No second factor
          </Badge>
        )}
        <span className="text-slate-600">{email}</span>
        {nextLevel === "aal2" ? <span className="text-xs text-slate-500">· this account has a factor</span> : null}
      </div>

      {verified.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {verified.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <KeyRound className="size-4 text-slate-400" />
                {f.name}
                <span className="text-xs text-slate-500">since {new Date(f.createdAt).toISOString().slice(0, 10)}</span>
              </span>
              <button
                type="button"
                onClick={() => removeFactor(f.id)}
                disabled={busy}
                className="text-xs text-red-700 hover:underline disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {unverified.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>An unfinished setup is still registered and never verified.</span>
            <button
              type="button"
              onClick={() => removeFactor(unverified[0].id)}
              disabled={busy}
              className="text-xs font-medium underline disabled:opacity-50"
            >
              Discard it
            </button>
          </div>
        </div>
      )}

      {needsCode ? (
        <div className="space-y-2">
          <Field label={`Enter the code from ${pendingFactor.name}`} htmlFor="mfa-step-code">
            <input
              id="mfa-step-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              className="input num w-32 tracking-[0.3em]"
            />
          </Field>
          <button
            type="button"
            onClick={() => submitCode(pendingFactor.id)}
            disabled={busy || code.replace(/\s/g, "").length < 6}
            className={buttonClass("primary")}
          >
            {busy ? "Checking…" : "Verify code"}
          </button>
        </div>
      ) : verified.length === 0 ? (
        <button type="button" onClick={startEnrolment} disabled={busy} className={buttonClass("primary")}>
          {busy ? "Starting…" : "Set up authenticator app"}
        </button>
      ) : null}

      {required && !steppedUp && verified.length === 0 && (
        <p className="text-sm text-amber-800">
          Your role requires a second factor. The portal stays locked until you complete this setup.
        </p>
      )}
      {error && <ErrorLine>{error}</ErrorLine>}
    </div>
  );
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {children}
    </p>
  );
}
