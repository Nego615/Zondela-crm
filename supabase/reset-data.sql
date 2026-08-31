-- ============================================================================
-- RESET DATA — deletes every business record, keeping the schema and logins.
-- ============================================================================
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor). It runs as
-- postgres, so RLS does not apply and it sees every row regardless of owner.
-- The app's anon key cannot do this: RLS hides other people's rows from it.
--
-- THIS IS NOT REVERSIBLE. There is no undo and no soft delete.
-- Take a backup first: Dashboard → Database → Backups.
--
-- Step 1 is a read. Run it on its own, check the numbers, and only then run
-- step 2. If step 1 already reports all zeros, there is nothing to delete.

-- ---------------------------------------------------------------------------
-- STEP 1 — what is actually in there (safe, reads nothing but counts)
-- ---------------------------------------------------------------------------
select 'companies' as table_name, count(*) from companies
union all select 'contacts', count(*) from contacts
union all select 'site_visits', count(*) from site_visits
union all select 'follow_ups', count(*) from follow_ups
union all select 'sent_messages', count(*) from sent_messages
union all select 'sto_rate_card', count(*) from sto_rate_card
union all select 'email_templates', count(*) from email_templates
union all select 'profiles', count(*) from profiles
order by table_name;

-- ---------------------------------------------------------------------------
-- STEP 2 — the delete. Uncomment the block and run it.
-- ---------------------------------------------------------------------------
-- Wrapped in a transaction so a failure part-way leaves nothing half-deleted.
-- Children are deleted before parents: the foreign keys cascade, but being
-- explicit means the row counts it reports are the real ones.

-- begin;
--
--   delete from sent_messages;
--   delete from follow_ups;
--   delete from site_visits;
--   delete from contacts;
--   delete from companies;
--
--   -- Your services and your saved email copy. Drop these two lines to keep
--   -- them; they are the only rows here you might have written for real.
--   delete from sto_rate_card;
--   delete from email_templates;
--
-- commit;

-- ---------------------------------------------------------------------------
-- NOT deleted, on purpose: profiles
-- ---------------------------------------------------------------------------
-- A profile row is the app-side half of a login. The other half lives in
-- auth.users, and deleting the profile alone leaves the account able to sign
-- in with no role — the app then treats them as a rep with nothing visible.
--
-- To remove a person properly, delete the auth user (Dashboard →
-- Authentication → Users). The handle_new_user trigger's counterpart, the
-- foreign key from profiles to auth.users, drops their profile with them.
--
-- To wipe every login and start over, delete all users in that same screen,
-- then re-register. The first person to sign up is not automatically an owner:
-- set that explicitly, as the README describes.
