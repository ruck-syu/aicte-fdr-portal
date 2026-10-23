-- G2 — automated refund / penalty calculator.
--
-- A release is a refund of the security deposit AICTE holds. The quote is a
-- deterministic, read-only computation: principal + simple interest accrued to
-- the quote date, less an early-release penalty when the deposit has not been
-- held for the configured minimum period. It is indicative until an officer
-- approves the release, at which point the accepted quote is frozen on the
-- release request so the sanctioned amount can never be recomputed
-- retroactively (and the change is captured by the audit trigger).

-------------------------------------------------------------------------------
-- Policy knobs (configurable by an administrator, never hard-coded)
-------------------------------------------------------------------------------
alter table public.app_settings
  add column min_holding_years int not null default 10
    check (min_holding_years >= 0),
  add column early_release_penalty_pct numeric(5, 2) not null default 10
    check (early_release_penalty_pct between 0 and 100),
  add column default_interest_rate numeric(5, 2) not null default 6.5
    check (default_interest_rate >= 0);

-------------------------------------------------------------------------------
-- Sanction record
-------------------------------------------------------------------------------
alter table public.release_requests
  add column quote             jsonb,
  add column sanctioned_amount numeric(14, 2),
  add column sanctioned_by     uuid references public.profiles (id) on delete set null,
  add column sanctioned_at     timestamptz;

-------------------------------------------------------------------------------
-- release_overview must expose the new columns. `select r.*` was expanded when
-- the view was created, so it does not pick them up by itself. The columns are
-- listed explicitly and the four new ones are appended at the end: CREATE OR
-- REPLACE VIEW allows that, so no DROP (and no destructive-statement warning)
-- is needed. Existing names, order and types must stay untouched.
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
  r.sanctioned_at
from public.release_requests r
join public.deposits d on d.id = r.deposit_id
join public.institutions i on i.id = r.institution_id;

grant select on public.release_overview to authenticated, service_role;

-------------------------------------------------------------------------------
-- release_quote(deposit, as_of)
--
-- Returns: principal, holding_days / holding_years, interest_rate,
-- accrued_interest, penalty_pct / penalty_amount, shortfall, net_payable,
-- eligible and the reasons that explain the result. `as_of` defaults to today
-- and is accepted explicitly so the calculation can be tested deterministically.
-------------------------------------------------------------------------------
create or replace function public.release_quote(p_deposit uuid, p_as_of date default current_date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  d          public.deposits;
  s          public.app_settings;
  v_rate     numeric(5, 2);
  v_days     int;
  v_years    numeric(8, 2);
  v_interest numeric(14, 2);
  v_pct      numeric(5, 2) := 0;
  v_penalty  numeric(14, 2) := 0;
  v_short    numeric(14, 2) := 0;
  v_reasons  text[] := '{}';
begin
  select * into d from public.deposits where id = p_deposit;
  if d.id is null or not public.can_access_institution(d.institution_id) then
    raise exception 'Deposit not found';
  end if;
  select * into s from public.app_settings where id;

  v_days := greatest(p_as_of - d.issue_date, 0);
  v_years := round(v_days::numeric / 365, 2);
  v_rate := coalesce(d.interest_rate, s.default_interest_rate);
  v_interest := round(d.amount * v_rate / 100 * v_days::numeric / 365, 2);

  if v_days < s.min_holding_years * 365 then
    v_pct := s.early_release_penalty_pct;
    v_reasons := array_append(v_reasons, 'EARLY_RELEASE_BEFORE_MIN_HOLDING');
  end if;

  if d.required_amount is not null and d.amount < d.required_amount then
    v_short := round(d.required_amount - d.amount, 2);
    v_reasons := array_append(v_reasons, 'DEPOSIT_BELOW_REQUIRED');
  end if;

  if p_as_of > d.maturity_date then
    v_reasons := array_append(v_reasons, 'INSTRUMENT_ALREADY_MATURED');
  end if;

  v_penalty := round(d.amount * v_pct / 100, 2);

  return jsonb_build_object(
    'deposit_id',      d.id,
    'principal',       d.amount,
    'issue_date',      d.issue_date,
    'maturity_date',   d.maturity_date,
    'as_of',           p_as_of,
    'holding_days',    v_days,
    'holding_years',   v_years,
    'interest_rate',   v_rate,
    'accrued_interest', v_interest,
    'penalty_pct',     v_pct,
    'penalty_amount',  v_penalty,
    'shortfall',       v_short,
    'net_payable',     greatest(round(d.amount + v_interest - v_penalty, 2), 0),
    'eligible',        v_pct = 0,
    'reasons',         to_jsonb(v_reasons)
  );
end $$;

revoke execute on function public.release_quote(uuid, date) from public, anon;
grant execute on function public.release_quote(uuid, date) to authenticated, service_role;

-------------------------------------------------------------------------------
-- decide_release: freeze the quote at approval.
-------------------------------------------------------------------------------
create or replace function public.decide_release(p_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r       public.release_requests;
  v_note  text := nullif(trim(p_note), '');
  v_quote jsonb;
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
  if v_note is not null then
    perform set_config('app.audit_note', left(v_note, 500), true);
  end if;

  if p_decision = 'approve' then
    v_quote := public.release_quote(r.deposit_id);
  end if;

  update public.release_requests
     set status = case p_decision when 'approve' then 'approved' else 'rejected' end::public.release_status,
         decided_by = auth.uid(),
         decided_at = now(),
         decision_note = v_note,
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
