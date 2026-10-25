-- G15 — escalation desk for deposits that stay lapsed.
--
-- run_alerts() already told the *institution* that its instrument matured and
-- then, after `escalation_days`, that the case had been "escalated to the AICTE
-- Approval Bureau" — but nothing was actually escalated. An officer had no queue
-- to work, and no way to say "seen, chasing the bank".
--
-- This adds that record. sync_escalations() reconciles open items with the
-- register on every cron run: a deposit past the window gets one open row whose
-- lapsed day count keeps moving, and the row closes by itself as soon as the
-- institution renews, releases, or the setting widens. A regional officer for
-- that region (or a verifier / administrator) acknowledges it with a note; the
-- auditor reads without touching. Officials also get one critical notice per
-- lapsed instrument, so the desk is not the only place it surfaces.

create table public.deposit_escalations (
  id              uuid primary key default gen_random_uuid(),
  deposit_id      uuid not null unique references public.deposits (id) on delete cascade,
  institution_id  uuid not null references public.institutions (id) on delete cascade,
  days_lapsed     int not null check (days_lapsed >= 0),
  opened_at       timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  acknowledged_by uuid references public.profiles (id) on delete set null,
  acknowledged_at timestamptz,
  note            text,
  closed_at       timestamptz
);

create index deposit_escalations_open_idx
  on public.deposit_escalations (opened_at) where closed_at is null;
create index deposit_escalations_institution_idx on public.deposit_escalations (institution_id);

create trigger deposit_escalations_updated before update on public.deposit_escalations
  for each row execute function public.set_updated_at();
create trigger audit_deposit_escalations after insert or update or delete on public.deposit_escalations
  for each row execute function public.audit_row();

create view public.escalation_overview with (security_invoker = true) as
select
  e.*,
  d.reference_no,
  d.instrument_type,
  d.instrument_number,
  d.bank_name,
  d.amount,
  d.maturity_date,
  i.name      as institution_name,
  i.aicte_id  as institution_aicte_id,
  i.region,
  i.state,
  p.full_name as acknowledged_by_name,
  p.email     as acknowledged_by_email,
  (e.closed_at is null) as is_open
from public.deposit_escalations e
join public.deposits d on d.id = e.deposit_id
join public.institutions i on i.id = e.institution_id
left join public.profiles p on p.id = e.acknowledged_by;

-------------------------------------------------------------------------------
-- Reconciliation. Service-role only: the daily job calls it, nobody else.
-------------------------------------------------------------------------------
create or replace function public.sync_escalations()
returns int language plpgsql security definer set search_path = '' as $$
declare
  s public.app_settings;
  v_count int := 0;
  v_n int;
begin
  select * into s from public.app_settings where id;

  -- A case is live while the instrument is held and nothing has replaced it.
  -- Anything that leaves that state — renewal, release, rejection, archive, or
  -- a wider window — closes the row and keeps the history.
  update public.deposit_escalations e
  set closed_at = now()
  from public.deposits d
  where d.id = e.deposit_id
    and e.closed_at is null
    and (
      d.status not in ('verified', 'release_requested')
      or d.archived_at is not null
      or d.maturity_date > current_date - s.escalation_days
      or exists (select 1 from public.deposits r
                 where r.replaces_deposit_id = d.id and r.status in ('submitted', 'verified'))
    );
  get diagnostics v_n = row_count; v_count := v_count + v_n;

  insert into public.deposit_escalations (deposit_id, institution_id, days_lapsed)
  select d.id, d.institution_id, current_date - d.maturity_date
  from public.deposits d
  where d.status in ('verified', 'release_requested')
    and d.archived_at is null
    and d.maturity_date <= current_date - s.escalation_days
    and not exists (select 1 from public.deposits r
                    where r.replaces_deposit_id = d.id and r.status in ('submitted', 'verified'))
  on conflict (deposit_id) do update
    set days_lapsed = excluded.days_lapsed,
        -- Reopening starts a new episode, so a previous acknowledgement does
        -- not make the case look handled.
        opened_at = case when deposit_escalations.closed_at is not null then now()
                         else deposit_escalations.opened_at end,
        acknowledged_by = case when deposit_escalations.closed_at is not null then null
                               else deposit_escalations.acknowledged_by end,
        acknowledged_at = case when deposit_escalations.closed_at is not null then null
                               else deposit_escalations.acknowledged_at end,
        note = case when deposit_escalations.closed_at is not null then null
                    else deposit_escalations.note end,
        closed_at = null;
  get diagnostics v_n = row_count; v_count := v_count + v_n;

  -- The officer-facing notice, once per lapsed instrument and maturity date.
  insert into public.notifications (institution_id, deposit_id, kind, severity, audience, title, body, dedupe_key)
  select d.institution_id, d.id, 'escalation_officer', 'critical', 'officials',
         format('Escalation: %s lapsed %s days ago', d.reference_no, current_date - d.maturity_date),
         format('%s (%s) still holds %s %s with %s that matured on %s. No renewed instrument has been furnished; work the escalation desk.',
                i.name, i.aicte_id, upper(d.instrument_type::text), d.instrument_number,
                d.bank_name, to_char(d.maturity_date, 'DD Mon YYYY')),
         format('escalation_officer:%s:%s', d.id, d.maturity_date)
  from public.deposits d
  join public.institutions i on i.id = d.institution_id
  where d.status in ('verified', 'release_requested')
    and d.archived_at is null
    and d.maturity_date <= current_date - s.escalation_days
    and not exists (select 1 from public.deposits r
                    where r.replaces_deposit_id = d.id and r.status in ('submitted', 'verified'))
  on conflict (dedupe_key) do nothing;

  return v_count;
end $$;

-------------------------------------------------------------------------------
-- Acknowledgement. Auditors read; institutions are not in this loop.
-------------------------------------------------------------------------------
create or replace function public.acknowledge_escalation(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_role   public.app_role := public.my_role();
  v_region public.aicte_region;
begin
  select i.region into v_region
  from public.deposit_escalations e
  join public.institutions i on i.id = e.institution_id
  where e.id = p_id and e.closed_at is null;
  if not found then
    raise exception 'Escalation not found or already closed';
  end if;

  if v_role is null or v_role not in ('regional_officer', 'aicte_verifier', 'admin') then
    raise exception 'Only an AICTE official can acknowledge an escalation'
      using errcode = '42501';
  end if;
  if v_role = 'regional_officer'
     and v_region is distinct from (select p.region from public.profiles p where p.id = auth.uid()) then
    raise exception 'This escalation belongs to another region'
      using errcode = '42501';
  end if;

  perform set_config('app.audit_note',
    'Acknowledged' || coalesce(': ' || left(trim(p_note), 480), ''), true);

  update public.deposit_escalations
  set acknowledged_by = auth.uid(),
      acknowledged_at = now(),
      note = nullif(trim(p_note), '')
  where id = p_id and closed_at is null;
end $$;

-- New functions are executable by PUBLIC by default; the sync pass is the job's.
revoke execute on function public.sync_escalations() from public, anon, authenticated;
grant execute on function public.sync_escalations() to service_role;
revoke execute on function public.acknowledge_escalation(uuid, text) from public, anon;

-------------------------------------------------------------------------------
-- RLS: readable wherever the institution is readable; written only by the
-- functions above.
-------------------------------------------------------------------------------
alter table public.deposit_escalations enable row level security;

create policy deposit_escalations_select on public.deposit_escalations for select to authenticated
  using (public.can_access_institution(institution_id));
revoke insert, update, delete, truncate on public.deposit_escalations from authenticated, anon;
