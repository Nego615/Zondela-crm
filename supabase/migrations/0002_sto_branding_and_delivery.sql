-- ============================================================================
-- 0002 — STO BRANDING + MESSAGE DELIVERY TRACKING
-- ============================================================================
-- Three things, all belonging to the STO section:
--
--   1. org_settings — one row holding the letterhead: who Zondela is on a
--      document, the colours, the signatory, and the email defaults. The
--      agreement template and every outgoing message read from it, so
--      rebranding is one form rather than a search for hardcoded strings.
--   2. sent_messages gains a lifecycle: queued -> sent -> delivered -> viewed,
--      with failed, approved and rejected as terminal states, plus the
--      timestamps that go with each.
--   3. A `branding` storage bucket for the logo. Public, because an image in
--      an email has to be reachable by the recipient's mail client.
--
-- Included verbatim in schema.sql; run on its own to apply just this to a live
-- database. Idempotent.

-- ----------------------------------------------------------------------------
-- ORG SETTINGS (the letterhead)
-- ----------------------------------------------------------------------------
-- Singleton: the check constraint on id means there is exactly one row and
-- every read can be `select ... limit 1` without a "which one?" question.
create table if not exists org_settings (
  id int primary key default 1 check (id = 1),

  -- Identity
  org_name text not null default 'Zondela House',
  legal_name text,
  tagline text,

  -- Contact block, printed in the agreement footer and the email signature
  address text,
  city text,
  country text,
  phone text,
  email text,
  website text,

  -- Look. brand_color leads the document; accent_color is the secondary rule
  -- and the totals row. Both are plain hex so they can go straight into inline
  -- styles, which is the only styling an email client reliably honours.
  logo_url text,
  brand_color text not null default '#0c3b35',
  accent_color text not null default '#a9463a',

  -- Agreement document
  agreement_intro text,
  agreement_terms_default text,
  agreement_footer text,
  signatory_name text,
  signatory_title text,

  -- Email defaults, used to compose what the team sends
  email_from_name text,
  email_from_address text,
  email_reply_to text,
  email_bcc text,
  email_signature text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The one row. `on conflict do nothing` keeps an existing, edited row intact
-- when this file is re-run.
insert into org_settings (id) values (1) on conflict (id) do nothing;

drop trigger if exists org_settings_set_updated_at on org_settings;
create trigger org_settings_set_updated_at
  before update on org_settings
  for each row execute procedure set_updated_at();

-- ----------------------------------------------------------------------------
-- THE BRANDING PERMISSION
-- ----------------------------------------------------------------------------
-- Separate from settings.manage, which is Super Admin only and covers access
-- and roles. Branding is operational — the people who send agreements are the
-- people who should be able to fix a wrong phone number on them.
insert into permissions (key, label, description, category, sort_order) values
  ('settings.branding', 'Edit STO branding & email settings',
   'Change the agreement letterhead, colours, signatory and email defaults.',
   'Data', 135)
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  category = excluded.category,
  sort_order = excluded.sort_order;

-- Granted on top of the 0001 seed. 0001 clears role_permissions and re-seeds
-- it, so this has to run after — which it does, both in schema.sql and when
-- the files are applied in order.
insert into role_permissions (role, permission)
select r, 'settings.branding'
from unnest(array['super_admin', 'admin', 'manager']) as r
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- SENT MESSAGES: the delivery lifecycle
-- ----------------------------------------------------------------------------
-- What the states mean, and who sets them:
--
--   queued     composed but not handed off yet
--   sent       handed to the mail client or WhatsApp — the app knows this much
--              on its own, because it is the moment the team pressed the button
--   delivered  it reached them. Nobody can know this from a mailto: handoff, so
--              it is marked by the sender, or by a provider later
--   viewed     they opened or replied to it. Same: marked, not detected
--   failed     it bounced or could not be sent, with a reason
--   approved   the client said yes
--   rejected   the client said no
--
-- approved and rejected are kept in step with the agreement automatically (see
-- the trigger below); the middle three are the team's own record of what
-- happened, until an email provider is wired up to set them.
alter table sent_messages add column if not exists agreement_id uuid
  references sto_agreements(id) on delete set null;
alter table sent_messages add column if not exists to_name text;
alter table sent_messages add column if not exists to_email text;

-- Existing rows were all handed off successfully, so `sent` is the honest
-- backfill; the default matches for anything written from now on.
alter table sent_messages add column if not exists status text not null default 'sent';

alter table sent_messages drop constraint if exists sent_messages_status_check;
update sent_messages set status = 'sent'
where status is null
   or status not in ('queued', 'sent', 'delivered', 'viewed', 'failed', 'approved', 'rejected');
alter table sent_messages add constraint sent_messages_status_check
  check (status in ('queued', 'sent', 'delivered', 'viewed', 'failed', 'approved', 'rejected'));

alter table sent_messages add column if not exists delivered_at timestamptz;
alter table sent_messages add column if not exists viewed_at timestamptz;
alter table sent_messages add column if not exists failed_at timestamptz;
alter table sent_messages add column if not exists responded_at timestamptz;
alter table sent_messages add column if not exists failure_reason text;
alter table sent_messages add column if not exists status_note text;

-- Room for an email provider to own these states later: the id it hands back
-- on send is what a webhook would match its delivery events against.
alter table sent_messages add column if not exists provider text;
alter table sent_messages add column if not exists provider_message_id text;

alter table sent_messages add column if not exists updated_at timestamptz not null default now();

create index if not exists sent_messages_agreement_idx on sent_messages(agreement_id);
create index if not exists sent_messages_status_idx on sent_messages(status);

drop trigger if exists sent_messages_set_updated_at on sent_messages;
create trigger sent_messages_set_updated_at
  before update on sent_messages
  for each row execute procedure set_updated_at();

-- Stamps the timestamp that goes with a new status, so the timeline in the UI
-- is built from the data rather than from whatever the client remembered to
-- send. Only ever fills a blank: re-marking something delivered does not move
-- the date it was first delivered.
create or replace function stamp_message_status()
returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status is distinct from old.status then
    case new.status
      when 'delivered' then
        new.delivered_at := coalesce(new.delivered_at, now());
      when 'viewed' then
        -- Being read implies it arrived. A message marked straight to viewed
        -- would otherwise show a gap in the timeline that never gets filled.
        new.delivered_at := coalesce(new.delivered_at, now());
        new.viewed_at := coalesce(new.viewed_at, now());
      when 'failed' then
        new.failed_at := coalesce(new.failed_at, now());
      when 'approved' then
        new.delivered_at := coalesce(new.delivered_at, now());
        new.responded_at := coalesce(new.responded_at, now());
      when 'rejected' then
        new.delivered_at := coalesce(new.delivered_at, now());
        new.responded_at := coalesce(new.responded_at, now());
      else
        null;
    end case;

    -- Moving off failed clears the reason with it; a stale "mailbox full" next
    -- to a delivered message is worse than no reason at all.
    if new.status <> 'failed' then
      new.failure_reason := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists sent_messages_stamp_status on sent_messages;
create trigger sent_messages_stamp_status
  before update on sent_messages
  for each row execute procedure stamp_message_status();

-- An agreement moving to accepted or declined is the client's answer, and the
-- message that carried it is where that answer is visible. Keeping the two in
-- step here means the team marks the outcome once, on the agreement, and the
-- delivery view agrees with it.
create or replace function sync_agreement_message_status()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'accepted' then
      update sent_messages set status = 'approved'
      where agreement_id = new.id and status not in ('approved', 'failed');
    elsif new.status = 'declined' then
      update sent_messages set status = 'rejected'
      where agreement_id = new.id and status not in ('rejected', 'failed');
    elsif new.status = 'sent' and old.status in ('accepted', 'declined') then
      -- Reopened: the reply no longer stands, but the message was still
      -- delivered, so it drops back to that rather than all the way to sent.
      update sent_messages set status = 'delivered'
      where agreement_id = new.id and status in ('approved', 'rejected');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists sto_agreements_sync_message_status on sto_agreements;
create trigger sto_agreements_sync_message_status
  after update on sto_agreements
  for each row execute procedure sync_agreement_message_status();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table org_settings enable row level security;

-- Everyone active reads it — the agreement document and the send modal both
-- render from it, whatever the reader's role.
drop policy if exists "org_settings_select" on org_settings;
create policy "org_settings_select" on org_settings for select
  using (is_active_user());

drop policy if exists "org_settings_update" on org_settings;
create policy "org_settings_update" on org_settings for update
  using (has_permission('settings.branding'))
  with check (has_permission('settings.branding'));

-- The single row is created by this file. Nothing should be adding a second.
drop policy if exists "org_settings_insert_blocked" on org_settings;
create policy "org_settings_insert_blocked" on org_settings for insert
  with check (false);

-- sent_messages keeps the policies from schema.sql: readable by whoever can
-- see the company, writable with data.write. Marking a message delivered is an
-- edit to a business record, which is exactly that grant.

-- ----------------------------------------------------------------------------
-- STORAGE: the `branding` bucket
-- ----------------------------------------------------------------------------
-- Public for the same reason `pricing` is: a logo in an email or on a shared
-- agreement has to load for someone who has never signed in here. Only a
-- letterhead goes in it.
insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do update set public = true;

drop policy if exists "branding_public_read" on storage.objects;
create policy "branding_public_read" on storage.objects for select
  using (bucket_id = 'branding');

drop policy if exists "branding_write_insert" on storage.objects;
create policy "branding_write_insert" on storage.objects for insert
  with check (bucket_id = 'branding' and public.has_permission('settings.branding'));

drop policy if exists "branding_write_update" on storage.objects;
create policy "branding_write_update" on storage.objects for update
  using (bucket_id = 'branding' and public.has_permission('settings.branding'));

drop policy if exists "branding_write_delete" on storage.objects;
create policy "branding_write_delete" on storage.objects for delete
  using (bucket_id = 'branding' and public.has_permission('settings.branding'));
