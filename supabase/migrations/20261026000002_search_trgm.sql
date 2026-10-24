-- QW3 — trigram indexes for the ILIKE search paths.
--
-- The sidebar search and the list filters use ILIKE '%term%', which a b-tree
-- cannot serve. pg_trgm makes those scans index-backed as the registers grow.
-- Created concurrently would be preferable in production, but it cannot run
-- inside a migration transaction; these tables are small enough at this point
-- that a plain build is fine.

create extension if not exists pg_trgm;

create index if not exists institutions_name_trgm on public.institutions using gin (name gin_trgm_ops);
create index if not exists institutions_city_trgm on public.institutions using gin (city gin_trgm_ops);
create index if not exists institutions_aicte_id_trgm on public.institutions using gin (aicte_id gin_trgm_ops);

create index if not exists deposits_instrument_trgm on public.deposits using gin (instrument_number gin_trgm_ops);
create index if not exists deposits_bank_trgm on public.deposits using gin (bank_name gin_trgm_ops);
create index if not exists deposits_reference_trgm on public.deposits using gin (reference_no gin_trgm_ops);

create index if not exists demands_case_trgm on public.deposit_demands using gin (approval_case_id gin_trgm_ops);
create index if not exists demands_program_trgm on public.deposit_demands using gin (program gin_trgm_ops);

create index if not exists releases_reference_trgm on public.release_requests using gin (reference_no gin_trgm_ops);
