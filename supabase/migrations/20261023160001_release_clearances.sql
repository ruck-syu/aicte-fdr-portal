-- G1 — release clearance workflow (Grievance / Vigilance / PGRC) + NOC record.
--
-- A release is no longer a single officer's decision. Every submitted release
-- request carries three clearance cells; each cell signs off (cleared/blocked)
-- through record_clearance(), and decide_release() refuses to approve until
-- all three have decided. A block can only be overridden by an administrator
-- with a recorded note. Approval also records the NOC reference issued by the
-- cell, so the compliance trail is complete.
--
-- Role model: release_officer is a central role scoped to one clearance cell.
-- It can read across institutions (it must see the release and its deposit) but
-- is neither is_reviewer() nor an administrator, so it cannot decide releases
-- or touch deposits.

-------------------------------------------------------------------------------
-- Types
-------------------------------------------------------------------------------
create type public.clearance_cell as enum ('grievance', 'vigilance', 'pgrc');
create type public.clearance_status as enum ('pending', 'cleared', 'blocked');

-------------------------------------------------------------------------------
-- Profiles: a release officer belongs to exactly one cell.
-------------------------------------------------------------------------------
alter table public.profiles add column clearance_cell public.clearance_cell;

alter table public.profiles drop constraint profile_scope;
alter table public.profiles
  add constraint profile_scope check (
    role is null
    or (role = 'institute_user' and institution_id is not null)
    or (role = 'regional_officer' and region is not null)
    or (role = 'release_officer' and clearance_cell is not null)
    or role in ('aicte_verifier', 'admin')
  );

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, designation, role, institution_id, region, clearance_cell)
  values (
    new.id,
    new.email,
    coalesce(new.raw_app_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'full_name'),
    new.raw_app_meta_data ->> 'designation',
    (new.raw_app_meta_data ->> 'role')::public.app_role,
    public.try_uuid(new.raw_app_meta_data ->> 'institution_id'),
    (new.raw_app_meta_data ->> 'region')::public.aicte_region,
    (new.raw_app_meta_data ->> 'clearance_cell')::public.clearance_cell
  );
  return new;
end $$;

-- Keep the app_metadata mirror in sync for the new scope column too.
create or replace function public.sync_profile_from_app_metadata()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles p
     set full_name = case
           when new.raw_app_meta_data ? 'full_name'
             then coalesce(new.raw_app_meta_data ->> 'full_name',
                           new.raw_user_meta_data ->> 'full_name',
                           p.full_name)
           else p.full_name end,
         designation = case
           when new.raw_app_meta_data ? 'designation'
             then new.raw_app_meta_data ->> 'designation'
           else p.designation end,
         role = case
           when new.raw_app_meta_data ? 'role'
             then (new.raw_app_meta_data ->> 'role')::public.app_role
           else p.role end,
         institution_id = case
           when new.raw_app_meta_data ? 'institution_id'
             then public.try_uuid(new.raw_app_meta_data ->> 'institution_id')
           else p.institution_id end,
         region = case
           when new.raw_app_meta_data ? 'region'
             then (new.raw_app_meta_data ->> 'region')::public.aicte_region
           else p.region end,
         clearance_cell = case
           when new.raw_app_meta_data ? 'clearance_cell'
             then (new.raw_app_meta_data ->> 'clearance_cell')::public.clearance_cell
           else p.clearance_cell end
   where p.id = new.id;
  return new;
end $$;

-------------------------------------------------------------------------------
-- Release requests: the NOC issued on approval.
-------------------------------------------------------------------------------
alter table public.release_requests add column noc_reference text;

-------------------------------------------------------------------------------
-- Clearance checklist
-------------------------------------------------------------------------------
create table public.release_clearances (
  id                 uuid primary key default gen_random_uuid(),
  release_request_id uuid not null references public.release_requests (id) on delete cascade,
  institution_id     uuid not null references public.institutions (id) on delete cascade,
  cell               public.clearance_cell not null,
  status             public.clearance_status not null default 'pending',
  note               text,
  decided_by         uuid references public.profiles (id) on delete set null,
  decided_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (release_request_id, cell)
);
create index release_clearances_release_idx on public.release_clearances (release_request_id);
create index release_clearances_pending_idx
  on public.release_clearances (cell, created_at) where status = 'pending';

create trigger release_clearances_updated before update on public.release_clearances
  for each row execute function public.set_updated_at();
create trigger audit_release_clearances after insert or update or delete on public.release_clearances
  for each row execute function public.audit_row();

