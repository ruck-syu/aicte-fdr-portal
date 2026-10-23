-- AICTE Security Deposit / FDR Management Portal
-- Initial schema: institutions, users, deposit demands, deposits (FDRs),
-- documents, discrepancies, release requests, notifications and audit trail.
--
-- Security model
--   * Every table has RLS. Access is scoped by the caller's profile:
--       institute_user   -> own institution only
--       regional_officer -> institutions in own AICTE region
--       aicte_verifier   -> all institutions
--       admin            -> everything + user / institution management
--   * Workflow transitions (submit, verify, release, ...) only happen through
--     SECURITY DEFINER functions below, which enforce role + state.
--     Direct UPDATEs from the API can only edit data fields of drafts.
--   * Every write to a business table is captured in audit_logs by trigger.

-------------------------------------------------------------------------------
-- Types
-------------------------------------------------------------------------------
create type public.app_role as enum ('institute_user', 'regional_officer', 'aicte_verifier', 'admin');
create type public.aicte_region as enum (
  'central', 'eastern', 'northern', 'north_western',
  'southern', 'south_central', 'south_western', 'western'
);
create type public.instrument_type as enum ('fdr', 'jfdr', 'bank_guarantee', 'demand_draft');
create type public.deposit_status as enum (
  'draft', 'submitted', 'discrepancy', 'verified', 'rejected',
  'release_requested', 'released', 'replaced'
);
create type public.document_type as enum (
  'fdr_scan', 'affidavit', 'loa', 'payment_receipt', 'bank_certificate',
  'clearance_certificate', 'release_letter', 'other'
);
create type public.release_status as enum ('draft', 'submitted', 'approved', 'rejected', 'withdrawn');
create type public.release_reason as enum (
  'course_closure', 'institution_closure', 'term_completion', 'replacement', 'other'
);
create type public.demand_status as enum ('open', 'fulfilled', 'waived');
create type public.bank_check as enum ('not_requested', 'requested', 'confirmed', 'mismatch');

create or replace function public.try_uuid(p text)
returns uuid language sql immutable as $$
  select case
    when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid
  end
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-------------------------------------------------------------------------------
-- Tables
-------------------------------------------------------------------------------
create table public.institutions (
  id            uuid primary key default gen_random_uuid(),
  aicte_id      text not null unique,
  name          text not null,
  state         text not null,
  city          text,
  region        public.aicte_region not null,
  address       text,
  contact_email text,
  contact_phone text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  email          text not null,
  full_name      text,
  designation    text,
  role           public.app_role,
  institution_id uuid references public.institutions (id) on delete set null,
  region         public.aicte_region,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint profile_scope check (
    role is null
    or (role = 'institute_user' and institution_id is not null)
    or (role = 'regional_officer' and region is not null)
    or role in ('aicte_verifier', 'admin')
  )
);

create table public.app_settings (
  id                          boolean primary key default true check (id),
  alert_days                  int[] not null default '{60,30,7}',
  escalation_days             int not null default 7,
  submission_window_days      int not null default 15,
  required_documents          public.document_type[] not null default '{fdr_scan,affidavit,loa}',
  release_required_documents  public.document_type[] not null default '{release_letter,affidavit}',
  updated_at                  timestamptz not null default now()
);
insert into public.app_settings default values;

create sequence public.demand_ref_seq;
create sequence public.deposit_ref_seq;
create sequence public.release_ref_seq;

-- A demand is AICTE's intimation that an institution must furnish a security
-- deposit (e.g. on grant of approval). Proof is due within the submission window.
create table public.deposit_demands (
  id                    uuid primary key default gen_random_uuid(),
  reference_no          text not null unique default (
    'DM-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.demand_ref_seq')::text, 6, '0')
  ),
  institution_id        uuid not null references public.institutions (id) on delete cascade,
  approval_case_id      text not null,
  program               text,
  required_amount       numeric(14, 2) not null check (required_amount > 0),
  approval_valid_until  date,
  intimation_date       date not null default current_date,
  due_date              date,
  status                public.demand_status not null default 'open',
  notes                 text,
  created_by            uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.deposits (
  id                    uuid primary key default gen_random_uuid(),
  reference_no          text not null unique default (
    'SD-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.deposit_ref_seq')::text, 6, '0')
  ),
  institution_id        uuid not null references public.institutions (id) on delete restrict,
  demand_id             uuid references public.deposit_demands (id) on delete set null,
  replaces_deposit_id   uuid references public.deposits (id) on delete set null,
  instrument_type       public.instrument_type not null default 'fdr',
  instrument_number     text not null check (length(trim(instrument_number)) > 0),
  bank_name             text not null check (length(trim(bank_name)) > 0),
  bank_branch           text,
  ifsc                  text,
  amount                numeric(14, 2) not null check (amount > 0),
  interest_rate         numeric(5, 2),
  issue_date            date not null,
  maturity_date         date not null,
  auto_renewal          boolean not null default false,
  approval_case_id      text,
  program               text,
  approval_valid_until  date,
  required_amount       numeric(14, 2),
  status                public.deposit_status not null default 'draft',
  bank_check            public.bank_check not null default 'not_requested',
  bank_check_ref        text,
  remarks               text,
  created_by            uuid references public.profiles (id) on delete set null default auth.uid(),
  submitted_at          timestamptz,
  submitted_by          uuid references public.profiles (id) on delete set null,
  verified_at           timestamptz,
  verified_by           uuid references public.profiles (id) on delete set null,
  released_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.release_requests (
  id              uuid primary key default gen_random_uuid(),
  reference_no    text not null unique default (
    'RR-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.release_ref_seq')::text, 6, '0')
  ),
  deposit_id      uuid not null references public.deposits (id) on delete cascade,
  institution_id  uuid not null references public.institutions (id) on delete cascade,
  reason          public.release_reason not null,
  details         text,
  status          public.release_status not null default 'draft',
  requested_by    uuid references public.profiles (id) on delete set null default auth.uid(),
  submitted_at    timestamptz,
  decided_by      uuid references public.profiles (id) on delete set null,
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index release_requests_one_open
  on public.release_requests (deposit_id) where status in ('draft', 'submitted');

