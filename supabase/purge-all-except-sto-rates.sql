-- ============================================================================
-- PURGE EVERYTHING EXCEPT THE STO RATES
-- ============================================================================
-- Empties the system back to its rate sheets: every company, contact, visit,
-- follow-up, message, sent agreement, uploaded pricing document, email
-- template and audit entry goes, and so does every login.
--
-- THIS IS NOT REVERSIBLE. There is no undo and no soft delete.
-- Take a backup first: Dashboard → Database → Backups.
--
-- READ THIS BEFORE RUNNING
-- ------------------------
-- Step 3 deletes every account in auth.users, INCLUDING YOUR OWN. The moment
-- it commits, nobody can sign in — there is no public signup in this system,
-- so there is no way back in through the app. Getting back in means:
--
--   1. Dashboard → Authentication → Users → Add user (your email);
--   2. edit the address in supabase/bootstrap-super-admin.sql and run it.
--
-- If you are not prepared to do that, run steps 1 and 2 and stop.
--
-- Run it in the Supabase SQL editor (Dashboard → SQL Editor). It runs as
-- postgres, so RLS does not apply and it sees every row regardless of owner.
-- The app's anon key cannot do any of this.
--
-- Unlike reset-data.sql, the delete here is NOT commented out. This file was
-- written to be run. Do not paste it anywhere you have not read it.

-- ---------------------------------------------------------------------------
-- WHAT SURVIVES
-- ---------------------------------------------------------------------------
--   sto_agreement_versions          the rate sheets themselves
--   sto_version_rates               the room rates on them
--   sto_version_supplements         the extras priced beside the rooms
--   sto_version_property_sections   the room categories
--   sto_section_images              their photographs (files stay in `sto`)
--   sto_version_terms               the clauses
--   sto_rate_card                   the services & prices behind STO → Rates
--   org_settings                    the letterhead: name, colours, logo
--   permissions / role_permissions  the role model, not data
--
-- created_by on a version points at a profile with `on delete set null`, so
-- the sheets survive their author being deleted; they simply lose the name.

-- ---------------------------------------------------------------------------
-- STEP 1 — what is in there now. A read. Run it first.
-- ---------------------------------------------------------------------------
select 'companies' as table_name, count(*) from companies
union all select 'contacts', count(*) from contacts
union all select 'site_visits', count(*) from site_visits
union all select 'follow_ups', count(*) from follow_ups
union all select 'sent_messages', count(*) from sent_messages
union all select 'sto_agreement_sends', count(*) from sto_agreement_sends
union all select 'sto_agreements (legacy)', count(*) from sto_agreements
union all select 'sto_agreement_items (legacy)', count(*) from sto_agreement_items
union all select 'pricing_documents', count(*) from pricing_documents
union all select 'email_templates', count(*) from email_templates
union all select 'activity_logs', count(*) from activity_logs
union all select 'profiles', count(*) from profiles
union all select '-- KEPT: sto_agreement_versions', count(*) from sto_agreement_versions
union all select '-- KEPT: sto_version_rates', count(*) from sto_version_rates
union all select '-- KEPT: sto_rate_card', count(*) from sto_rate_card
order by table_name;

-- ---------------------------------------------------------------------------
-- STEP 2 — the business records
-- ---------------------------------------------------------------------------
-- One transaction, so a failure part-way leaves nothing half-deleted. Children
-- before parents: the foreign keys cascade anyway, but being explicit means a
-- surprise here is a visible error rather than a silent cascade.
begin;

  -- Everything hanging off a company.
  delete from sent_messages;
  delete from sto_agreement_sends;
  delete from sto_agreement_items;
  delete from sto_agreements;
  delete from follow_ups;
  delete from site_visits;
  delete from contacts;
  delete from companies;

  -- Uploaded pricing PDFs. This removes the rows and the objects' metadata,
  -- which is enough for the app: nothing can list or reach them again. It does
  -- NOT delete the stored files themselves — SQL cannot, only the storage API
  -- can. To reclaim the space, empty the `pricing` bucket afterwards from
  -- Dashboard → Storage. Leave the `sto` and `branding` buckets alone.
  delete from pricing_documents;
  delete from storage.objects where bucket_id = 'pricing';

  -- The saved email copy. Written by hand, but it is addressed to operators
  -- who no longer exist here.
  delete from email_templates;

  -- The audit trail. reset-data.sql keeps this on purpose — who changed whose
  -- role and when is exactly the history that should outlive a reset — but a
  -- log of accounts that no longer exist, kept for nobody, is not an audit
  -- trail. Comment this line out to keep it.
  delete from activity_logs;

commit;

-- ---------------------------------------------------------------------------
-- STEP 3 — the accounts
-- ---------------------------------------------------------------------------
-- Separate from step 2 and deliberately last: this is the one that locks you
-- out. Run it only when you have read the warning at the top of this file.
--
-- profiles.id references auth.users(id) on delete cascade, so deleting the
-- auth user removes both halves of the account. Deleting the profile alone
-- would leave a login that still works and has no role.
begin;

  delete from auth.users;

commit;

-- ---------------------------------------------------------------------------
-- AFTERWARDS
-- ---------------------------------------------------------------------------
-- Confirm what is left:
--
--   select count(*) from profiles;                 -- expect 0
--   select count(*) from companies;                -- expect 0
--   select name, year, status from sto_agreement_versions order by year desc;
--
-- Then create the first Super Admin again, per the README:
--   Dashboard → Authentication → Users → Add user, then edit and run
--   supabase/bootstrap-super-admin.sql with that address.
--
-- The `sto` bucket is untouched: the rate sheets' own PDFs and room
-- photographs are still there, and still referenced by the rows kept above.
-- The `branding` bucket is untouched too — that is the letterhead, not data.
