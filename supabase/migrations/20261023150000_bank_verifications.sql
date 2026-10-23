-- G3 — pluggable bank verification (mock-first).
--
-- The provider adapter lives in the app (`src/lib/bank/`); this migration only
-- stores the evidence and applies the outcome atomically:
--
--   confirmed    -> deposits.bank_check = 'confirmed', open BANK_MISMATCH flags resolved
--   mismatch     -> 'mismatch' + exactly one open BANK_MISMATCH flag (retry-safe)
--   unavailable  -> evidence only; 'not_requested' becomes 'requested', nothing else moves
--
-- The manual `set_bank_check()` stays as the fallback when the integration is
-- down (spec §8). Both write the deposit's bank fields; only this path records
-- the raw request/response.

create table public.bank_verifications (
  id             uuid primary key default gen_random_uuid(),
  deposit_id     uuid not null references public.deposits (id) on delete cascade,
  institution_id uuid not null references public.institutions (id) on delete cascade,
  provider       text not null,
  verdict        text not null check (verdict in ('confirmed', 'mismatch', 'unavailable')),
  reference      text,
  request        jsonb not null default '{}'::jsonb,
  response       jsonb not null default '{}'::jsonb,
  created_by     uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now()
);
create index bank_verifications_deposit_idx
  on public.bank_verifications (deposit_id, created_at desc);

alter table public.bank_verifications enable row level security;
create policy bank_verifications_select on public.bank_verifications for select to authenticated
  using (public.can_access_institution(institution_id));
revoke insert, update, delete, truncate on public.bank_verifications from authenticated, anon;

create trigger audit_bank_verifications
  after insert on public.bank_verifications
  for each row execute function public.audit_row();

create or replace function public.record_bank_verification(
  p_deposit  uuid,
  p_provider text,
  p_verdict  text,
  p_reference text,
  p_request  jsonb,
  p_response jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d      public.deposits;
  v_ref  text := nullif(trim(p_reference), '');
begin
  select * into d from public.deposits where id = p_deposit for update;
  if d.id is null or not public.is_reviewer(d.institution_id) then
    raise exception 'Deposit not found';
  end if;
  if d.status not in ('submitted', 'discrepancy') then
    raise exception 'Bank verification applies to deposits under review (current status: %)', d.status;
  end if;
  if p_verdict not in ('confirmed', 'mismatch', 'unavailable') then
    raise exception 'Unknown bank verdict %', p_verdict;
  end if;

  insert into public.bank_verifications
    (deposit_id, institution_id, provider, verdict, reference, request, response)
  values
    (d.id, d.institution_id, p_provider, p_verdict, v_ref,
     coalesce(p_request, '{}'::jsonb), coalesce(p_response, '{}'::jsonb));

  if p_verdict = 'confirmed' then
    update public.deposits set bank_check = 'confirmed', bank_check_ref = v_ref where id = d.id;
    update public.discrepancies
       set resolved_at = now(), resolved_by = auth.uid(),
           resolution_note = 'Bank confirmed on re-check'
     where deposit_id = d.id and code = 'BANK_MISMATCH' and resolved_at is null;
  elsif p_verdict = 'mismatch' then
    update public.deposits set bank_check = 'mismatch', bank_check_ref = v_ref where id = d.id;
    if not exists (select 1 from public.discrepancies
                   where deposit_id = d.id and code = 'BANK_MISMATCH' and resolved_at is null) then
      insert into public.discrepancies
        (deposit_id, institution_id, code, severity, message, source, raised_by)
      values
        (d.id, d.institution_id, 'BANK_MISMATCH', 'error',
         'Bank verification does not match the instrument' ||
         coalesce(' (ref ' || v_ref || ')', ''), 'system', auth.uid());
    end if;
  else
    update public.deposits set bank_check = 'requested'
     where id = d.id and bank_check = 'not_requested';
  end if;
end $$;

revoke execute on function public.record_bank_verification(uuid, text, text, text, jsonb, jsonb)
  from public, anon;
grant execute on function public.record_bank_verification(uuid, text, text, text, jsonb, jsonb)
  to authenticated, service_role;
