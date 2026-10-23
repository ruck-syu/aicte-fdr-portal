import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { CLEARANCE_CELL_LABELS, REGION_LABELS, ROLE_LABELS } from "@/lib/labels";
import { pageRange, param, searchTerm } from "@/lib/query";
import type { AppRole, Institution, Profile } from "@/lib/types";
import { Badge, Card, EmptyState, Field, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { FilterBar, FilterSelect, Pagination } from "@/components/list-controls";
import { createUser, updateUser } from "../actions";
import { ScopeFields } from "./scope-fields";

export const metadata: Metadata = { title: "Users" };

type Row = Profile & { institution: Pick<Institution, "name" | "aicte_id"> | null };

export default async function UsersPage({ searchParams }: PageProps<"/admin/users">) {
  const params = await searchParams;
  const me = await requireRole("admin");
  const supabase = await createClient();

  const q = searchTerm(params.q);
  const role = param(params.role);
  const { page, from, to } = pageRange(params.page);

  let query = supabase
    .from("profiles")
    .select("*, institution:institutions(name, aicte_id)", { count: "exact" });
  if (q) query = query.or(`email.ilike.*${q}*,full_name.ilike.*${q}*`);
  if (role === "pending") query = query.is("role", null);
  else if (role === "inactive") query = query.eq("is_active", false);
  else if (role in ROLE_LABELS) query = query.eq("role", role as AppRole);

  const [{ data, count }, { data: instData }] = await Promise.all([
    query.order("created_at", { ascending: false }).range(from, to),
    supabase.from("institutions").select("id, name, aicte_id").order("name").limit(5000),
  ]);
  const users = (data ?? []) as Row[];
  const institutions = (instData ?? []) as Pick<Institution, "id" | "name" | "aicte_id">[];

  return (
    <>
      <PageHeader
        title="Users"
        description="Create accounts and assign roles. Institute users only see their own institution; Regional Officers see their region; Verifiers and Administrators see everything."
      />

      <details className="mb-6 rounded-lg border border-slate-200 bg-white shadow-xs">
        <summary className="cursor-pointer px-5 py-3.5 text-sm font-semibold text-brand-800 select-none">+ Create user</summary>
        <ActionForm action={createUser} resetOnSuccess className="border-t border-slate-100 p-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Email" required htmlFor="new-email">
              <input id="new-email" name="email" type="email" required className="input" autoComplete="off" />
            </Field>
            <Field label="Temporary password" required htmlFor="new-password" hint="At least 10 characters">
              <input id="new-password" name="password" type="password" required minLength={10} className="input" autoComplete="new-password" />
            </Field>
            <Field label="Full name" htmlFor="new-name">
              <input id="new-name" name="full_name" className="input" />
            </Field>
            <Field label="Designation" htmlFor="new-designation">
              <input id="new-designation" name="designation" className="input" placeholder="e.g. Accounts Officer" />
            </Field>
            <ScopeFields idPrefix="new" institutions={institutions} />
          </div>
          <div className="mt-4">
            <SubmitButton>Create account</SubmitButton>
          </div>
        </ActionForm>
      </details>

      <FilterBar action="/admin/users" q={q} placeholder="Search name or email…" resetHref="/admin/users">
        <FilterSelect
          name="role"
          label="Role"
          value={role}
          options={[...Object.entries(ROLE_LABELS), ["pending", "Awaiting role"], ["inactive", "Deactivated"]]}
        />
      </FilterBar>

      <Card bodyClassName="p-0">
        {users.length === 0 ? (
          <EmptyState title="No users found" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {users.map((u) => (
              <li key={u.id}>
                <details className="group">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-slate-50">
                    <div className="min-w-56 flex-1">
                      <div className="text-sm font-medium text-slate-900">
                        {u.full_name || u.email}
                        {u.id === me.id && <span className="ml-1.5 text-xs font-normal text-slate-500">(you)</span>}
                      </div>
                      <div className="text-xs text-slate-500">
                        {u.email}
                        {u.designation && ` · ${u.designation}`}
                      </div>
                    </div>
                    <div className="text-sm text-slate-600">
                      {u.role === "institute_user"
                        ? u.institution?.name
                        : u.role === "regional_officer" && u.region
                          ? REGION_LABELS[u.region]
                          : u.role === "release_officer" && u.clearance_cell
                            ? `${CLEARANCE_CELL_LABELS[u.clearance_cell]} cell`
                            : u.role
                              ? "All regions"
                              : ""}
                    </div>
                    {u.role ? <Badge tone="blue">{ROLE_LABELS[u.role]}</Badge> : <Badge tone="amber">Awaiting role</Badge>}
                    {!u.is_active && <Badge tone="red">Deactivated</Badge>}
                    <span className="text-xs text-slate-400">Joined {formatDate(u.created_at)}</span>
                  </summary>
                  <ActionForm action={updateUser} className="border-t border-slate-100 bg-slate-50/60 px-5 py-4">
                    <input type="hidden" name="id" value={u.id} />
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <Field label="Full name" htmlFor={`${u.id}-name`}>
                        <input id={`${u.id}-name`} name="full_name" defaultValue={u.full_name ?? ""} className="input" />
                      </Field>
                      <Field label="Designation" htmlFor={`${u.id}-designation`}>
                        <input id={`${u.id}-designation`} name="designation" defaultValue={u.designation ?? ""} className="input" />
                      </Field>
                      <ScopeFields idPrefix={u.id} institutions={institutions} defaults={u} />
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-4">
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" name="is_active" defaultChecked={u.is_active} className="size-4 rounded border-slate-300" />
                        Account active
                      </label>
                      <SubmitButton size="sm">Save changes</SubmitButton>
                    </div>
                  </ActionForm>
                </details>
              </li>
            ))}
          </ul>
        )}
        <Pagination basePath="/admin/users" params={params} page={page} total={count ?? 0} />
      </Card>
    </>
  );
}
