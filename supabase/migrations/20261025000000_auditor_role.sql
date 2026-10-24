-- G9 — read-only Auditor role, step 1.
--
-- Postgres cannot use a new enum value in the transaction that adds it, so the
-- value is committed here and every policy/helper that references it lives in
-- 20261025000001_auditor_scope.sql.

alter type public.app_role add value if not exists 'auditor';