create table public.deposit_documents (
  id                  uuid primary key default gen_random_uuid(),
  deposit_id          uuid references public.deposits (id) on delete cascade,
  release_request_id  uuid references public.release_requests (id) on delete cascade,
  institution_id      uuid not null references public.institutions (id) on delete cascade,
  doc_type            public.document_type not null,
  storage_path        text not null unique,
  file_name           text not null,
  mime_type           text,
  size_bytes          bigint,
  version             int not null default 1,
  is_current          boolean not null default true,
  uploaded_by         uuid references public.profiles (id) on delete set null default auth.uid(),
  uploaded_at         timestamptz not null default now(),
  constraint document_owner check (deposit_id is not null or release_request_id is not null)
);

create table public.discrepancies (
  id               uuid primary key default gen_random_uuid(),
  deposit_id       uuid not null references public.deposits (id) on delete cascade,
  institution_id   uuid not null references public.institutions (id) on delete cascade,
  code             text not null,
  severity         text not null check (severity in ('error', 'warning')),
  message          text not null,
  source           text not null default 'system' check (source in ('system', 'officer')),
  raised_by        uuid references public.profiles (id) on delete set null,
  resolved_at      timestamptz,
  resolved_by      uuid references public.profiles (id) on delete set null,
  resolution_note  text,
  created_at       timestamptz not null default now()
);

create table public.comments (
  id                  uuid primary key default gen_random_uuid(),
  deposit_id          uuid references public.deposits (id) on delete cascade,
  release_request_id  uuid references public.release_requests (id) on delete cascade,
  institution_id      uuid not null references public.institutions (id) on delete cascade,
  author_id           uuid references public.profiles (id) on delete set null default auth.uid(),
  body                text not null check (length(trim(body)) between 1 and 4000),
  created_at          timestamptz not null default now(),
  constraint comment_target check (deposit_id is not null or release_request_id is not null)
);

create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid references public.institutions (id) on delete cascade,
  deposit_id      uuid references public.deposits (id) on delete cascade,
  demand_id       uuid references public.deposit_demands (id) on delete cascade,
  kind            text not null,
  severity        text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  audience        text not null default 'all' check (audience in ('all', 'institution', 'officials')),
  title           text not null,
  body            text,
  dedupe_key      text unique,
  emailed_at      timestamptz,
  created_at      timestamptz not null default now()
);

create table public.notification_reads (
  notification_id  uuid not null references public.notifications (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  read_at          timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create table public.audit_logs (
  id              bigint generated always as identity primary key,
  occurred_at     timestamptz not null default now(),
  actor_id        uuid,
  actor_email     text,
  actor_role      public.app_role,
  action          text not null,
  entity_type     text not null,
  entity_id       uuid,
  institution_id  uuid,
  deposit_id      uuid,
  summary         text,
  changes         jsonb
);

create index deposits_institution_idx on public.deposits (institution_id);
create index deposits_status_idx on public.deposits (status);
create index deposits_maturity_idx on public.deposits (maturity_date);
create index deposits_instrument_idx on public.deposits (lower(bank_name), lower(trim(instrument_number)));
create index demands_institution_idx on public.deposit_demands (institution_id);
create index documents_deposit_idx on public.deposit_documents (deposit_id);
create index documents_release_idx on public.deposit_documents (release_request_id);
create index discrepancies_deposit_idx on public.discrepancies (deposit_id);
create index comments_deposit_idx on public.comments (deposit_id);
create index comments_release_idx on public.comments (release_request_id);
create index release_deposit_idx on public.release_requests (deposit_id);
create index notifications_inst_idx on public.notifications (institution_id, created_at desc);
create index audit_deposit_idx on public.audit_logs (deposit_id, occurred_at desc);
create index audit_inst_idx on public.audit_logs (institution_id, occurred_at desc);
create index audit_time_idx on public.audit_logs (occurred_at desc);
create index profiles_institution_idx on public.profiles (institution_id);

create trigger institutions_updated before update on public.institutions
  for each row execute function public.set_updated_at();
create trigger profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger demands_updated before update on public.deposit_demands
  for each row execute function public.set_updated_at();
create trigger releases_updated before update on public.release_requests
  for each row execute function public.set_updated_at();
create trigger settings_updated before update on public.app_settings
  for each row execute function public.set_updated_at();

-------------------------------------------------------------------------------
-- Access helpers (SECURITY DEFINER so they can read profiles under RLS)
-------------------------------------------------------------------------------
create or replace function public.my_role()
returns public.app_role language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.my_institution()
returns uuid language sql stable security definer set search_path = '' as $$
  select institution_id from public.profiles
  where id = auth.uid() and is_active and role = 'institute_user'
$$;

create or replace function public.is_official()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select role in ('regional_officer', 'aicte_verifier', 'admin')
       from public.profiles where id = auth.uid() and is_active),
    false)
$$;

