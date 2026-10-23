-- Harden profile provisioning.
--
-- GoTrue creates the auth user and writes raw_app_meta_data in two separate
-- statements, so the on-insert trigger can fire before role / scope are known.
-- Users created from the Supabase dashboard (or any client that sets
-- app_metadata immediately after signup) therefore ended up with a profile that
-- had no role, and the app had to repair it by hand.
--
-- This trigger mirrors app_metadata into the profile whenever it changes.
-- Only the keys present in the new app_metadata are applied, so Supabase's own
-- bookkeeping keys (provider, providers, ...) never touch role or scope. Role,
-- scope and name set by an administrator in the portal stay authoritative until
-- app_metadata itself is written again — that column is service-role only.

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
           else p.region end
   where p.id = new.id;
  return new;
end $$;

create trigger on_auth_user_metadata_updated
  after update of raw_app_meta_data on auth.users
  for each row
  when (old.raw_app_meta_data is distinct from new.raw_app_meta_data)
  execute function public.sync_profile_from_app_metadata();

revoke execute on function public.sync_profile_from_app_metadata() from public, anon, authenticated;
