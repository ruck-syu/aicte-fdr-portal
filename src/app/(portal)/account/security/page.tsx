import type { Metadata } from "next";
import { requireUser, isOfficial } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui";
import { MfaPanel, type FactorSummary } from "./mfa-panel";

export const metadata: Metadata = { title: "Sign-in security" };

export default async function SecurityPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [{ data: aal }, { data: factors }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);

  const summary = (factors?.all ?? []).map<FactorSummary>((f) => ({
    id: f.id,
    name: f.friendly_name ?? "Authenticator app",
    status: f.status === "verified" ? "verified" : "unverified",
    createdAt: f.created_at,
  }));
  const required = process.env.REQUIRE_MFA === "true" && isOfficial(user.role);

  return (
    <>
      <PageHeader
        title="Sign-in security"
        description="A time-based one-time password (TOTP) from an authenticator app — Google Authenticator, Authy, 1Password, Microsoft Authenticator — is the second factor for this account."
      />
      <Card title="Authenticator app" description={required ? "Required for your role on this portal." : "Optional, but recommended for officials."}>
        <MfaPanel
          factors={summary}
          currentLevel={aal?.currentLevel ?? null}
          nextLevel={aal?.nextLevel ?? null}
          required={required}
          email={user.email}
        />
      </Card>

      <Card className="mt-6" title="What this protects" description="How the portal treats a second factor">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-600">
          <li>
            With <code className="rounded bg-slate-100 px-1">REQUIRE_MFA=true</code>, an official&apos;s session must
            reach <code className="rounded bg-slate-100 px-1">aal2</code> — a verified factor, stepped up with a code —
            before the portal loads any screen. The check runs on every request against the token&apos;s assurance level,
            not just at sign-in. With the flag off, a factor is optional and old sessions keep working.
          </li>
          <li>
            When <code className="rounded bg-slate-100 px-1">REQUIRE_MFA=true</code>, officials (regional officers,
            AICTE verifiers, clearance officers, auditors and administrators) are sent here until they enrol. Institute
            accounts are unaffected.
          </li>
          <li>
            Losing the device is an operator task: an administrator removes the factor in Supabase under{" "}
            <strong>Authentication → Users</strong>, after which the account signs in with its password and enrols
            again. Recovery codes are a paid Supabase feature and are not relied on here.
          </li>
        </ul>
      </Card>
    </>
  );
}
