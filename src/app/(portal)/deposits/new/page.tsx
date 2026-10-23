import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { param } from "@/lib/query";
import type { Demand, Deposit } from "@/lib/types";
import { Alert, Card, PageHeader } from "@/components/ui";
import { DepositForm } from "../deposit-form";
import { createDeposit } from "../actions";

export const metadata: Metadata = { title: "Register deposit" };

export default async function NewDepositPage({ searchParams }: PageProps<"/deposits/new">) {
  const params = await searchParams;
  await requireRole("institute_user");
  const supabase = await createClient();

  const renewsId = param(params.renews);
  const demandId = param(params.demand);

  const [{ data: demands }, renewsRes] = await Promise.all([
    supabase.from("deposit_demands").select("*").eq("status", "open").order("due_date"),
    renewsId
      ? supabase.from("deposits").select("*").eq("id", renewsId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const renews = renewsRes.data as Deposit | null;

  const defaults: Partial<Deposit> = renews
    ? {
        instrument_type: renews.instrument_type,
        bank_name: renews.bank_name,
        bank_branch: renews.bank_branch,
        ifsc: renews.ifsc,
        amount: renews.amount,
        auto_renewal: renews.auto_renewal,
        issue_date: renews.maturity_date,
        approval_case_id: renews.approval_case_id,
        program: renews.program,
        approval_valid_until: renews.approval_valid_until,
        required_amount: renews.required_amount,
        demand_id: renews.demand_id,
      }
    : { demand_id: demandId || null };

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/deposits" className="hover:underline">
            Deposits
          </Link>
        }
        title={renews ? `Renew ${renews.reference_no}` : "Register a security deposit"}
        description="Enter the instrument exactly as printed. Dates and amounts are checked against the approval before submission."
      />
      {renewsId && !renews && <Alert tone="red">The deposit to renew was not found.</Alert>}
      {renews && !["verified", "release_requested"].includes(renews.status) && (
        <div className="mb-4">
          <Alert tone="amber">Only verified deposits can be renewed. Saving will fail for this deposit.</Alert>
        </div>
      )}
      <Card>
        <DepositForm
          action={createDeposit}
          defaults={defaults}
          demands={(demands ?? []) as Demand[]}
          replaces={renews}
          submitLabel="Save draft"
          cancelHref={renews ? `/deposits/${renews.id}` : "/deposits"}
        />
      </Card>
    </>
  );
}
