-- G13 — retention policy and non-destructive archival.
--
-- The spec asks for a documented retention rule (§4). Records here are evidence
-- for an audit, so nothing is deleted: a settled deposit whose retention window
-- has elapsed shows up on **Archival due**, and an administrator can archive it.
-- An archived deposit stays readable to everyone who could read it before, but
-- the portal's update path refuses to change it — the row becomes a record.
--
-- The window is measured from maturity, not from release, so a deposit that sat
-- unrenewed for years is retained long enough either way. The restore path is
-- unarchive_deposit(), which is audited like the archive itself.

alter table public.app_settings
  add column retention_years int not null default 10
  check (retention_years between 1 and 50);

alter table public.deposits add column archived_at timestamptz;

-- Expose the new column. The view binds its column list at creation, and
-- CREATE OR REPLACE cannot shift positions, so it is rebuilt: nothing else
-- selects from it at definition time.
drop view if exists public.deposit_overview;
create view public.deposit_overview with (security_invoker = true) as
select
  d.*,
  i.name      as institution_name,
  i.aicte_id  as institution_aicte_id,
  i.region,
  i.state,
  (d.maturity_date - current_date) as days_to_maturity,
  case
    when d.status not in ('verified', 'release_requested') then null
    when d.maturity_date <= current_date then 'expired'
    when d.maturity_date <= current_date + (
      select coalesce(max(x), 60) from public.app_settings s, unnest(s.alert_days) x where s.id
    ) then 'maturing'
    else 'active'
  end as validity,
  (select count(*) from public.discrepancies x
    where x.deposit_id = d.id and x.resolved_at is null and x.severity = 'error')::int as open_errors,
  (select count(*) from public.discrepancies x
    where x.deposit_id = d.id and x.resolved_at is null)::int as open_flags
from public.deposits d
join public.institutions i on i.id = d.institution_id;

-- Settled deposits whose retention window has elapsed. 'released' and
-- 'replaced' are the closed states; 'rejected' never became a holding.
create view public.archival_due with (security_invoker = true) as
select
  d.*,
  i.name      as institution_name,
  i.aicte_id  as institution_aicte_id,
  i.region,
  s.retention_years,
  (d.maturity_date + make_interval(years => s.retention_years))::date as retain_until,
  current_date - (d.maturity_date + make_interval(years => s.retention_years))::date as days_overdue
from public.deposits d
join public.institutions i on i.id = d.institution_id
cross join public.app_settings s
where d.archived_at is null
  and d.status in ('released', 'replaced', 'rejected')
  and (d.maturity_date + make_interval(years => s.retention_years))::date <= current_date;

-------------------------------------------------------------------------------
-- Archive / restore. Administrator only; the audit trigger records both.
-------------------------------------------------------------------------------
create or replace function public.archive_deposit(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() is distinct from 'admin' then
    raise exception 'Only administrators can archive records';
  end if;
  update public.deposits set archived_at = now() where id = p_id and archived_at is null;
  if not found then
    raise exception 'Deposit not found or already archived';
  end if;
end $$;

create or replace function public.unarchive_deposit(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() is distinct from 'admin' then
    raise exception 'Only administrators can restore archived records';
  end if;
  update public.deposits set archived_at = null where id = p_id and archived_at is not null;
  if not found then
    raise exception 'Deposit not found or not archived';
  end if;
end $$;

-- New functions are executable by PUBLIC by default; keep them off the anon key.
revoke execute on function public.archive_deposit(uuid), public.unarchive_deposit(uuid)
  from public, anon;

-------------------------------------------------------------------------------
-- An archived deposit is read-only through the API. The workflow functions run
-- as the definer (not 'authenticated'), so archive_deposit() itself still works.
-------------------------------------------------------------------------------
create or replace function public.deposits_before_write()
returns trigger language plpgsql as $$
declare
  v_demand public.deposit_demands;
  v_orig   public.deposits;
begin
  new.updated_at := now();
  new.ifsc := nullif(upper(trim(new.ifsc)), '');
  new.instrument_number := trim(new.instrument_number);

  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.status := 'draft';
      new.created_by := auth.uid();
      new.submitted_at := null; new.submitted_by := null;
      new.verified_at := null;  new.verified_by := null;
      new.released_at := null;
      new.bank_check := 'not_requested'; new.bank_check_ref := null;
      new.archived_at := null;
    else
      if old.archived_at is not null and new.archived_at is not distinct from old.archived_at then
        raise exception 'Archived deposits are read-only; restore the record first'
          using errcode = '42501';
      end if;
      if new.status is distinct from old.status
         or new.institution_id is distinct from old.institution_id
         or new.reference_no is distinct from old.reference_no
         or new.replaces_deposit_id is distinct from old.replaces_deposit_id
         or new.created_by is distinct from old.created_by
         or new.submitted_at is distinct from old.submitted_at
         or new.submitted_by is distinct from old.submitted_by
         or new.verified_at is distinct from old.verified_at
         or new.verified_by is distinct from old.verified_by
         or new.released_at is distinct from old.released_at
         or new.bank_check is distinct from old.bank_check
         or new.bank_check_ref is distinct from old.bank_check_ref
         or new.archived_at is distinct from old.archived_at then
        raise exception 'Workflow fields can only be changed through portal actions'
          using errcode = '42501';
      end if;
    end if;
  end if;

  -- Renewal: must replace a verified deposit of the same institution.
  if new.replaces_deposit_id is not null
     and (tg_op = 'INSERT' or new.replaces_deposit_id is distinct from old.replaces_deposit_id) then
    select * into v_orig from public.deposits where id = new.replaces_deposit_id;
    if v_orig.id is null or v_orig.institution_id <> new.institution_id then
      raise exception 'The deposit being renewed was not found for this institution';
    end if;
    if v_orig.status not in ('verified', 'release_requested') then
      raise exception 'Only verified deposits can be renewed (current status: %)', v_orig.status;
    end if;
    new.demand_id := coalesce(new.demand_id, v_orig.demand_id);
    new.approval_case_id := coalesce(new.approval_case_id, v_orig.approval_case_id);
    new.program := coalesce(new.program, v_orig.program);
    new.approval_valid_until := coalesce(new.approval_valid_until, v_orig.approval_valid_until);
    new.required_amount := coalesce(new.required_amount, v_orig.required_amount);
  end if;

  -- Linked demand: terms of the demand are authoritative.
  if new.demand_id is not null
     and (tg_op = 'INSERT' or new.demand_id is distinct from old.demand_id) then
    select * into v_demand from public.deposit_demands where id = new.demand_id;
    if v_demand.id is null or v_demand.institution_id <> new.institution_id then
      raise exception 'The selected demand does not belong to this institution';
    end if;
    new.required_amount := v_demand.required_amount;
    new.approval_case_id := v_demand.approval_case_id;
    new.program := coalesce(v_demand.program, new.program);
    new.approval_valid_until := coalesce(v_demand.approval_valid_until, new.approval_valid_until);
  end if;

  return new;
end $$;
