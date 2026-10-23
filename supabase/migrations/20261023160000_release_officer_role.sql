-- G1 — release clearance workflow, step 1.
--
-- Postgres does not allow a new enum value to be used in the transaction that
-- adds it, so the role is introduced here and everything that references it
-- lives in 20261023160001_release_clearances.sql. Keeping the two apart also
-- means the enum change is committed before the second migration runs.

alter type public.app_role add value if not exists 'release_officer';
