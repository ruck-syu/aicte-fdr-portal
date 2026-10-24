-- G14 — SMS channel for alerts.
--
-- Alerts were in-app plus an optional Resend email. Institutions with a mobile
-- number can now opt in to SMS for warning / critical notices, which is the
-- channel that actually reaches a registrar before a maturity date.
--
-- The delivery log is the source of truth for what was sent, to which number,
-- through which provider, and whether it worked — so a retry can never send the
-- same notice twice (the unique key), and an auditor can see the trail. The
-- channel lives on the delivery row rather than on notifications: one notice
-- can go out in-app, by email and by SMS, and each attempt deserves its record.

create type public.notice_channel as enum ('email', 'sms');

alter table public.institutions add column sms_opt_in boolean not null default false;

create table public.notification_deliveries (
  id              uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  institution_id  uuid references public.institutions (id) on delete cascade,
  channel         public.notice_channel not null,
  destination     text not null,
  provider        text not null,
  status          text not null check (status in ('sent', 'failed', 'skipped')),
  provider_ref    text,
  error           text,
  created_at      timestamptz not null default now(),
  unique (notification_id, channel, destination)
);

create index notification_deliveries_recent on public.notification_deliveries (created_at desc);

alter table public.notification_deliveries enable row level security;

create policy notification_deliveries_select on public.notification_deliveries for select to authenticated
  using (
    (select public.my_role()) in ('admin', 'auditor')
    or (institution_id is not null and public.can_access_institution(institution_id))
  );
revoke insert, update, delete, truncate on public.notification_deliveries from authenticated, anon;

-------------------------------------------------------------------------------
-- Queue: notices not yet texted to an opted-in institution.
-- Service-role only; the daily job calls it, nobody else.
-------------------------------------------------------------------------------
create or replace function public.sms_queue(p_since timestamptz)
returns table (
  notification_id uuid,
  institution_id  uuid,
  phone           text,
  title           text,
  body            text,
  severity        text
)
language sql stable security definer set search_path = '' as $$
  select n.id, n.institution_id, i.contact_phone, n.title, n.body, n.severity
  from public.notifications n
  join public.institutions i on i.id = n.institution_id
  where n.created_at >= p_since
    and n.audience <> 'officials'
    and n.severity in ('warning', 'critical')
    and i.sms_opt_in
    and nullif(trim(i.contact_phone), '') is not null
    -- A failed attempt stays queued so the next run retries it; the unique
    -- (notification, channel, destination) key makes that a row update.
    and not exists (
      select 1 from public.notification_deliveries d
      where d.notification_id = n.id and d.channel = 'sms' and d.status = 'sent'
    )
  order by n.created_at
  limit 100
$$;

revoke execute on function public.sms_queue(timestamptz) from public, anon, authenticated;
grant execute on function public.sms_queue(timestamptz) to service_role;