-------------------------------------------------------------------------------
-- Helpers
-------------------------------------------------------------------------------
-- Idempotent: every release has exactly one row per cell, including releases
-- created before this migration existed.
create or replace function public.ensure_release_clearances(p_release uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.release_requests;
  c public.clearance_cell;
begin
  select * into r from public.release_requests where id = p_release;
  if r.id is null then
    return;
  end if;
  foreach c in array array['grievance', 'vigilance', 'pgrc']::public.clearance_cell[] loop
    insert into public.release_clearances (release_request_id, institution_id, cell)
    values (r.id, r.institution_id, c)
    on conflict (release_request_id, cell) do nothing;
  end loop;
end $$;

-- What an institution may see: cell + status, never the internal note.
create or replace function public.release_clearance_summary(p_release uuid)
returns table (cell public.clearance_cell, status public.clearance_status, decided_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.cell, c.status, c.decided_at
  from public.release_clearances c
  join public.release_requests r on r.id = c.release_request_id
  where c.release_request_id = p_release
    and public.can_access_institution(r.institution_id)
  order by c.cell
$$;

-------------------------------------------------------------------------------
-- record_clearance: one cell signs off on one release.
-------------------------------------------------------------------------------
create or replace function public.record_clearance(
  p_id uuid,
  p_cell public.clearance_cell,
  p_status public.clearance_status,
  p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r      public.release_requests;
  me     public.profiles;
  v_note text := nullif(trim(p_note), '');
begin
  select * into me from public.profiles where id = auth.uid() and is_active;
  if me.id is null or me.role not in ('release_officer', 'admin') then
    raise exception 'Only a clearance cell officer can sign off';
  end if;
  if me.role = 'release_officer' and me.clearance_cell is distinct from p_cell then
    raise exception 'You can only sign off % clearances', me.clearance_cell;
  end if;
  if p_status not in ('cleared', 'blocked') then
    raise exception 'A clearance must be cleared or blocked';
  end if;
  if p_status = 'blocked' and v_note is null then
    raise exception 'A note explaining the block is required';
  end if;

  select * into r from public.release_requests where id = p_id for update;
  if r.id is null then
    raise exception 'Release request not found';
  end if;
  if r.status <> 'submitted' then
    raise exception 'Clearances can only be recorded while the request is under review (current status: %)', r.status;
  end if;

  perform public.ensure_release_clearances(r.id);
  if v_note is not null then
    perform set_config('app.audit_note', left(v_note, 500), true);
  end if;
  update public.release_clearances
     set status = p_status,
         note = v_note,
         decided_by = auth.uid(),
         decided_at = now()
   where release_request_id = r.id and cell = p_cell;
end $$;

-------------------------------------------------------------------------------
-- Release requests now seed their checklist.
-------------------------------------------------------------------------------
create or replace function public.create_release_request(
  p_deposit uuid, p_reason public.release_reason, p_details text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  d public.deposits;
  v_id uuid;
begin
  select * into d from public.deposits where id = p_deposit;
  if d.id is null or public.my_role() <> 'institute_user'
     or d.institution_id is distinct from public.my_institution() then
    raise exception 'Deposit not found';
  end if;
  if d.status <> 'verified' then
    raise exception 'Release can only be requested for verified deposits (current status: %)', d.status;
  end if;
  select id into v_id from public.release_requests
   where deposit_id = d.id and status = 'draft';
  if v_id is not null then
    update public.release_requests set reason = p_reason, details = nullif(trim(p_details), '')
     where id = v_id;
    perform public.ensure_release_clearances(v_id);
    return v_id;
  end if;
  insert into public.release_requests (deposit_id, institution_id, reason, details, requested_by)
  values (d.id, d.institution_id, p_reason, nullif(trim(p_details), ''), auth.uid())
  returning id into v_id;
  perform public.ensure_release_clearances(v_id);
  return v_id;
end $$;

create or replace function public.submit_release_request(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.release_requests;
  t public.document_type;
  v_missing text[] := '{}';
begin
  select * into r from public.release_requests where id = p_id for update;
  if r.id is null or public.my_role() <> 'institute_user'
     or r.institution_id is distinct from public.my_institution() then
    raise exception 'Release request not found';
  end if;
  if r.status <> 'draft' then
    raise exception 'Release request already %', r.status;
  end if;
  foreach t in array (select release_required_documents from public.app_settings where id) loop
    if not exists (select 1 from public.deposit_documents doc
                   where doc.release_request_id = r.id and doc.doc_type = t and doc.is_current) then
      v_missing := v_missing || replace(t::text, '_', ' ');
    end if;
  end loop;
  if array_length(v_missing, 1) > 0 then
    raise exception 'Cannot submit: required document(s) missing: %', array_to_string(v_missing, ', ');
  end if;
  update public.release_requests set status = 'submitted', submitted_at = now() where id = r.id;
  update public.deposits set status = 'release_requested'
   where id = r.deposit_id and status = 'verified';
  if not found then
    raise exception 'Deposit is no longer eligible for release';
  end if;
  perform public.ensure_release_clearances(r.id);
end $$;

-------------------------------------------------------------------------------
-- decide_release now runs after the checklist and records the NOC.
-- The old 3-argument overload is dropped so PostgREST never has to guess
-- between two candidates for the same named arguments.
-------------------------------------------------------------------------------
drop function if exists public.decide_release(uuid, text, text);

create or replace function public.decide_release(
  p_id uuid,
  p_decision text,
  p_note text default null,
  p_noc_reference text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r         public.release_requests;
  v_note    text := nullif(trim(p_note), '');
  v_noc     text := nullif(trim(p_noc_reference), '');
  v_quote   jsonb;
  v_cleared int;
  v_blocked int;
  v_decided int;
begin
  select * into r from public.release_requests where id = p_id for update;
  if r.id is null or not public.is_reviewer(r.institution_id) then
    raise exception 'Release request not found';
  end if;
  if r.status <> 'submitted' then
    raise exception 'Only submitted release requests can be decided (current status: %)', r.status;
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'Unknown decision %', p_decision;
  end if;
  if p_decision = 'reject' and v_note is null then
    raise exception 'A note explaining the rejection is required';
  end if;

  perform public.ensure_release_clearances(r.id);
  select count(*) filter (where status = 'cleared'),
         count(*) filter (where status = 'blocked'),
         count(*) filter (where status <> 'pending')
    into v_cleared, v_blocked, v_decided
    from public.release_clearances
   where release_request_id = r.id;

  if p_decision = 'approve' then
    if v_blocked > 0 then
      if public.my_role() is distinct from 'admin' then
        raise exception 'This release is blocked by a clearance cell and cannot be approved';
      end if;
      if v_note is null then
        raise exception 'An administrator overriding a blocked clearance must record a note';
      end if;
    end if;
    -- An override covers a blocked cell, never a cell that has not decided.
    if v_decided < 3 then
      raise exception 'Release cannot be approved until Grievance, Vigilance and PGRC have signed off (% of 3 decided)', v_decided;
    end if;
    if v_noc is null then
      raise exception 'A NOC reference is required to approve a release';
    end if;
    v_quote := public.release_quote(r.deposit_id);
  end if;

  if v_note is not null then
    perform set_config('app.audit_note', left(v_note, 500), true);
  end if;

  update public.release_requests
     set status = case p_decision when 'approve' then 'approved' else 'rejected' end::public.release_status,
         decided_by = auth.uid(),
         decided_at = now(),
         decision_note = v_note,
         noc_reference = case when p_decision = 'approve' then v_noc end,
         quote = case when p_decision = 'approve' then v_quote end,
         sanctioned_amount = case when p_decision = 'approve' then (v_quote ->> 'net_payable')::numeric end,
         sanctioned_by = case when p_decision = 'approve' then auth.uid() end,
         sanctioned_at = case when p_decision = 'approve' then now() end
   where id = r.id;

  if p_decision = 'approve' then
    update public.deposits set status = 'released', released_at = now()
     where id = r.deposit_id and status = 'release_requested';
  else
    update public.deposits set status = 'verified'
     where id = r.deposit_id and status = 'release_requested';
  end if;

  if v_note is not null then
    insert into public.comments (release_request_id, deposit_id, institution_id, author_id, body)
    values (r.id, r.deposit_id, r.institution_id, auth.uid(),
            '[' || initcap(p_decision) || '] ' || v_note);
  end if;
end $$;

-------------------------------------------------------------------------------
-- Admin user management learns the new scope column.
-------------------------------------------------------------------------------
drop function if exists public.admin_update_profile(uuid, public.app_role, uuid, public.aicte_region, text, text, boolean);

create or replace function public.admin_update_profile(
  p_id uuid,
  p_role public.app_role,
  p_institution uuid,
  p_region public.aicte_region,
  p_full_name text,
  p_designation text,
  p_active boolean,
  p_clearance_cell public.clearance_cell default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() is distinct from 'admin' then
    raise exception 'Only administrators can manage users';
  end if;
  if p_id = auth.uid() and (p_role is distinct from 'admin' or not p_active) then
    raise exception 'You cannot remove your own administrator access';
  end if;
  update public.profiles set
    role = p_role,
    institution_id = case when p_role = 'institute_user' then p_institution end,
    region = case when p_role = 'regional_officer' then p_region end,
    clearance_cell = case when p_role = 'release_officer' then p_clearance_cell end,
    full_name = nullif(trim(p_full_name), ''),
    designation = nullif(trim(p_designation), ''),
    is_active = p_active
  where id = p_id;
  if not found then
    raise exception 'User not found';
  end if;
end $$;

-------------------------------------------------------------------------------
-- Scope helpers: a release officer reads across institutions but never writes.
-------------------------------------------------------------------------------
create or replace function public.is_official()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select role in ('regional_officer', 'aicte_verifier', 'admin', 'release_officer')
       from public.profiles where id = auth.uid() and is_active),
    false)
$$;

create or replace function public.can_access_institution(p_institution uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and (
      p.role in ('aicte_verifier', 'admin', 'release_officer')
      or (p.role = 'institute_user' and p.institution_id = p_institution)
      or (p.role = 'regional_officer' and exists (
            select 1 from public.institutions i
            where i.id = p_institution and i.region = p.region))
    )
  )
$$;

-------------------------------------------------------------------------------
-- RLS: clearance rows are visible to officials; institutions use the summary
-- function so internal notes stay internal.
-------------------------------------------------------------------------------
alter table public.release_clearances enable row level security;
create policy release_clearances_select on public.release_clearances for select to authenticated
  using (
    public.can_access_institution(institution_id)
    and (select public.my_role()) in ('regional_officer', 'aicte_verifier', 'admin', 'release_officer')
  );
revoke insert, update, delete, truncate on public.release_clearances from authenticated, anon;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.is_official())
    or institution_id = (select public.my_institution())
    or role in ('regional_officer', 'aicte_verifier', 'admin', 'release_officer')
  );

-------------------------------------------------------------------------------
-- release_overview exposes the NOC reference (appended, so CREATE OR REPLACE
-- stays valid).
-------------------------------------------------------------------------------
create or replace view public.release_overview with (security_invoker = true) as
select
  r.id,
  r.reference_no,
  r.deposit_id,
  r.institution_id,
  r.reason,
  r.details,
  r.status,
  r.requested_by,
  r.submitted_at,
  r.decided_by,
  r.decided_at,
  r.decision_note,
  r.created_at,
  r.updated_at,
  d.reference_no      as deposit_reference_no,
  d.instrument_number,
  d.bank_name,
  d.amount,
  d.maturity_date,
  i.name              as institution_name,
  i.aicte_id          as institution_aicte_id,
  i.region,
  r.quote,
  r.sanctioned_amount,
  r.sanctioned_by,
  r.sanctioned_at,
  r.noc_reference
from public.release_requests r
join public.deposits d on d.id = r.deposit_id
join public.institutions i on i.id = r.institution_id;

grant select on public.release_overview to authenticated, service_role;

-------------------------------------------------------------------------------
-- Backfill checklists for releases that predate the workflow.
-------------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select id from public.release_requests loop
    perform public.ensure_release_clearances(r.id);
  end loop;
end $$;

-------------------------------------------------------------------------------
-- Privileges: helpers are internal; workflow functions are for signed-in users.
-------------------------------------------------------------------------------
revoke execute on function public.ensure_release_clearances(uuid) from public, anon, authenticated;
grant execute on function public.ensure_release_clearances(uuid) to service_role;

revoke execute on function public.release_clearance_summary(uuid) from public, anon;
grant execute on function public.release_clearance_summary(uuid) to authenticated, service_role;

revoke execute on function public.record_clearance(uuid, public.clearance_cell, public.clearance_status, text)
  from public, anon;
grant execute on function public.record_clearance(uuid, public.clearance_cell, public.clearance_status, text)
  to authenticated, service_role;

revoke execute on function public.decide_release(uuid, text, text, text) from public, anon;
grant execute on function public.decide_release(uuid, text, text, text) to authenticated, service_role;

revoke execute on function public.admin_update_profile(
  uuid, public.app_role, uuid, public.aicte_region, text, text, boolean, public.clearance_cell) from public, anon;
grant execute on function public.admin_update_profile(
  uuid, public.app_role, uuid, public.aicte_region, text, text, boolean, public.clearance_cell)
  to authenticated, service_role;