-- Can the caller see records belonging to this institution?
create or replace function public.can_access_institution(p_institution uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and (
      p.role in ('aicte_verifier', 'admin')
      or (p.role = 'institute_user' and p.institution_id = p_institution)
      or (p.role = 'regional_officer' and exists (
            select 1 from public.institutions i
            where i.id = p_institution and i.region = p.region))
    )
  )
$$;

-- Can the caller verify / decide on records of this institution?
create or replace function public.is_reviewer(p_institution uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and (
      p.role in ('aicte_verifier', 'admin')
      or (p.role = 'regional_officer' and exists (
            select 1 from public.institutions i
            where i.id = p_institution and i.region = p.region))
    )
  )
$$;

-------------------------------------------------------------------------------
-- New auth users -> profiles. Role/scope come from app_metadata, which only
-- the service role can set (user_metadata is user-controlled and ignored).
-------------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, designation, role, institution_id, region)
  values (
    new.id,
    new.email,
    coalesce(new.raw_app_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'full_name'),
    new.raw_app_meta_data ->> 'designation',
    (new.raw_app_meta_data ->> 'role')::public.app_role,
    public.try_uuid(new.raw_app_meta_data ->> 'institution_id'),
    (new.raw_app_meta_data ->> 'region')::public.aicte_region
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-------------------------------------------------------------------------------
-- Audit trail
-------------------------------------------------------------------------------
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old      jsonb;
  v_new      jsonb;
  v_changes  jsonb := '{}'::jsonb;
  v_key      text;
  v_entity   uuid;
  v_inst     uuid;
  v_dep      uuid;
  v_action   text := lower(tg_op);
  v_summary  text;
  v_note     text := nullif(current_setting('app.audit_note', true), '');
  v_actor    uuid := auth.uid();
  v_email    text;
  v_role     public.app_role;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;

  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key <> 'updated_at' and (v_new -> v_key) is distinct from (v_old -> v_key) then
        v_changes := v_changes || jsonb_build_object(
          v_key, jsonb_build_object('from', v_old -> v_key, 'to', v_new -> v_key));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return null;
    end if;
    if v_changes ? 'status' then
      v_action := 'status_change';
      v_summary := format('Status changed from %s to %s', v_old ->> 'status', v_new ->> 'status');
    else
      v_summary := 'Updated ' || (select string_agg(k, ', ') from jsonb_object_keys(v_changes) k);
    end if;
  elsif tg_op = 'INSERT' then
    v_changes := v_new;
    v_summary := 'Created';
  else
    v_changes := v_old;
    v_summary := 'Deleted';
  end if;

  if v_note is not null then
    v_summary := v_summary || ' — ' || v_note;
  end if;

  v_entity := public.try_uuid(coalesce(v_new ->> 'id', v_old ->> 'id'));
  v_inst := case tg_table_name
    when 'institutions' then v_entity
    else public.try_uuid(coalesce(v_new ->> 'institution_id', v_old ->> 'institution_id'))
  end;
  v_dep := case tg_table_name
    when 'deposits' then v_entity
    else public.try_uuid(coalesce(v_new ->> 'deposit_id', v_old ->> 'deposit_id'))
  end;

  select p.email, p.role into v_email, v_role from public.profiles p where p.id = v_actor;

  insert into public.audit_logs
    (actor_id, actor_email, actor_role, action, entity_type, entity_id,
     institution_id, deposit_id, summary, changes)
  values
    (v_actor, v_email, v_role, v_action, tg_table_name, v_entity,
     v_inst, v_dep, v_summary, v_changes);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'institutions', 'profiles', 'deposit_demands', 'deposits', 'deposit_documents',
    'discrepancies', 'release_requests', 'comments', 'app_settings'
  ] loop
    execute format(
      'create trigger audit_%1$s after insert or update or delete on public.%1$I
         for each row execute function public.audit_row()', t);
  end loop;
end $$;

create or replace function public.log_event(p_action text, p_summary text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_action not in ('login', 'logout', 'document.view', 'report.export', 'user.create') then
    raise exception 'Unsupported audit action %', p_action;
  end if;
  if p_action = 'user.create' and public.my_role() is distinct from 'admin' then
    raise exception 'Not allowed';
  end if;
  insert into public.audit_logs (actor_id, actor_email, actor_role, action, entity_type, entity_id, institution_id, summary)
  select p.id, p.email, p.role, p_action, 'session', p.id, p.institution_id, left(p_summary, 500)
  from public.profiles p where p.id = auth.uid();
end $$;

-------------------------------------------------------------------------------
-- Integrity triggers
-------------------------------------------------------------------------------
create or replace function public.demands_before_write()
returns trigger language plpgsql as $$
begin
  if new.due_date is null then
    new.due_date := new.intimation_date
      + (select submission_window_days from public.app_settings where id);
  end if;
  return new;
end $$;

create trigger demands_before_write before insert or update on public.deposit_demands
  for each row execute function public.demands_before_write();

-- Runs with the caller's privileges (NOT security definer) so that
-- current_user tells us whether the write came straight from the API
-- ('authenticated') or from a trusted workflow function (owner role).
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
    else
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
         or new.bank_check_ref is distinct from old.bank_check_ref then
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

create trigger deposits_before_write before insert or update on public.deposits
  for each row execute function public.deposits_before_write();

create or replace function public.documents_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_inst uuid;
begin
  if new.deposit_id is not null then
    select institution_id into v_inst from public.deposits where id = new.deposit_id;
  else
    select institution_id, deposit_id into v_inst, new.deposit_id
    from public.release_requests where id = new.release_request_id;
  end if;
  if v_inst is null then
    raise exception 'Document target not found';
  end if;
  new.institution_id := v_inst;
  new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
  new.uploaded_at := now();

  if split_part(new.storage_path, '/', 1) <> v_inst::text then
    raise exception 'Storage path must be inside the institution folder';
  end if;

  select coalesce(max(version), 0) + 1 into new.version
  from public.deposit_documents
  where doc_type = new.doc_type
    and deposit_id is not distinct from new.deposit_id
    and release_request_id is not distinct from new.release_request_id;

  update public.deposit_documents set is_current = false
  where doc_type = new.doc_type
    and deposit_id is not distinct from new.deposit_id
    and release_request_id is not distinct from new.release_request_id
    and is_current;
  new.is_current := true;
  return new;
end $$;

create trigger documents_before_insert before insert on public.deposit_documents
  for each row execute function public.documents_before_insert();

create or replace function public.documents_after_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.is_current then
    update public.deposit_documents set is_current = true
    where id = (
      select id from public.deposit_documents
      where doc_type = old.doc_type
        and deposit_id is not distinct from old.deposit_id
        and release_request_id is not distinct from old.release_request_id
      order by version desc limit 1);
  end if;
  return null;
end $$;

create trigger documents_after_delete after delete on public.deposit_documents
  for each row execute function public.documents_after_delete();

create or replace function public.comments_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.deposit_id is not null then
    select institution_id into new.institution_id from public.deposits where id = new.deposit_id;
  else
    select institution_id into new.institution_id from public.release_requests where id = new.release_request_id;
  end if;
  new.author_id := coalesce(auth.uid(), new.author_id);
  new.created_at := now();
  return new;
end $$;

create trigger comments_before_insert before insert on public.comments
  for each row execute function public.comments_before_insert();

-- Status-change notifications to the institution.
create or replace function public.notify_deposit_status()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_title    text;
  v_sev      text := 'info';
  v_audience text := 'institution';
begin
  if new.status is not distinct from old.status then
    return null;
  end if;
  v_title := case new.status
    when 'submitted' then 'Deposit ' || new.reference_no || ' submitted for verification'
    when 'verified' then 'Deposit ' || new.reference_no || ' verified'
    when 'discrepancy' then 'Deposit ' || new.reference_no || ' returned with discrepancies'
    when 'rejected' then 'Deposit ' || new.reference_no || ' rejected'
    when 'released' then 'Deposit ' || new.reference_no || ' released'
    when 'replaced' then 'Deposit ' || new.reference_no || ' replaced by a renewed instrument'
    when 'release_requested' then 'Release requested for deposit ' || new.reference_no
  end;
  if v_title is null then
    return null;
  end if;
  if new.status in ('discrepancy', 'rejected') then v_sev := 'warning'; end if;
  if new.status in ('submitted', 'release_requested') then v_audience := 'officials'; end if;
  insert into public.notifications (institution_id, deposit_id, kind, severity, audience, title, body)
  values (new.institution_id, new.id, 'status_change', v_sev, v_audience, v_title,
          nullif(current_setting('app.audit_note', true), ''));
  return null;
end $$;

create trigger deposits_notify_status after update on public.deposits
  for each row execute function public.notify_deposit_status();

-- New demand: tell the institution what to furnish and by when.
create or replace function public.notify_new_demand()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (institution_id, demand_id, kind, severity, audience, title, body, dedupe_key)
  values (new.institution_id, new.id, 'demand_issued', 'info', 'institution',
          format('Security deposit required for %s', new.approval_case_id),
          format('Furnish a deposit of ₹%s by %s (demand %s).',
                 to_char(new.required_amount, 'FM99,99,99,99,990.00'),
                 to_char(new.due_date, 'DD Mon YYYY'), new.reference_no),
          format('demand_issued:%s', new.id))
  on conflict (dedupe_key) do nothing;
  return null;
end $$;

create trigger demands_notify_new after insert on public.deposit_demands
  for each row execute function public.notify_new_demand();

-------------------------------------------------------------------------------
-- Views (security_invoker => caller's RLS applies)
-------------------------------------------------------------------------------
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

create view public.demand_overview with (security_invoker = true) as
select
  m.*,
  i.name     as institution_name,
  i.aicte_id as institution_aicte_id,
  i.region,
  (select count(*) from public.deposits d
    where d.demand_id = m.id and d.status not in ('draft', 'rejected'))::int as deposits_submitted,
  (m.status = 'open' and m.due_date < current_date and not exists (
    select 1 from public.deposits d
    where d.demand_id = m.id and d.status not in ('draft', 'rejected'))) as is_overdue
from public.deposit_demands m
join public.institutions i on i.id = m.institution_id;

create view public.release_overview with (security_invoker = true) as
select
  r.*,
  d.reference_no      as deposit_reference_no,
  d.instrument_number,
  d.bank_name,
  d.amount,
  d.maturity_date,
  i.name              as institution_name,
  i.aicte_id          as institution_aicte_id,
  i.region
from public.release_requests r
join public.deposits d on d.id = r.deposit_id
join public.institutions i on i.id = r.institution_id;

-------------------------------------------------------------------------------
-- Rule engine: discrepancy detection
-------------------------------------------------------------------------------
-- severity: 'blocker' (cannot submit), 'error' (flag for review), 'warning'
create or replace function public.deposit_checks(p_deposit uuid)
returns table (code text, severity text, message text)
language plpgsql stable security definer set search_path = '' as $$
declare
  d public.deposits;
  s public.app_settings;
  t public.document_type;
  v_max_alert int;
begin
  select * into d from public.deposits where id = p_deposit;
  if d.id is null or not public.can_access_institution(d.institution_id) then
    raise exception 'Deposit not found';
  end if;
  select * into s from public.app_settings where id;
  select coalesce(max(x), 60) into v_max_alert from unnest(s.alert_days) x;

  foreach t in array s.required_documents loop
    if not exists (select 1 from public.deposit_documents doc
                   where doc.deposit_id = d.id and doc.release_request_id is null
                     and doc.doc_type = t and doc.is_current) then
      code := 'MISSING_DOCUMENT'; severity := 'blocker';
      message := 'Required document missing: ' || replace(t::text, '_', ' ');
      return next;
    end if;
  end loop;

  if d.maturity_date <= d.issue_date then
    code := 'MATURITY_BEFORE_ISSUE'; severity := 'error';
    message := format('Maturity date %s is not after issue date %s.', d.maturity_date, d.issue_date);
    return next;
  end if;
  if d.issue_date > current_date then
    code := 'ISSUE_DATE_IN_FUTURE'; severity := 'error';
    message := format('Issue date %s is in the future.', d.issue_date);
    return next;
  end if;
  if d.maturity_date <= current_date then
    code := 'ALREADY_MATURED'; severity := 'error';
    message := format('Instrument matured on %s; a valid instrument is required.', d.maturity_date);
    return next;
  elsif d.maturity_date <= current_date + v_max_alert then
    code := 'MATURING_SOON'; severity := 'warning';
    message := format('Instrument matures in %s days (%s). Plan renewal.', d.maturity_date - current_date, d.maturity_date);
    return next;
  end if;
  if d.approval_valid_until is not null and d.maturity_date < d.approval_valid_until then
    code := 'MATURITY_BEFORE_APPROVAL_END'; severity := 'error';
    message := format('Instrument matures on %s, before the approval period ends on %s.',
                      d.maturity_date, d.approval_valid_until);
    return next;
  end if;
  if d.required_amount is not null and d.amount < d.required_amount then
    code := 'AMOUNT_BELOW_REQUIRED'; severity := 'error';
    message := format('Deposit amount ₹%s is less than the required ₹%s.',
                      to_char(d.amount, 'FM99,99,99,99,990.00'),
                      to_char(d.required_amount, 'FM99,99,99,99,990.00'));
    return next;
  end if;
  if exists (select 1 from public.deposits o
             where o.id <> d.id
               and lower(o.bank_name) = lower(d.bank_name)
               and lower(trim(o.instrument_number)) = lower(trim(d.instrument_number))
               and o.status not in ('rejected', 'draft')) then
    code := 'DUPLICATE_INSTRUMENT'; severity := 'error';
    message := format('Instrument %s from %s is already registered against another deposit.',
                      d.instrument_number, d.bank_name);
    return next;
  end if;
  if d.ifsc is not null and d.ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then
    code := 'IFSC_FORMAT'; severity := 'warning';
    message := format('IFSC "%s" does not look valid (expected e.g. SBIN0001234).', d.ifsc);
    return next;
  end if;
  if d.instrument_type = 'jfdr' and d.auto_renewal is false then
    code := 'JFDR_NO_AUTO_RENEWAL'; severity := 'warning';
    message := 'Joint FDRs in favour of AICTE are normally auto-renewable; confirm with the bank.';
    return next;
  end if;
  return;
end $$;

-------------------------------------------------------------------------------
-- Workflow functions
-------------------------------------------------------------------------------
create or replace function public.submit_deposit(p_deposit uuid)
returns public.deposits
language plpgsql security definer set search_path = '' as $$
declare
  d public.deposits;
  v_blockers text;
begin
  select * into d from public.deposits where id = p_deposit for update;
  if d.id is null or public.my_role() <> 'institute_user'
     or d.institution_id is distinct from public.my_institution() then
    raise exception 'Deposit not found';
  end if;
  if d.status not in ('draft', 'discrepancy') then
    raise exception 'Only draft or returned deposits can be submitted (current status: %)', d.status;
  end if;

  select string_agg(c.message, '; ') into v_blockers
  from public.deposit_checks(d.id) c where c.severity = 'blocker';
  if v_blockers is not null then
    raise exception 'Cannot submit: %', v_blockers using errcode = 'P0001';
  end if;

  -- Re-evaluate automatic flags.
  delete from public.discrepancies
  where deposit_id = d.id and source = 'system' and resolved_at is null;
  insert into public.discrepancies (deposit_id, institution_id, code, severity, message, source)
  select d.id, d.institution_id, c.code, c.severity, c.message, 'system'
  from public.deposit_checks(d.id) c where c.severity in ('error', 'warning');

  update public.deposits
     set status = 'submitted', submitted_at = now(), submitted_by = auth.uid()
   where id = d.id
  returning * into d;
  return d;
end $$;

create or replace function public.review_deposit(
  p_deposit uuid, p_decision text, p_note text default null, p_override boolean default false)
returns public.deposits
language plpgsql security definer set search_path = '' as $$
declare
  d public.deposits;
  v_note text := nullif(trim(p_note), '');
  v_open int;
begin
  select * into d from public.deposits where id = p_deposit for update;
  if d.id is null or not public.is_reviewer(d.institution_id) then
    raise exception 'Deposit not found';
  end if;
  if d.status <> 'submitted' then
    raise exception 'Only submitted deposits can be reviewed (current status: %)', d.status;
  end if;
  if p_decision not in ('verify', 'return', 'reject') then
    raise exception 'Unknown decision %', p_decision;
  end if;
  if p_decision in ('return', 'reject') and v_note is null then
    raise exception 'A note explaining the decision is required';
  end if;

  if v_note is not null then
    perform set_config('app.audit_note', left(v_note, 500), true);
  end if;

  if p_decision = 'verify' then
    select count(*) into v_open from public.discrepancies
    where deposit_id = d.id and resolved_at is null and severity = 'error';
    if v_open > 0 and not p_override then
      raise exception '% open discrepancy flag(s). Resolve them or verify with an override note.', v_open;
    end if;
    if v_open > 0 and v_note is null then
      raise exception 'An override note is required when verifying with open flags';
    end if;
    update public.discrepancies
       set resolved_at = now(), resolved_by = auth.uid(),
           resolution_note = coalesce(v_note, 'Accepted on verification')
     where deposit_id = d.id and resolved_at is null;

    update public.deposits
       set status = 'verified', verified_at = now(), verified_by = auth.uid()
     where id = d.id returning * into d;

    if d.replaces_deposit_id is not null then
      perform set_config('app.audit_note', 'Replaced by renewal ' || d.reference_no, true);
      update public.deposits set status = 'replaced'
       where id = d.replaces_deposit_id and status in ('verified', 'release_requested');
      update public.release_requests set status = 'withdrawn',
             decision_note = 'Superseded by renewal ' || d.reference_no
       where deposit_id = d.replaces_deposit_id and status in ('draft', 'submitted');
    end if;
    if d.demand_id is not null then
      update public.deposit_demands set status = 'fulfilled'
       where id = d.demand_id and status = 'open';
    end if;
  elsif p_decision = 'return' then
    insert into public.discrepancies (deposit_id, institution_id, code, severity, message, source, raised_by)
    values (d.id, d.institution_id, 'OFFICER_QUERY', 'error', v_note, 'officer', auth.uid());
    update public.deposits set status = 'discrepancy' where id = d.id returning * into d;
  else
    update public.deposits set status = 'rejected' where id = d.id returning * into d;
  end if;

  if v_note is not null then
    insert into public.comments (deposit_id, institution_id, author_id, body)
    values (d.id, d.institution_id, auth.uid(),
            '[' || initcap(p_decision) || '] ' || v_note);
  end if;
  return d;
end $$;

create or replace function public.resolve_discrepancy(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  x public.discrepancies;
begin
  select * into x from public.discrepancies where id = p_id;
  if x.id is null or not public.is_reviewer(x.institution_id) then
    raise exception 'Discrepancy not found';
  end if;
  update public.discrepancies
     set resolved_at = now(), resolved_by = auth.uid(), resolution_note = nullif(trim(p_note), '')
   where id = p_id and resolved_at is null;
end $$;

create or replace function public.set_bank_check(p_deposit uuid, p_status public.bank_check, p_ref text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d public.deposits;
begin
  select * into d from public.deposits where id = p_deposit;
  if d.id is null or not public.is_reviewer(d.institution_id) then
    raise exception 'Deposit not found';
  end if;
  update public.deposits set bank_check = p_status, bank_check_ref = nullif(trim(p_ref), '')
   where id = p_deposit;
  if p_status = 'mismatch' then
    insert into public.discrepancies (deposit_id, institution_id, code, severity, message, source, raised_by)
    values (d.id, d.institution_id, 'BANK_MISMATCH', 'error',
            'Bank confirmation does not match submitted details' ||
            coalesce(' (ref ' || nullif(trim(p_ref), '') || ')', ''), 'officer', auth.uid());
  end if;
end $$;

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
    return v_id;
  end if;
  insert into public.release_requests (deposit_id, institution_id, reason, details, requested_by)
  values (d.id, d.institution_id, p_reason, nullif(trim(p_details), ''), auth.uid())
  returning id into v_id;
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
end $$;

create or replace function public.withdraw_release_request(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.release_requests;
begin
  select * into r from public.release_requests where id = p_id for update;
  if r.id is null or public.my_role() <> 'institute_user'
     or r.institution_id is distinct from public.my_institution() then
    raise exception 'Release request not found';
  end if;
  if r.status not in ('draft', 'submitted') then
    raise exception 'Release request already %', r.status;
  end if;
  update public.release_requests set status = 'withdrawn' where id = r.id;
  if r.status = 'submitted' then
    update public.deposits set status = 'verified'
     where id = r.deposit_id and status = 'release_requested';
  end if;
end $$;

create or replace function public.decide_release(p_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.release_requests;
  v_note text := nullif(trim(p_note), '');
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

  update public.release_requests
     set status = case p_decision when 'approve' then 'approved' else 'rejected' end::public.release_status,
         decided_by = auth.uid(), decided_at = now(), decision_note = v_note
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

-- Admin edits go through this function (not the service role) so the audit
-- trail records which admin made the change.
create or replace function public.admin_update_profile(
  p_id uuid,
  p_role public.app_role,
  p_institution uuid,
  p_region public.aicte_region,
  p_full_name text,
  p_designation text,
  p_active boolean)
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
    full_name = nullif(trim(p_full_name), ''),
    designation = nullif(trim(p_designation), ''),
    is_active = p_active
  where id = p_id;
  if not found then
    raise exception 'User not found';
  end if;
end $$;

-------------------------------------------------------------------------------
-- Dashboard aggregate (security invoker: respects caller's RLS scope)
-------------------------------------------------------------------------------
create or replace function public.dashboard_stats()
returns jsonb language sql stable security invoker set search_path = '' as $$
  with d as (select * from public.deposit_overview),
  held as (select * from d where status in ('verified', 'release_requested'))
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

-------------------------------------------------------------------------------
-- Notification feed (security invoker: RLS decides what the caller sees)
-------------------------------------------------------------------------------
create or replace function public.notification_feed(p_limit int default 50, p_unread_only boolean default false)
returns table (
  id uuid, institution_id uuid, deposit_id uuid, demand_id uuid, kind text, severity text,
  title text, body text, created_at timestamptz, is_read boolean, institution_name text)
language sql stable security invoker set search_path = '' as $$
  select n.id, n.institution_id, n.deposit_id, n.demand_id, n.kind, n.severity,
         n.title, n.body, n.created_at, r.notification_id is not null, i.name
  from public.notifications n
  left join public.notification_reads r on r.notification_id = n.id and r.user_id = auth.uid()
  left join public.institutions i on i.id = n.institution_id
  where not p_unread_only or r.notification_id is null
  order by n.created_at desc
  limit least(greatest(p_limit, 1), 500)
$$;

create or replace function public.unread_notification_count()
returns int language sql stable security invoker set search_path = '' as $$
  select count(*)::int
  from public.notifications n
  where n.created_at > now() - interval '90 days'
    and not exists (select 1 from public.notification_reads r
                    where r.notification_id = n.id and r.user_id = auth.uid())
$$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void language sql security invoker set search_path = '' as $$
  insert into public.notification_reads (notification_id, user_id)
  select n.id, auth.uid() from public.notifications n
  where p_ids is null or n.id = any (p_ids)
  on conflict do nothing
$$;

-------------------------------------------------------------------------------
-- Scheduled alerts (called daily by the Vercel cron with the service role)
-------------------------------------------------------------------------------
create or replace function public.run_alerts()
returns int language plpgsql security definer set search_path = '' as $$
declare
  s public.app_settings;
  v_count int := 0;
  v_n int;
begin
  select * into s from public.app_settings where id;

  -- Upcoming maturities: one notification per threshold crossed.
  insert into public.notifications (institution_id, deposit_id, kind, severity, title, body, dedupe_key)
  select d.institution_id, d.id, 'maturity_' || t.days,
         case when t.days <= 7 then 'critical' when t.days <= 30 then 'warning' else 'info' end,
         format('Deposit %s matures in %s days', d.reference_no, d.maturity_date - current_date),
         format('%s %s (%s) for ₹%s matures on %s. Submit a renewed instrument before maturity to stay compliant.',
                upper(d.instrument_type::text), d.instrument_number, d.bank_name,
                to_char(d.amount, 'FM99,99,99,99,990.00'), to_char(d.maturity_date, 'DD Mon YYYY')),
         format('maturity:%s:%s:%s', d.id, t.days, d.maturity_date)
  from public.deposits d
  cross join lateral (
    select min(x) as days from unnest(s.alert_days) x
    where d.maturity_date - current_date <= x
  ) t
  where d.status in ('verified', 'release_requested')
    and d.maturity_date > current_date
    and t.days is not null
    and not exists (select 1 from public.deposits r
                    where r.replaces_deposit_id = d.id and r.status in ('submitted', 'verified'))
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_count := v_count + v_n;

  -- Lapsed deposits.
  insert into public.notifications (institution_id, deposit_id, kind, severity, title, body, dedupe_key)
  select d.institution_id, d.id, 'expired', 'critical',
         format('Deposit %s has matured without renewal', d.reference_no),
         format('The instrument matured on %s. A renewed instrument must be submitted immediately.',
                to_char(d.maturity_date, 'DD Mon YYYY')),
         format('expired:%s:%s', d.id, d.maturity_date)
  from public.deposits d
  where d.status in ('verified', 'release_requested')
    and d.maturity_date <= current_date
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_count := v_count + v_n;

  -- Escalation: still lapsed after the escalation window.
  insert into public.notifications (institution_id, deposit_id, kind, severity, title, body, dedupe_key)
  select d.institution_id, d.id, 'escalation', 'critical',
         format('ESCALATION: %s lapsed %s days ago', d.reference_no, current_date - d.maturity_date),
         'No renewed instrument has been verified. Escalated to the AICTE Approval Bureau.',
         format('escalation:%s:%s', d.id, d.maturity_date)
  from public.deposits d
  where d.status in ('verified', 'release_requested')
    and d.maturity_date <= current_date - s.escalation_days
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_count := v_count + v_n;

  -- Overdue demands (no deposit furnished within the submission window).
  insert into public.notifications (institution_id, demand_id, kind, severity, title, body, dedupe_key)
  select m.institution_id, m.id, 'demand_overdue', 'critical',
         format('Security deposit overdue for %s', m.approval_case_id),
         format('Deposit of ₹%s was due by %s (demand %s).',
                to_char(m.required_amount, 'FM99,99,99,99,990.00'),
                to_char(m.due_date, 'DD Mon YYYY'), m.reference_no),
         format('demand_overdue:%s', m.id)
  from public.deposit_demands m
  where m.status = 'open' and m.due_date < current_date
    and not exists (select 1 from public.deposits d
                    where d.demand_id = m.id and d.status not in ('draft', 'rejected'))
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_count := v_count + v_n;

  return v_count;
end $$;

-------------------------------------------------------------------------------
-- Row Level Security
-------------------------------------------------------------------------------
alter table public.institutions enable row level security;
alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.deposit_demands enable row level security;
alter table public.deposits enable row level security;
alter table public.release_requests enable row level security;
alter table public.deposit_documents enable row level security;
alter table public.discrepancies enable row level security;
alter table public.comments enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;
alter table public.audit_logs enable row level security;

-- institutions
create policy institutions_select on public.institutions for select to authenticated
  using (public.can_access_institution(id));
create policy institutions_admin on public.institutions for all to authenticated
  using ((select public.my_role()) = 'admin') with check ((select public.my_role()) = 'admin');

-- profiles: officials see everyone (names on comments / audit); institute
-- users see themselves, colleagues and officials.
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.is_official())
    or institution_id = (select public.my_institution())
    or role in ('regional_officer', 'aicte_verifier', 'admin')
  );
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke update on public.profiles from authenticated, anon;
grant update (full_name, designation) on public.profiles to authenticated;

-- settings
create policy settings_select on public.app_settings for select to authenticated using (true);
create policy settings_admin on public.app_settings for update to authenticated
  using ((select public.my_role()) = 'admin') with check ((select public.my_role()) = 'admin');

-- demands: officials manage within scope
create policy demands_select on public.deposit_demands for select to authenticated
  using (public.can_access_institution(institution_id));
create policy demands_insert on public.deposit_demands for insert to authenticated
  with check (public.is_reviewer(institution_id));
create policy demands_update on public.deposit_demands for update to authenticated
  using (public.is_reviewer(institution_id)) with check (public.is_reviewer(institution_id));

-- deposits: institutes create/edit their own drafts; everything else via functions
create policy deposits_select on public.deposits for select to authenticated
  using (public.can_access_institution(institution_id));
create policy deposits_insert on public.deposits for insert to authenticated
  with check (
    (select public.my_role()) = 'institute_user'
    and institution_id = (select public.my_institution())
  );
create policy deposits_update on public.deposits for update to authenticated
  using (
    (select public.my_role()) = 'institute_user'
    and institution_id = (select public.my_institution())
    and status in ('draft', 'discrepancy')
  )
  with check (
    institution_id = (select public.my_institution())
    and status in ('draft', 'discrepancy')
  );
create policy deposits_delete on public.deposits for delete to authenticated
  using (
    (select public.my_role()) = 'institute_user'
    and institution_id = (select public.my_institution())
    and status = 'draft'
  );

-- release requests: read in scope; writes via functions only
create policy releases_select on public.release_requests for select to authenticated
  using (public.can_access_institution(institution_id));

-- documents
create policy documents_select on public.deposit_documents for select to authenticated
  using (public.can_access_institution(institution_id));
create policy documents_insert on public.deposit_documents for insert to authenticated
  with check (
    (
      (select public.my_role()) = 'institute_user'
      and institution_id = (select public.my_institution())
      and (
        (release_request_id is null and exists (
          select 1 from public.deposits d
          where d.id = deposit_id and d.status in ('draft', 'discrepancy')))
        or (release_request_id is not null and exists (
          select 1 from public.release_requests r
          where r.id = release_request_id and r.status = 'draft'))
      )
    )
    or public.is_reviewer(institution_id)
  );
create policy documents_delete on public.deposit_documents for delete to authenticated
  using (
    uploaded_by = (select auth.uid())
    and (
      (release_request_id is null and exists (
        select 1 from public.deposits d where d.id = deposit_id and d.status = 'draft'))
      or (release_request_id is not null and exists (
        select 1 from public.release_requests r where r.id = release_request_id and r.status = 'draft'))
    )
  );

-- discrepancies: read in scope; writes via functions only
create policy discrepancies_select on public.discrepancies for select to authenticated
  using (public.can_access_institution(institution_id));

-- comments
create policy comments_select on public.comments for select to authenticated
  using (public.can_access_institution(institution_id));
create policy comments_insert on public.comments for insert to authenticated
  with check (author_id = (select auth.uid()) and public.can_access_institution(institution_id));

-- notifications
create policy notifications_select on public.notifications for select to authenticated
  using (
    institution_id is not null
    and public.can_access_institution(institution_id)
    and (audience = 'all'
         or (audience = 'institution') = ((select public.my_role()) = 'institute_user'))
  );
create policy notification_reads_select on public.notification_reads for select to authenticated
  using (user_id = (select auth.uid()));
create policy notification_reads_insert on public.notification_reads for insert to authenticated
  with check (user_id = (select auth.uid()));

-- audit: append-only, read in scope
create policy audit_select on public.audit_logs for select to authenticated
  using (
    (select public.my_role()) = 'admin'
    or (institution_id is not null and public.can_access_institution(institution_id))
  );
revoke insert, update, delete, truncate on public.audit_logs from authenticated, anon;

-- Function privileges: nothing for anon; signed-in users get the helpers and
-- workflow functions (each checks role/scope itself); the alert job is
-- service-role only.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function
  public.run_alerts(),
  public.handle_new_user(),
  public.audit_row(),
  public.deposits_before_write(),
  public.documents_before_insert(),
  public.documents_after_delete(),
  public.comments_before_insert(),
  public.notify_deposit_status(),
  public.notify_new_demand(),
  public.demands_before_write(),
  public.set_updated_at()
from authenticated;

grant usage on sequence public.demand_ref_seq, public.deposit_ref_seq, public.release_ref_seq to authenticated;

-------------------------------------------------------------------------------
-- Storage: private bucket, files stored under <institution_id>/...
-------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('deposit-documents', 'deposit-documents', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "deposit docs read" on storage.objects for select to authenticated
  using (
    bucket_id = 'deposit-documents'
    and public.can_access_institution(public.try_uuid((storage.foldername(name))[1]))
  );
create policy "deposit docs upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'deposit-documents'
    and (
      (storage.foldername(name))[1] = (select public.my_institution())::text
      or public.is_reviewer(public.try_uuid((storage.foldername(name))[1]))
    )
  );
create policy "deposit docs delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'deposit-documents' and owner_id = (select auth.uid())::text);
