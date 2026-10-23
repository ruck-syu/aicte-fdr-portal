-- G6 — APH rate card for demands.
--
-- The Approval Process Handbook (Table 1.4) anchors the security deposit to the
-- programme and level. The card is reference data, not code: a new APH edition
-- is a new dated row, so demands already issued keep the figures they were
-- created with. A demand linked to a card row may still differ (APH has
-- exceptions — government colleges, leased land), but the difference must carry
-- a written reason, which the audit trigger records.
--
-- Only the Engineering & Technology rows quoted in the proposal are seeded.
-- Transcribe the rest from the current APH edition before relying on them.

-------------------------------------------------------------------------------
-- Rate card
-------------------------------------------------------------------------------
create table public.aph_deposit_rates (
  id             uuid primary key default gen_random_uuid(),
  program_key    text not null,
  level          text not null check (level in ('diploma', 'undergraduate', 'postgraduate', 'other')),
  program_label  text not null,
  amount         numeric(14, 2) not null check (amount > 0),
  effective_from date not null default current_date,
  effective_to   date,
  source_note    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint aph_rate_window check (effective_to is null or effective_to > effective_from),
  unique (program_key, effective_from)
);
create index aph_deposit_rates_active_idx
  on public.aph_deposit_rates (program_key, effective_from desc);

create trigger aph_deposit_rates_updated before update on public.aph_deposit_rates
  for each row execute function public.set_updated_at();
create trigger audit_aph_deposit_rates after insert or update or delete on public.aph_deposit_rates
  for each row execute function public.audit_row();

-------------------------------------------------------------------------------
-- Demands carry the card row they were priced from, and any override reason.
-------------------------------------------------------------------------------
alter table public.deposit_demands
  add column aph_rate_id  uuid references public.aph_deposit_rates (id) on delete set null,
  add column override_note text;

-------------------------------------------------------------------------------
-- Enforcement: a linked demand must use the card amount unless a reason is given.
-------------------------------------------------------------------------------
create or replace function public.demands_before_write()
returns trigger language plpgsql as $$
declare
  r       public.aph_deposit_rates;
  v_check boolean := false;
  v_note  text := nullif(trim(new.override_note), '');
begin
  if new.due_date is null then
    new.due_date := new.intimation_date
      + (select submission_window_days from public.app_settings where id);
  end if;

  if tg_op = 'INSERT' then
    v_check := true;
  else
    v_check := new.aph_rate_id is distinct from old.aph_rate_id
            or new.required_amount is distinct from old.required_amount;
  end if;

  if v_check and new.aph_rate_id is not null then
    select * into r from public.aph_deposit_rates where id = new.aph_rate_id;
    if r.id is null then
      raise exception 'APH rate row not found';
    end if;
    if new.required_amount is distinct from r.amount then
      if v_note is null then
        raise exception 'Amount differs from the APH rate for % (₹%). Add an override note or use the APH amount.',
          r.program_label, to_char(r.amount, 'FM99,99,99,990');
      end if;
      perform set_config('app.audit_note', 'APH override: ' || left(v_note, 480), true);
    end if;
  end if;
  return new;
end $$;

-------------------------------------------------------------------------------
-- RLS: officials read the card; only the service role (or SQL) maintains it.
-------------------------------------------------------------------------------
alter table public.aph_deposit_rates enable row level security;
create policy aph_deposit_rates_select on public.aph_deposit_rates for select to authenticated
  using (public.is_official());
revoke insert, update, delete, truncate on public.aph_deposit_rates from authenticated, anon;
grant select on public.aph_deposit_rates to authenticated, service_role;

-------------------------------------------------------------------------------
-- Seed: the figures the proposal quotes (Engineering & Technology, Table 1.4).
-------------------------------------------------------------------------------
insert into public.aph_deposit_rates
  (program_key, level, program_label, amount, effective_from, source_note)
values
  ('engineering_diploma', 'diploma', 'Engineering & Technology — Diploma / Post Diploma',
   1500000, '2024-04-01', 'APH 2024-27, Table 1.4'),
  ('engineering_ug', 'undergraduate', 'Engineering & Technology — Undergraduate',
   3500000, '2024-04-01', 'APH 2024-27, Table 1.4'),
  ('engineering_pg', 'postgraduate', 'Engineering & Technology — Postgraduate',
   1500000, '2024-04-01', 'APH 2024-27, Table 1.4')
on conflict (program_key, effective_from) do nothing;
