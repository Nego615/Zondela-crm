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
union all select 'sto_agreements', count(*) from sto_agreements
union all select 'sto_agreement_items', count(*) from sto_agreement_items
union all select 'sto_rate_card', count(*) from sto_rate_card
union all select 'email_templates', count(*) from email_templates
union all select 'profiles', count(*) from profiles
union all select 'activity_logs', count(*) from activity_logs
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
--   -- Items go with their agreement by cascade; named here so the counts add up.
--   delete from sto_agreement_items;
--   delete from sto_agreements;
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
-- NOT deleted, on purpose: profiles and activity_logs
-- ---------------------------------------------------------------------------
-- A profile row is the app-side half of a login. The other half lives in
-- auth.users, and deleting the profile alone leaves the account able to sign
-- in with no role — the app then treats them as a viewer with nothing visible.
--
-- The normal way to remove someone is Admin → Users → Delete, which removes
-- both halves and records it in the log. Deleting the auth user directly
-- (Dashboard → Authentication → Users) does the same thing to the data, but
-- leaves no audit entry.
--
-- activity_logs is the audit trail. It is left alone deliberately: business
-- records can be reset, but who changed whose role and when is exactly the
-- history that should survive a reset. Clear it only if you are certain, and
-- know that nothing in the app can put it back.
--
-- To wipe every login and start over, delete all users in that same screen,
-- then follow the README from "Create the first Super Admin". No account is
-- automatically privileged — the first Super Admin is minted by
-- bootstrap_super_admin() from the SQL editor and nowhere else.
