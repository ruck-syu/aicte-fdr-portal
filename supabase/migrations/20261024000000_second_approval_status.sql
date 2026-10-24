-- G10 — dynamic role-based approvals, step 1.
--
-- Postgres cannot use a new enum value in the transaction that adds it, so the
-- status is introduced on its own and the workflow that writes it lives in
-- 20261024000001_second_approval.sql. (Same split as the release_officer role.)

alter type public.release_status add value if not exists 'pending_second_approval';
