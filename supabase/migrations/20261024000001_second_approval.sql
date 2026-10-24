-- G10 — dynamic role-based approvals.
--
-- The spec (§2.3) asks for approvals that escalate with the amount: above a
-- configurable threshold a release needs two signatures, not one. This
-- migration adds
--
--   * app_settings.release_second_approval_threshold (default ₹10,00,000),
--   * release_requests.first_approved_by / _at / _note — the first signature
--     is kept even after the second one overwrites decided_by/decided_at,
--   * a status, `pending_second_approval`, between the reviewer's approval and
--     the final sanction,
--   * decide_release() as a two-stage decision: at or above the threshold the
--     first approval parks the request (NOC + quote frozen), and the second
--     must come from an AICTE verifier or administrator who is not the officer
--     who signed first, with a recorded note.
--
-- Below the threshold nothing changes: one reviewer decides, as before.

alter table public.app_settings
  add column release_second_approval_threshold numeric(14, 2) not null default 1000000
    check (release_second_approval_threshold >= 0);

alter table public.release_requests
  add column first_approved_by   uuid references public.profiles (id) on delete set null,
  add column first_approved_at   timestamptz,
  add column first_approved_note text;

-------------------------------------------------------------------------------
-- decide_release: one signature below the threshold, two at or above it.
-------------------------------------------------------------------------------
create or replace function public.decide_release(
  p_id uuid,
  p_decision text,
  p_note text default null,
  p_noc_reference text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r           public.release_requests;
  v_note      text := nullif(trim(p_note), '');
  v_noc       text := nullif(trim(p_noc_reference), '');
  v_quote     jsonb;
  v_cleared   int;
  v_blocked   int;
  v_decided   int;
  v_threshold numeric;
  v_role      public.app_role := public.my_role();
  v_two_step  boolean := false;
begin
  select * into r from public.release_requests where id = p_id for update;
  if r.id is null or not public.is_reviewer(r.institution_id) then
    raise exception 'Release request not found';
  end if;
  if r.status not in ('submitted', 'pending_second_approval') then
    raise exception 'Only submitted release requests can be decided (current status: %)', r.status;
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'Unknown decision %', p_decision;
  end if;

  -- Second and final signature. The quote and NOC were frozen at first
  -- approval; only the sanction is written here.
  if r.status = 'pending_second_approval' and p_decision = 'approve' then
    if v_role not in ('aicte_verifier', 'admin') then
      raise exception 'The second approval must come from an AICTE verifier or an administrator';
    end if;
    if r.first_approved_by = auth.uid() then
      raise exception 'The officer who gave the first approval cannot also give the second';
    end if;
    if v_note is null then
      raise exception 'A note is required for the second approval';
    end if;
    v_quote := coalesce(r.quote, public.release_quote(r.deposit_id));
    perform set_config('app.audit_note', left(v_note, 500), true);
    update public.release_requests
       set status = 'approved',
           decided_by = auth.uid(),
           decided_at = now(),
           decision_note = v_note,
           quote = v_quote,
           sanctioned_amount = (v_quote ->> 'net_payable')::numeric,
           sanctioned_by = auth.uid(),
           sanctioned_at = now()
     where id = r.id;
    update public.deposits set status = 'released', released_at = now()
     where id = r.deposit_id and status = 'release_requested';
    insert into public.comments (release_request_id, deposit_id, institution_id, author_id, body)
    values (r.id, r.deposit_id, r.institution_id, auth.uid(), '[Second approval] ' || v_note);
    return;
  end if;

  if p_decision = 'reject' and v_note is null then
    raise exception 'A note explaining the rejection is required';
  end if;

  if p_decision = 'approve' then
    perform public.ensure_release_clearances(r.id);
    select count(*) filter (where status = 'cleared'),
           count(*) filter (where status = 'blocked'),
           count(*) filter (where status <> 'pending')
      into v_cleared, v_blocked, v_decided
      from public.release_clearances
     where release_request_id = r.id;

    if v_blocked > 0 then
      if v_role is distinct from 'admin' then
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
    select release_second_approval_threshold into v_threshold from public.app_settings where id;
    v_two_step := (v_quote ->> 'net_payable')::numeric >= coalesce(v_threshold, 0);
  end if;

  if v_note is not null then
    perform set_config('app.audit_note', left(v_note, 500), true);
  end if;

  -- Above the threshold the reviewer's approval is the first of two: the
  -- request waits for a senior signature and the deposit stays committed.
  if p_decision = 'approve' and v_two_step then
    update public.release_requests
       set status = 'pending_second_approval',
           first_approved_by = auth.uid(),
           first_approved_at = now(),
           first_approved_note = v_note,
           noc_reference = v_noc,
           quote = v_quote,
           decided_by = null,
           decided_at = null,
           decision_note = null,
           sanctioned_amount = null,
           sanctioned_by = null,
           sanctioned_at = null
     where id = r.id;
    insert into public.comments (release_request_id, deposit_id, institution_id, author_id, body)
    values (r.id, r.deposit_id, r.institution_id, auth.uid(),
            '[First approval] ' || coalesce(v_note, 'Approved at first level; awaiting second approval'));
    return;
  end if;

  update public.release_requests
     set status = case p_decision when 'approve' then 'approved' else 'rejected' end::public.release_status,
         decided_by = auth.uid(),
         decided_at = now(),
         decision_note = v_note,
         -- A rejection after a first approval must not erase the NOC on record.
         noc_reference = case when p_decision = 'approve' then v_noc else r.noc_reference end,
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
-- The overview carries both signatures so the queue and the printout can show
-- who approved first and who sanctioned.
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
  r.noc_reference,
  r.first_approved_by,
  r.first_approved_at,
  r.first_approved_note
from public.release_requests r
join public.deposits d on d.id = r.deposit_id
join public.institutions i on i.id = r.institution_id;

grant select on public.release_overview to authenticated, service_role;

-------------------------------------------------------------------------------
-- The dashboard counts everything still awaiting a decision, and separates the
-- ones parked for a second signature.
-------------------------------------------------------------------------------
create or replace function public.dashboard_stats()
returns jsonb language sql stable security invoker set search_path = '' as $$
  with d as (select * from public.deposit_overview),
  held as (select * from d where status in ('verified', 'release_requested')),
  recent as (
    select extract(epoch from (verified_at - submitted_at)) / 3600 as hours
    from public.deposits
    where verified_at is not null
      and submitted_at is not null
      and verified_at >= submitted_at
      and verified_at >= now() - interval '90 days'
  ),
  renewed as (
    select count(*) as n
    from public.deposits o
    where exists (select 1 from public.deposits s
                  where s.replaces_deposit_id = o.id
                    and s.status in ('verified', 'release_requested', 'released'))
  ),
  lapsed as (
    select count(*) as n
    from public.deposit_overview o
    where o.validity = 'expired'
      and not exists (select 1 from public.deposits s
                      where s.replaces_deposit_id = o.id
                        and s.status in ('verified', 'release_requested', 'released'))
  ),
  flags as (
    select extract(epoch from (now() - created_at)) / 86400 as days
    from public.discrepancies
    where resolved_at is null
  )
  select jsonb_build_object(
    'held_count',        (select count(*) from held),
    'held_value',        (select coalesce(sum(amount), 0) from held),
    'active',            (select count(*) from held where validity = 'active'),
    'maturing',          (select count(*) from held where validity = 'maturing'),
    'expired',           (select count(*) from held where validity = 'expired'),
    'pending_verification', (select count(*) from d where status = 'submitted'),
    'flagged',           (select count(*) from d where status = 'submitted' and open_errors > 0),
    'returned',          (select count(*) from d where status = 'discrepancy'),
    'drafts',            (select count(*) from d where status = 'draft'),
    'release_pending',   (select count(*) from public.release_requests
                            where status in ('submitted', 'pending_second_approval')),
    'release_second_approval', (select count(*) from public.release_requests
                            where status = 'pending_second_approval'),
    'released_value',    (select coalesce(sum(amount), 0) from d where status = 'released'),
    'open_demands',      (select count(*) from public.demand_overview where status = 'open'),
    'overdue_demands',   (select count(*) from public.demand_overview where is_overdue),
    'avg_verification_hours', (select round(avg(hours), 1) from recent),
    'p90_verification_hours', (
      select round((percentile_cont(0.9) within group (order by hours))::numeric, 1)
      from recent
    ),
    'renewal_compliance_pct', (
      select case when r.n + l.n = 0 then null
                  else round(100.0 * r.n / (r.n + l.n), 1) end
      from renewed r, lapsed l
    ),
    'open_flag_p50_days', (
      select round((percentile_cont(0.5) within group (order by days))::numeric, 1) from flags
    ),
    'open_flag_p90_days', (
      select round((percentile_cont(0.9) within group (order by days))::numeric, 1) from flags
    ),
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                  from (select status, count(*) n from d group by status) s),
    'by_region', (select coalesce(jsonb_agg(r order by r.value desc), '[]'::jsonb) from (
                    select region, count(*) as count, sum(amount) as value
                    from held group by region) r),
    'maturity_timeline', (select coalesce(jsonb_agg(m order by m.month), '[]'::jsonb) from (
                    select to_char(gs, 'YYYY-MM') as month,
                           (select count(*) from held h
                             where date_trunc('month', h.maturity_date) = gs) as count,
                           (select coalesce(sum(amount), 0) from held h
                             where date_trunc('month', h.maturity_date) = gs) as value
                    from generate_series(date_trunc('month', current_date),
                                         date_trunc('month', current_date) + interval '11 months',
                                         interval '1 month') gs) m)
  )
$$;

