-- G9 — read-only Auditor role, step 2.
--
-- The spec defines "Auditors / External Reviewers (read-only)" (§3). An
-- auditor reads everything an AICTE verifier can read — deposits, documents,
-- releases, reports, the audit trail — and writes nothing.
--
-- Enforcement is split the same way the rest of the schema is:
--   * can_access_institution() and is_official() include 'auditor', so every
--     read policy (and every scoped view) works unchanged;
--   * is_reviewer() still excludes it, so every workflow function
--     (verify_deposit, record_clearance, decide_release, set_bank_check, ...)
--     refuses an auditor;
--   * the one direct-INSERT policy that used can_access_institution() alone —
--     comments — gains an explicit is_read_only() guard, and storage upload
--     keeps requiring the caller's own institution or reviewer rights.

-------------------------------------------------------------------------------
-- Profiles: the auditor carries no scope, so only the constraint changes.
-------------------------------------------------------------------------------
alter table public.profiles drop constraint profile_scope;
alter table public.profiles
  add constraint profile_scope check (
    role is null
    or (role = 'institute_user' and institution_id is not null)
    or (role = 'regional_officer' and region is not null)
    or (role = 'release_officer' and clearance_cell is not null)
    or role in ('aicte_verifier', 'admin', 'auditor')
  );

-------------------------------------------------------------------------------
-- Scope helpers
-------------------------------------------------------------------------------
create or replace function public.is_read_only()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select role = 'auditor' from public.profiles where id = auth.uid() and is_active),
    false)
$$;

create or replace function public.is_official()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select role in ('regional_officer', 'aicte_verifier', 'admin', 'release_officer', 'auditor')
       from public.profiles where id = auth.uid() and is_active),
    false)
$$;

create or replace function public.can_access_institution(p_institution uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and (
      p.role in ('aicte_verifier', 'admin', 'release_officer', 'auditor')
      or (p.role = 'institute_user' and p.institution_id = p_institution)
      or (p.role = 'regional_officer' and exists (
            select 1 from public.institutions i
            where i.id = p_institution and i.region = p.region))
    )
  )
$$;

-------------------------------------------------------------------------------
-- Read policies that enumerate official roles must learn the new one; write
-- policies are left untouched so the auditor stays out of them.
-------------------------------------------------------------------------------
drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.can_access_institution(institution_id)
    and not public.is_read_only()
  );

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.is_official())
    or institution_id = (select public.my_institution())
    or role in ('regional_officer', 'aicte_verifier', 'admin', 'release_officer', 'auditor')
  );

drop policy if exists release_clearances_select on public.release_clearances;
create policy release_clearances_select on public.release_clearances for select to authenticated
  using (
    public.can_access_institution(institution_id)
    and (select public.my_role()) in ('regional_officer', 'aicte_verifier', 'admin', 'release_officer', 'auditor')
  );

-- Auditing is the role's whole purpose, so it reads the national trail —
-- including the session events that carry no institution.
drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated
  using (
    (select public.my_role()) in ('admin', 'auditor')
    or (institution_id is not null and public.can_access_institution(institution_id))
  );
