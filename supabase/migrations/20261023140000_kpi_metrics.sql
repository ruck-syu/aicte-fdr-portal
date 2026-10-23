-- G4 — KPI instrumentation.
--
-- The spec's success criteria are time-based (submission -> verification under
-- an hour, 95% renewal compliance, 100% auditability). dashboard_stats() only
-- surfaced counts. These keys add the rates, always computed over the caller's
-- RLS scope because the function is SECURITY INVOKER:
--
--   avg_verification_hours   mean (verified_at - submitted_at), last 90 days
--   p90_verification_hours   90th percentile of the same sample
--   renewal_compliance_pct   renewed / (renewed + lapsed)
--   open_flag_p50_days       median age of unresolved discrepancy flags
--   open_flag_p90_days       90th percentile of flag age
--
-- Every value is null when there is no sample, so the UI can render "—"
-- instead of NaN or a misleading zero.

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
    'release_pending',   (select count(*) from public.release_requests where status = 'submitted'),
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
