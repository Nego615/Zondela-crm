-- ============================================================================
-- CREATE THE FIRST SUPER ADMIN
-- ============================================================================
-- Run this once, in the Supabase SQL editor, after schema.sql.
--
-- There is no public signup in this system, so the first account cannot come
-- from the app. It comes from here — a script that only someone with database
-- access can run. bootstrap_super_admin() has execute revoked from the `anon`
-- and `authenticated` roles, so it is not reachable over the API however hard
-- anyone pokes at it.
--
-- Before running:
--   1. Supabase dashboard -> Authentication -> Users -> "Add user" ->
--      "Send invitation" (or "Create new user" with a password you set).
--      Use the email address that will own the system.
--   2. Change the email on the last line below to that address.
--   3. Run this file.
--
-- Afterwards that person signs in and creates everyone else from
-- Admin -> Users. They never need the SQL editor again.
--
-- Safe to re-run, and safe to point at a second address later if you want a
-- second Super Admin — though once you have one, the normal way to make
-- another is Admin -> Users -> Change role.

select public.bootstrap_super_admin('you@example.com');

-- Check it landed:
--   select email, role, status from public.profiles order by created_at;
