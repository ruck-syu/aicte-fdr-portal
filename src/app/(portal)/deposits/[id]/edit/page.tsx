import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Demand, Deposit } from "@/lib/types";
import { Card, PageHeader } from "@/components/ui";
import { DepositForm } from "../../deposit-form";
import { updateDeposit } from "../../actions";

export const metadata: Metadata = { title: "Edit deposit" };

export default async function EditDepositPage({ params }: PageProps<"/deposits/[id]/edit">) {
  const { id } = await params;
  await requireRole("institute_user");
  const supabase = await createClient();
  const [{ data: deposit }, { data: demands }] = await Promise.all([
    supabase.from("deposits").select("*").eq("id", id).maybeSingle(),
    supabase.from("deposit_demands").select("*").order("due_date"),
  ]);
  if (!deposit) notFound();
  const d = deposit as Deposit;
  if (!["draft", "discrepancy"].includes(d.status)) redirect(`/deposits/${id}`);

  const replaces = d.replaces_deposit_id
    ? ((await supabase.from("deposits").select("id, reference_no, maturity_date").eq("id", d.replaces_deposit_id).maybeSingle())
        .data as Pick<Deposit, "id" | "reference_no" | "maturity_date"> | null)
    : null;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/deposits/${id}`} className="hover:underline">
            {d.reference_no}
          </Link>
        }
        title="Edit deposit details"
      />
      <Card>
        <DepositForm
          action={updateDeposit}
          defaults={d}
          demands={((demands ?? []) as Demand[]).filter((m) => m.status === "open" || m.id === d.demand_id)}
          replaces={replaces}
          submitLabel="Save changes"
          cancelHref={`/deposits/${id}`}
        />
      </Card>
    </>
  );
}
