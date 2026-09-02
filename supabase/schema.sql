-- Zondela CRM schema
-- Run this in your Supabase project's SQL editor (Database > SQL Editor > New query).
-- Safe to re-run: uses "create table if not exists" and drops/recreates policies.

-- ============================================================================
-- EXTENSIONS
-- ============================================================================
create extension if not exists "pgcrypto";

-- ============================================================================
-- PROFILES (team members)
-- Mirrors auth.users with app-specific fields (role, status, display name).
-- A row is created automatically when an account appears in auth.users, and
-- always at the lowest privilege — see handle_new_user() in the RBAC section
-- further down, which replaces the definition here.
--
-- There is no public signup. Accounts are created by an administrator through
-- the admin-users edge function; the first Super Admin comes from
-- bootstrap_super_admin(), which is only callable from the SQL editor.
-- ============================================================================
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null,
  phone_number text,
  role text not null default 'viewer'
    check (role in ('super_admin', 'admin', 'manager', 'staff', 'viewer')),
  status text not null default 'pending'
    check (status in ('active', 'inactive', 'pending')),
  invited_by uuid references profiles(id) on delete set null,
  last_login timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- COMPANIES (the pipeline)
-- ============================================================================
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  website text,
  address text,
  country text,
  relationship text
    check (relationship is null or relationship in
      ('new', 'existing_partner', 'works_zondela', 'dormant', 'not_interested')),
  main_market text
    check (main_market is null or main_market in
      ('arusha', 'dar_es_salaam', 'dodoma', 'mwanza', 'zanzibar', 'tanzania',
       'east_africa', 'international')),
  stage text not null default 'lead'
    check (stage in ('lead', 'contacted', 'site_visit', 'proposal_sent', 'negotiation', 'won', 'lost')),
  notes text,
  owner_id uuid references profiles(id) on delete set null,
  -- A rep with no login. NOTE: owner_id, not this, drives who can see the
  -- company — a named-but-not-linked rep leaves it in the shared pool.
  owner_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists companies_stage_idx on companies(stage);
create index if not exists companies_owner_idx on companies(owner_id);

-- ============================================================================
-- CONTACTS (people at a company)
-- ============================================================================
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  full_name text not null,
  job_title text,
  email text,
  phone text,
  whatsapp text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists contacts_company_idx on contacts(company_id);

-- ============================================================================
-- SITE VISITS (logged and scheduled)
-- ============================================================================
create table if not exists site_visits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  rep_id uuid references profiles(id) on delete set null,
  -- For a rep with no login. Only one of rep_id / rep_name is ever set.
  rep_name text,
  kind text not null default 'site_visit' check (kind in ('site_visit', 'meeting')),
  scheduled_for timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  summary text,
  created_at timestamptz not null default now()
);

create index if not exists site_visits_company_idx on site_visits(company_id);
create index if not exists site_visits_scheduled_idx on site_visits(scheduled_for);

-- ============================================================================
-- FOLLOW-UPS (scheduled tasks/reminders)
-- ============================================================================
create table if not exists follow_ups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  assigned_to uuid references profiles(id) on delete set null,
  -- For a rep with no login; see the note on site_visits.rep_name.
  assigned_name text,
  due_at timestamptz not null,
  note text not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'skipped')),
  created_at timestamptz not null default now()
);

create index if not exists follow_ups_company_idx on follow_ups(company_id);
create index if not exists follow_ups_due_idx on follow_ups(due_at);
create index if not exists follow_ups_assigned_idx on follow_ups(assigned_to);

-- ============================================================================
-- STO RATE CARD (price list)
-- ============================================================================
create table if not exists sto_rate_card (
  id uuid primary key default gen_random_uuid(),
  service_name text not null,
  description text,
  price numeric(12,2) not null,
  currency text not null default 'TZS',
  unit text default 'per month',
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- EMAIL TEMPLATES
-- ============================================================================
create table if not exists email_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null,
  body_html text not null,
  category text not null default 'general' check (category in ('general', 'pricing', 'follow_up', 'proposal')),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- PRICING DOCUMENTS (the rate card as a PDF, sent to clients unchanged)
-- ============================================================================
-- The row is the catalogue entry; the file itself lives in the `pricing`
-- storage bucket, created further down. storage_path is the key into it.
create table if not exists pricing_documents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  storage_path text not null unique,
  size_bytes bigint not null default 0,
  is_default boolean not null default false,
  uploaded_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- At most one default. A partial unique index is enough: rows with
-- is_default = false are not indexed and so never collide.
create unique index if not exists pricing_documents_one_default_idx
  on pricing_documents (is_default) where is_default;

-- ============================================================================
-- STO AGREEMENTS (the quote/contract built from the rate card and sent out)
-- ============================================================================
-- An agreement is a snapshot, not a live view of the rate card: its lines copy
-- the service name, price and unit at the moment it was built. Repricing the
-- rate card afterwards must not silently rewrite a number a client already
-- accepted, so sto_agreement_items keeps its own copy of every field and only
-- remembers which rate card row it came from.
create sequence if not exists sto_agreement_ref_seq;

create table if not exists sto_agreements (
  id uuid primary key default gen_random_uuid(),
  -- Human-readable handle quoted in email and on the phone. Generated by the
  -- database so two people building an agreement at once cannot collide.
  reference text not null unique
    default 'STO-' || lpad(nextval('sto_agreement_ref_seq')::text, 4, '0'),
  company_id uuid not null references companies(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  title text not null,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'accepted', 'declined')),
  currency text not null default 'TZS',
  -- Percent off the line subtotal, applied to the whole agreement.
  discount_percent numeric(5,2) not null default 0
    check (discount_percent >= 0 and discount_percent <= 100),
  starts_on date,
  valid_until date,
  terms text,
  notes text,
  -- Set when the agreement moves into that state, so "sent last week, still
  -- not accepted" is answerable without a separate audit table.
  sent_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sto_agreements_company_idx on sto_agreements(company_id);
create index if not exists sto_agreements_status_idx on sto_agreements(status);
create index if not exists sto_agreements_created_by_idx on sto_agreements(created_by);

create table if not exists sto_agreement_items (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references sto_agreements(id) on delete cascade,
  -- Where the line came from, kept for reference only. Null once the rate card
  -- row is deleted, or when the line was typed in by hand.
  rate_card_item_id uuid references sto_rate_card(id) on delete set null,
  service_name text not null,
  description text,
  unit text,
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  sort_order int not null default 0
);

create index if not exists sto_agreement_items_agreement_idx
  on sto_agreement_items(agreement_id);

-- ============================================================================
-- SENT MESSAGES LOG (email + whatsapp share history)
-- ============================================================================
create table if not exists sent_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  sent_by uuid references profiles(id) on delete set null,
  channel text not null check (channel in ('email', 'whatsapp')),
  template_id uuid references email_templates(id) on delete set null,
  subject text,
  body text not null,
  sent_at timestamptz not null default now()
);

create index if not exists sent_messages_company_idx on sent_messages(company_id);

-- ============================================================================
-- UPGRADES for databases created before these columns existed
-- ============================================================================
-- `create table if not exists` above leaves an existing table untouched, so
-- anything added to a table after its first release has to be applied here too.
-- All of it is guarded, so this file stays safe to re-run.

-- companies: industry dropped; city became country; relationship and
-- main_market added.
alter table companies drop column if exists industry;

do $$
begin
  -- Rename rather than add-and-drop, so whatever is already in the column
  -- survives. Only fires when city exists and country does not, which makes
  -- re-running a no-op.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'companies' and column_name = 'city')
     and not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'companies' and column_name = 'country')
  then
    alter table companies rename column city to country;
  end if;
end $$;

alter table companies add column if not exists country text;
alter table companies add column if not exists relationship text;
alter table companies add column if not exists main_market text;

-- Constraints are added separately: a column added by the block above arrives
-- without the check that the fresh-install definition carries.
-- Adding a check fails outright if any existing row breaks it, which would
-- abort the whole script. Clearing values outside the current set first means
-- a database written against an earlier list still upgrades cleanly; the field
-- is optional, so null is a valid resting place.
update companies set relationship = null
where relationship is not null
  and relationship not in
    ('new', 'existing_partner', 'works_zondela', 'dormant', 'not_interested');

alter table companies drop constraint if exists companies_relationship_check;
alter table companies add constraint companies_relationship_check
  check (relationship is null or relationship in
    ('new', 'existing_partner', 'works_zondela', 'dormant', 'not_interested'));

alter table companies drop constraint if exists companies_main_market_check;
alter table companies add constraint companies_main_market_check
  check (main_market is null or main_market in
    ('arusha', 'dar_es_salaam', 'dodoma', 'mwanza', 'zanzibar', 'tanzania',
     'east_africa', 'international'));

-- Free-typed rep names, for people who do the work but have no app login.
alter table companies add column if not exists owner_name text;
alter table site_visits add column if not exists rep_name text;
alter table follow_ups add column if not exists assigned_name text;

-- site_visits: an appointment is now either a site visit or a meeting.
-- Existing rows were all site visits, which is what the default backfills.
alter table site_visits add column if not exists kind text not null default 'site_visit';

alter table site_visits drop constraint if exists site_visits_kind_check;
alter table site_visits add constraint site_visits_kind_check
  check (kind in ('site_visit', 'meeting'));

-- ============================================================================
-- updated_at triggers
-- ============================================================================
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists companies_set_updated_at on companies;
create trigger companies_set_updated_at
  before update on companies
  for each row execute procedure set_updated_at();

drop trigger if exists sto_agreements_set_updated_at on sto_agreements;
create trigger sto_agreements_set_updated_at
  before update on sto_agreements
  for each row execute procedure set_updated_at();

drop trigger if exists templates_set_updated_at on email_templates;
create trigger templates_set_updated_at
  before update on email_templates
  for each row execute procedure set_updated_at();

-- @@BEGIN:migrations/0001_closed_access_rbac.sql@@
-- Generated from supabase/migrations/0001_closed_access_rbac.sql by supabase/build-schema.mjs.
-- Edit that file, then run `npm run sync:schema`.

-- ============================================================================
-- 0001 — CLOSED-ACCESS AUTH + ROLE-BASED ACCESS CONTROL
-- ============================================================================
-- Turns the CRM from "anyone can sign up" into an invite-only system with a
-- five-level role hierarchy, permission grants, and an audit trail.
--
--   SUPER ADMIN -> ADMIN -> MANAGER -> STAFF -> VIEWER
--
-- This block is included verbatim in schema.sql, so a fresh install gets it
-- automatically. Run this file on its own only if you would rather apply the
-- auth changes to a live database without re-running the whole schema — note
-- that the business-table policies (viewer read-only, inactive-user lockout)
-- live in schema.sql's RLS section and need a re-run to land.
--
-- Idempotent: safe to run as many times as you like.

-- ----------------------------------------------------------------------------
-- PROFILES: new columns
-- ----------------------------------------------------------------------------
alter table profiles add column if not exists phone_number text;
alter table profiles add column if not exists updated_at timestamptz not null default now();
alter table profiles add column if not exists last_login timestamptz;
alter table profiles add column if not exists invited_by uuid references profiles(id) on delete set null;

-- status arrives as 'active' so everyone already using the system keeps their
-- access, then the default flips to 'pending' for everyone created from now on
-- (a new account is not usable until its owner has set a password).
alter table profiles add column if not exists status text not null default 'active';
alter table profiles alter column status set default 'pending';

update profiles set status = 'active'
where status is null or status not in ('active', 'inactive', 'pending');

alter table profiles drop constraint if exists profiles_status_check;
alter table profiles add constraint profiles_status_check
  check (status in ('active', 'inactive', 'pending'));

-- ----------------------------------------------------------------------------
-- PROFILES: the old two-role model becomes the five-level hierarchy
-- ----------------------------------------------------------------------------
-- owner ran the whole system     -> super_admin
-- marketing was every other user -> staff
-- The check constraint has to come off first: the update would otherwise be
-- rejected by the constraint it is migrating away from.
alter table profiles drop constraint if exists profiles_role_check;

update profiles set role = 'super_admin' where role = 'owner';
update profiles set role = 'staff' where role = 'marketing';
-- Anything unrecognised lands on the least-privileged role rather than
-- blocking the migration.
update profiles set role = 'viewer'
where role is null or role not in ('super_admin', 'admin', 'manager', 'staff', 'viewer');

alter table profiles add constraint profiles_role_check
  check (role in ('super_admin', 'admin', 'manager', 'staff', 'viewer'));
alter table profiles alter column role set default 'viewer';

create index if not exists profiles_role_idx on profiles(role);
create index if not exists profiles_status_idx on profiles(status);

-- set_updated_at() is defined further down in schema.sql; when this file is
-- run on its own against a live database the function is already there.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    drop trigger if exists profiles_set_updated_at on profiles;
    create trigger profiles_set_updated_at
      before update on profiles
      for each row execute procedure set_updated_at();
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- NEW USER TRIGGER
-- ----------------------------------------------------------------------------
-- Deliberately does NOT read a role out of raw_user_meta_data. That field is
-- attacker-controlled on any signup call, so trusting it would hand anyone who
-- reached the signup endpoint the role of their choice. Every account starts
-- as a pending viewer; the admin-users edge function (service role, and only
-- after it has checked the caller) is what raises it to the role the admin
-- picked.
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, phone_number, role, status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'phone_number', ''),
    'viewer',
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- A pending account becomes active the moment its owner accepts the invite and
-- sets a password — the last step of the invitation flow, and one that Supabase
-- Auth, not the app, is what knows about.
create or replace function handle_user_confirmed()
returns trigger as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    -- This is a legitimate status change, so it announces itself to the guard
    -- trigger on profiles the same way set_user_status() does.
    perform set_config('app.privileged_profile_write', 'on', true);
    update public.profiles
    set status = 'active'
    where id = new.id and status = 'pending';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after update on auth.users
  for each row execute procedure handle_user_confirmed();

-- ----------------------------------------------------------------------------
-- PERMISSION CATALOGUE
-- ----------------------------------------------------------------------------
-- Roles are checked through permissions, never by name, so adding a capability
-- means one row here instead of a new `role = '...'` test scattered through the
-- policies and the UI.
create table if not exists permissions (
  key text primary key,
  label text not null,
  description text not null,
  category text not null default 'general',
  sort_order int not null default 0
);

create table if not exists role_permissions (
  role text not null check (role in ('super_admin', 'admin', 'manager', 'staff', 'viewer')),
  permission text not null references permissions(key) on delete cascade,
  primary key (role, permission)
);

insert into permissions (key, label, description, category, sort_order) values
  ('users.view',           'View users',               'Open the User management section and see every account.',                          'Users',  10),
  ('users.create',         'Create users',             'Invite a new user and choose their starting role.',                                'Users',  20),
  ('users.update',         'Edit user details',        'Change another user''s name and phone number.',                                    'Users',  30),
  ('users.assign_role',    'Change user roles',        'Promote or demote users below their own level.',                                   'Users',  40),
  ('users.manage_admins',  'Manage Admins',            'Create, promote, demote and edit Admin and Super Admin accounts.',                 'Users',  50),
  ('users.set_status',     'Activate / deactivate',    'Switch an account between active and inactive.',                                   'Users',  60),
  ('users.reset_password', 'Send password resets',     'Trigger a password reset or re-send an invitation.',                               'Users',  70),
  ('users.delete',         'Delete users',             'Permanently remove an account and its login.',                                     'Users',  80),
  ('roles.view',           'View roles & permissions', 'See the role hierarchy and what each role may do.',                                'System', 90),
  ('logs.view',            'View activity logs',       'Read the audit trail of administrative actions.',                                  'System', 100),
  ('settings.manage',      'Manage system settings',   'Change system-wide configuration.',                                                'System', 110),
  ('data.view_all',        'See all pipeline data',    'View every company, not only their own and the unclaimed pool.',                   'Data',   120),
  ('data.write',           'Edit business records',    'Create and change companies, contacts, appointments, follow-ups and agreements.',  'Data',   130),
  ('reports.view',         'Access reports',           'Open the Reports section.',                                                        'Data',   140)
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  category = excluded.category,
  sort_order = excluded.sort_order;

-- The grant table is owned by this file, not by the app: re-running resets it
-- to the mapping below. Change what a role may do by editing this insert.
--
-- Later migrations add grants of their own on top (0002 adds
-- settings.branding), so running this file on its own drops those. Re-run
-- schema.sql, which applies every migration in order, rather than one file.
delete from role_permissions;

insert into role_permissions (role, permission)
-- Super Admin: everything, including the parts that create other admins.
select 'super_admin', key from permissions
union all
-- Admin: full user management except deleting accounts, touching Admins, and
-- system settings.
select 'admin', key from permissions where key in (
  'users.view', 'users.create', 'users.update', 'users.assign_role',
  'users.set_status', 'users.reset_password',
  'roles.view', 'logs.view', 'data.view_all', 'data.write', 'reports.view'
)
union all
-- Manager: sees the whole pipeline and the team roster, changes no accounts.
select 'manager', key from permissions where key in (
  'users.view', 'data.view_all', 'data.write', 'reports.view'
)
union all
-- Staff: their own companies plus the unclaimed pool, full editing there.
select 'staff', key from permissions where key in (
  'data.write', 'reports.view'
)
union all
-- Viewer: read-only.
select 'viewer', key from permissions where key in (
  'reports.view'
);

-- ----------------------------------------------------------------------------
-- ACTIVITY LOG
-- ----------------------------------------------------------------------------
-- Names and roles are snapshotted alongside the ids, so the trail still reads
-- ("Super Admin John promoted Sarah from Staff to Admin") after either account
-- is deleted and the foreign keys have nulled out.
create table if not exists activity_logs (
  id uuid primary key default gen_random_uuid(),
  performed_by uuid references profiles(id) on delete set null,
  performed_by_name text,
  performed_by_role text,
  action text not null,
  target_user uuid references profiles(id) on delete set null,
  target_user_name text,
  previous_value text,
  new_value text,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_logs_created_idx on activity_logs(created_at desc);
create index if not exists activity_logs_target_idx on activity_logs(target_user);
create index if not exists activity_logs_actor_idx on activity_logs(performed_by);
create index if not exists activity_logs_action_idx on activity_logs(action);

-- ----------------------------------------------------------------------------
-- HELPERS
-- ----------------------------------------------------------------------------
-- Which JWT role is making this call. Empty in the SQL editor (a direct
-- superuser connection with no request context), so the fallback is what lets
-- setup scripts through the guard trigger below.
create or replace function jwt_role()
returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    'postgres'
  );
$$;

create or replace function role_rank(r text)
returns int
language sql immutable as $$
  select case r
    when 'super_admin' then 100
    when 'admin' then 80
    when 'manager' then 60
    when 'staff' then 40
    when 'viewer' then 20
    else 0
  end;
$$;

-- security definer throughout: these are read by RLS policies on profiles
-- itself, so a policy-evaluated lookup would recurse.
create or replace function current_app_role()
returns text
language sql security definer stable set search_path = public, pg_temp as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_active_user()
returns boolean
language sql security definer stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from profiles where id = auth.uid() and status = 'active'
  );
$$;

-- The single gate every check goes through. An inactive account holds no
-- permissions at all, which is what keeps a deactivated user out of the system
-- even while their session token is still valid.
create or replace function has_permission(perm text)
returns boolean
language sql security definer stable set search_path = public, pg_temp as $$
  select exists (
    select 1
    from profiles p
    join role_permissions rp on rp.role = p.role
    where p.id = auth.uid()
      and p.status = 'active'
      and rp.permission = perm
  );
$$;

create or replace function my_permissions()
returns text[]
language sql security definer stable set search_path = public, pg_temp as $$
  select coalesce(array_agg(rp.permission order by rp.permission), '{}')
  from profiles p
  join role_permissions rp on rp.role = p.role
  where p.id = auth.uid() and p.status = 'active';
$$;

create or replace function is_super_admin()
returns boolean
language sql security definer stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'super_admin' and status = 'active'
  );
$$;

create or replace function can_view_all_data()
returns boolean
language sql stable as $$ select has_permission('data.view_all'); $$;

create or replace function can_write_data()
returns boolean
language sql stable as $$ select has_permission('data.write'); $$;

-- Kept under its old name so policies written against the two-role model keep
-- meaning what they meant: "may see the whole pipeline, not only their own".
create or replace function is_owner()
returns boolean
language sql stable as $$ select has_permission('data.view_all'); $$;

-- ----------------------------------------------------------------------------
-- WRITING TO THE LOG
-- ----------------------------------------------------------------------------
create or replace function log_activity(
  p_action text,
  p_target uuid default null,
  p_previous text default null,
  p_new text default null,
  p_details jsonb default null,
  p_actor uuid default null
)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_actor_name text;
  v_actor_role text;
  v_target_name text;
  v_id uuid;
begin
  select coalesce(nullif(full_name, ''), email), role
    into v_actor_name, v_actor_role
  from profiles where id = v_actor;

  select coalesce(nullif(full_name, ''), email)
    into v_target_name
  from profiles where id = p_target;

  insert into activity_logs (
    performed_by, performed_by_name, performed_by_role,
    action, target_user, target_user_name,
    previous_value, new_value, details
  )
  values (
    v_actor, coalesce(v_actor_name, 'System'), v_actor_role,
    p_action, p_target, v_target_name,
    p_previous, p_new, p_details
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Nothing outside these functions may write the log.
revoke execute on function log_activity(text, uuid, text, text, jsonb, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- THE GUARD ON role AND status
-- ----------------------------------------------------------------------------
-- profiles is writable over the REST API by anyone who can edit a user at all,
-- so "only the UI sends role changes" would be worth nothing — a hand-rolled
-- PATCH would walk straight past it. This trigger makes role and status
-- unwritable by any request-context caller except through set_user_role() and
-- set_user_status(), the two functions that run the hierarchy checks and write
-- the audit log.
--
-- email is in here for a different reason: it is a mirror of auth.users.email,
-- and letting it drift means password resets and invitations get addressed to
-- somewhere the login does not live. Changing an address is an Auth operation,
-- not a table edit.
create or replace function guard_profile_privileged_columns()
returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.role is distinct from old.role
     or new.status is distinct from old.status
     or new.email is distinct from old.email
  then
    if jwt_role() in ('authenticated', 'anon')
       and coalesce(current_setting('app.privileged_profile_write', true), '') <> 'on'
    then
      raise exception
        'role, status and email can only be changed through set_user_role(), set_user_status() or Supabase Auth'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged_columns on profiles;
create trigger profiles_guard_privileged_columns
  before update on profiles
  for each row execute procedure guard_profile_privileged_columns();

-- ----------------------------------------------------------------------------
-- AUTHORISATION CHECKS, SHARED BY THE RPCs AND THE EDGE FUNCTION
-- ----------------------------------------------------------------------------
-- Two rules, applied everywhere:
--   * you may only act on someone strictly below you in the hierarchy;
--   * you may only hand out a role strictly below your own.
-- Super Admin is exempt from both — it is the top of the tree, and has to be
-- able to appoint its own peers and successors. Nobody, Super Admin included,
-- may act on themselves.
create or replace function assert_can_manage_user(p_target uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor_role text := current_app_role();
  v_target_role text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if not is_active_user() then
    raise exception 'Your account is not active' using errcode = '42501';
  end if;
  if p_target = auth.uid() then
    raise exception 'You cannot change your own account from User management'
      using errcode = '42501';
  end if;

  select role into v_target_role from profiles where id = p_target;
  if v_target_role is null then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  if not is_super_admin() then
    if role_rank(v_target_role) >= role_rank(v_actor_role) then
      raise exception 'You cannot modify a user at or above your own level'
        using errcode = '42501';
    end if;
    if v_target_role in ('super_admin', 'admin') and not has_permission('users.manage_admins') then
      raise exception 'Only a Super Admin can modify Admin accounts'
        using errcode = '42501';
    end if;
  end if;
end;
$$;

create or replace function assert_can_assign_role(p_role text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor_role text := current_app_role();
begin
  if p_role not in ('super_admin', 'admin', 'manager', 'staff', 'viewer') then
    raise exception 'Unknown role: %', p_role using errcode = '22023';
  end if;
  if not has_permission('users.assign_role') then
    raise exception 'You are not allowed to set user roles' using errcode = '42501';
  end if;
  if not is_super_admin() then
    if role_rank(p_role) >= role_rank(v_actor_role) then
      raise exception 'You cannot assign a role at or above your own level'
        using errcode = '42501';
    end if;
    if p_role in ('super_admin', 'admin') and not has_permission('users.manage_admins') then
      raise exception 'Only a Super Admin can create or promote Admins'
        using errcode = '42501';
    end if;
  end if;
end;
$$;

-- Called by the edge function before it touches the Auth admin API.
create or replace function assert_can_create_user(p_role text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_active_user() then
    raise exception 'Your account is not active' using errcode = '42501';
  end if;
  if not has_permission('users.create') then
    raise exception 'You are not allowed to create users' using errcode = '42501';
  end if;
  perform assert_can_assign_role(p_role);
end;
$$;

create or replace function assert_can_delete_user(p_target uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_target_role text;
begin
  if not has_permission('users.delete') then
    raise exception 'You are not allowed to delete users' using errcode = '42501';
  end if;
  perform assert_can_manage_user(p_target);

  select role into v_target_role from profiles where id = p_target;
  if v_target_role = 'super_admin'
     and (select count(*) from profiles where role = 'super_admin' and status = 'active') <= 1
  then
    raise exception 'This is the last active Super Admin — promote someone else first'
      using errcode = '42501';
  end if;
end;
$$;

-- Called by the edge function around the delete, so the removal is still on
-- the record after the row it points at has gone.
--
-- Both log_user_* functions re-check the permission themselves. They are
-- callable by any signed-in user over the REST API, and an audit trail anyone
-- can write fictional entries into is worth less than no trail at all.
create or replace function log_user_deleted(p_target uuid, p_name text, p_role text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not has_permission('users.delete') then
    raise exception 'You are not allowed to delete users' using errcode = '42501';
  end if;

  insert into activity_logs (
    performed_by, performed_by_name, performed_by_role,
    action, target_user, target_user_name, previous_value, new_value
  )
  select
    auth.uid(),
    coalesce(nullif(p.full_name, ''), p.email, 'System'),
    p.role,
    'user.delete',
    null,
    p_name,
    p_role,
    null
  from profiles p where p.id = auth.uid();
end;
$$;

create or replace function log_user_created(p_target uuid, p_role text, p_method text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not has_permission('users.create') then
    raise exception 'You are not allowed to create users' using errcode = '42501';
  end if;

  perform log_activity(
    'user.create', p_target, null, p_role,
    jsonb_build_object('delivery', p_method)
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- THE PRIVILEGED OPERATIONS
-- ----------------------------------------------------------------------------
create or replace function set_user_role(p_target uuid, p_role text)
returns profiles
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old_role text;
  v_row profiles;
  v_action text;
begin
  perform assert_can_manage_user(p_target);
  perform assert_can_assign_role(p_role);

  select role into v_old_role from profiles where id = p_target;

  if v_old_role = p_role then
    select * into v_row from profiles where id = p_target;
    return v_row;
  end if;

  -- Demoting the only Super Admin would leave the system with nobody able to
  -- appoint another one.
  if v_old_role = 'super_admin'
     and (select count(*) from profiles where role = 'super_admin' and status = 'active') <= 1
  then
    raise exception 'This is the last active Super Admin — promote someone else first'
      using errcode = '42501';
  end if;

  perform set_config('app.privileged_profile_write', 'on', true);
  update profiles set role = p_role where id = p_target returning * into v_row;

  v_action := case
    when p_role in ('super_admin', 'admin') then 'user.promote_admin'
    when v_old_role in ('super_admin', 'admin') then 'user.demote_admin'
    when role_rank(p_role) > role_rank(v_old_role) then 'user.promote'
    else 'user.demote'
  end;

  perform log_activity(v_action, p_target, v_old_role, p_role);
  return v_row;
end;
$$;

create or replace function set_user_status(p_target uuid, p_status text)
returns profiles
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old_status text;
  v_target_role text;
  v_row profiles;
begin
  if p_status not in ('active', 'inactive', 'pending') then
    raise exception 'Unknown status: %', p_status using errcode = '22023';
  end if;
  if not has_permission('users.set_status') then
    raise exception 'You are not allowed to change account status' using errcode = '42501';
  end if;
  perform assert_can_manage_user(p_target);

  select status, role into v_old_status, v_target_role from profiles where id = p_target;

  if v_old_status = p_status then
    select * into v_row from profiles where id = p_target;
    return v_row;
  end if;

  if v_target_role = 'super_admin' and p_status <> 'active'
     and (select count(*) from profiles where role = 'super_admin' and status = 'active') <= 1
  then
    raise exception 'This is the last active Super Admin — promote someone else first'
      using errcode = '42501';
  end if;

  perform set_config('app.privileged_profile_write', 'on', true);
  update profiles set status = p_status where id = p_target returning * into v_row;

  perform log_activity(
    case p_status
      when 'active' then 'user.activate'
      when 'inactive' then 'user.deactivate'
      else 'user.status_change'
    end,
    p_target, v_old_status, p_status
  );
  return v_row;
end;
$$;

-- Name and phone. Anyone may edit their own; editing someone else needs
-- users.update plus the hierarchy check. Email is the login identity and is
-- deliberately not editable here — changing it goes through Supabase Auth.
create or replace function update_user_profile(
  p_target uuid,
  p_full_name text,
  p_phone_number text default null
)
returns profiles
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old profiles;
  v_row profiles;
begin
  if auth.uid() is null or not is_active_user() then
    raise exception 'Your account is not active' using errcode = '42501';
  end if;

  select * into v_old from profiles where id = p_target;
  if v_old.id is null then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  if p_target <> auth.uid() then
    if not has_permission('users.update') then
      raise exception 'You are not allowed to edit other users' using errcode = '42501';
    end if;
    perform assert_can_manage_user(p_target);
  end if;

  update profiles
  set full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
      phone_number = nullif(trim(coalesce(p_phone_number, '')), '')
  where id = p_target
  returning * into v_row;

  if p_target <> auth.uid() then
    perform log_activity(
      'user.update', p_target,
      v_old.full_name, v_row.full_name,
      jsonb_build_object(
        'phone_number_from', v_old.phone_number,
        'phone_number_to', v_row.phone_number
      )
    );
  end if;

  return v_row;
end;
$$;

-- Stamped by the app on every successful sign-in.
create or replace function record_login()
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return; end if;
  update profiles set last_login = now() where id = auth.uid();
end;
$$;

-- Password reset requests are logged as sensitive actions. The self-service
-- form is unauthenticated, so this is callable by anon — it writes a row only
-- when the address belongs to a real account, and returns nothing either way,
-- so it cannot be used to probe which emails exist.
create or replace function log_password_reset_request(p_email text, p_by_admin boolean default false)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_target uuid;
begin
  select id into v_target from profiles where lower(email) = lower(trim(p_email));
  if v_target is null then return; end if;

  perform log_activity(
    'user.password_reset_request',
    v_target, null, null,
    jsonb_build_object('self_service', not p_by_admin)
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- THE FIRST SUPER ADMIN
-- ----------------------------------------------------------------------------
-- Not reachable over the API: execute is revoked from anon and authenticated
-- below, which leaves the SQL editor (or any direct database connection) as
-- the only way to run it. That is the point — the first Super Admin can only
-- come from someone who already holds the database credentials, never from a
-- signup form.
create or replace function bootstrap_super_admin(p_email text)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_old_role text;
begin
  select id into v_id from auth.users where lower(email) = lower(trim(p_email));
  if v_id is null then
    raise exception
      'No account with email %. Invite them first (Authentication -> Users -> Invite user), then run this again.',
      p_email;
  end if;

  insert into profiles (id, email, full_name, role, status)
  values (v_id, trim(p_email), '', 'super_admin', 'active')
  on conflict (id) do nothing;

  select role into v_old_role from profiles where id = v_id;

  perform set_config('app.privileged_profile_write', 'on', true);
  update profiles set role = 'super_admin', status = 'active' where id = v_id;

  perform log_activity(
    'user.bootstrap_super_admin', v_id, v_old_role, 'super_admin',
    jsonb_build_object('source', 'database setup'), v_id
  );

  return format('%s is now an active Super Admin.', p_email);
end;
$$;

revoke execute on function bootstrap_super_admin(text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- WHO MAY CALL WHAT
-- ----------------------------------------------------------------------------
-- The assert_* helpers raise on their own, but they are still only useful to a
-- signed-in caller; anon gets nothing but the reset-request logger.
revoke execute on function assert_can_manage_user(uuid) from anon;
revoke execute on function assert_can_assign_role(text) from anon;
revoke execute on function assert_can_create_user(text) from anon;
revoke execute on function assert_can_delete_user(uuid) from anon;
revoke execute on function log_user_created(uuid, text, text) from anon;
revoke execute on function log_user_deleted(uuid, text, text) from anon;
revoke execute on function set_user_role(uuid, text) from anon;
revoke execute on function set_user_status(uuid, text) from anon;
revoke execute on function update_user_profile(uuid, text, text) from anon;
revoke execute on function record_login() from anon;
revoke execute on function my_permissions() from anon;
revoke execute on function current_app_role() from anon;
revoke execute on function is_super_admin() from anon;

grant execute on function log_password_reset_request(text, boolean) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- RLS: profiles, permissions, activity logs
-- ----------------------------------------------------------------------------
alter table profiles enable row level security;
alter table permissions enable row level security;
alter table role_permissions enable row level security;
alter table activity_logs enable row level security;

-- Every active team member can read the roster — assigning a rep to a company
-- or a follow-up needs it. A pending user can still read their own row, which
-- is what the set-password screen shows them.
drop policy if exists "profiles_select" on profiles;
create policy "profiles_select" on profiles for select
  using (id = auth.uid() or is_active_user());

-- The old policy let any signed-in user update their own row, which is still
-- true — but role and status are off-limits to it now (see the guard trigger).
drop policy if exists "profiles_update_self_or_owner" on profiles;
drop policy if exists "profiles_update_self" on profiles;
create policy "profiles_update_self" on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Editing someone else needs the permission and a target below you.
drop policy if exists "profiles_update_admin" on profiles;
create policy "profiles_update_admin" on profiles for update
  using (
    is_active_user()
    and has_permission('users.update')
    and (is_super_admin() or role_rank(role) < role_rank(current_app_role()))
  )
  with check (
    is_active_user()
    and has_permission('users.update')
    and (is_super_admin() or role_rank(role) < role_rank(current_app_role()))
  );

-- Rows are only ever created by the on_auth_user_created trigger (security
-- definer, so not subject to this) or by the service role. Nothing a browser
-- can send should insert here.
drop policy if exists "profiles_insert_owner" on profiles;
drop policy if exists "profiles_insert_blocked" on profiles;
create policy "profiles_insert_blocked" on profiles for insert
  with check (false);

-- Deleting the profile alone would leave the login behind; the app deletes
-- through the edge function, which removes the Auth user and lets the cascade
-- take the profile. This policy is the backstop for a direct call.
drop policy if exists "profiles_delete_admin" on profiles;
create policy "profiles_delete_admin" on profiles for delete
  using (
    is_active_user()
    and has_permission('users.delete')
    and (is_super_admin() or role_rank(role) < role_rank(current_app_role()))
    and id <> auth.uid()
  );

-- The catalogue is reference data: readable by anyone signed in, written only
-- by this file.
drop policy if exists "permissions_select" on permissions;
create policy "permissions_select" on permissions for select
  using (auth.role() = 'authenticated');

drop policy if exists "role_permissions_select" on role_permissions;
create policy "role_permissions_select" on role_permissions for select
  using (auth.role() = 'authenticated');

-- The log is append-only from the app's side: written by security definer
-- functions, read by whoever holds logs.view. There is deliberately no update
-- or delete policy — an audit trail nobody can edit is the whole point.
drop policy if exists "activity_logs_select" on activity_logs;
create policy "activity_logs_select" on activity_logs for select
  using (has_permission('logs.view'));

-- @@END:migrations/0001_closed_access_rbac.sql@@

-- @@BEGIN:migrations/0002_sto_branding_and_delivery.sql@@
-- Generated from supabase/migrations/0002_sto_branding_and_delivery.sql by supabase/build-schema.mjs.
-- Edit that file, then run `npm run sync:schema`.

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

-- @@END:migrations/0002_sto_branding_and_delivery.sql@@

-- ============================================================================
-- ROW LEVEL SECURITY
--
-- Visibility model — per-rep scoping, on top of the role permissions granted
-- in the RBAC section above:
--   * data.view_all (Super Admin, Admin, Manager) sees and edits everything.
--   * Everyone else sees companies assigned to them (companies.owner_id), plus
--     companies left Unassigned, which act as a shared pool of new leads any
--     rep can pick up. A rep can claim an unassigned company but cannot hand
--     one of their companies to someone else — only data.view_all reassigns.
--   * Child records (contacts, site visits, follow-ups, sent messages) follow
--     the company they belong to. A visit or follow-up assigned directly to a
--     rep stays visible to them even if the company is someone else's, so
--     delegated work doesn't vanish from their queue.
--   * The rate card and email templates are shared reference data — every
--     active team member reads them; editing needs data.write.
--
-- Two rules cut across every table here:
--   * is_active_user() gates everything. A deactivated account keeps a valid
--     session token until it expires, so the lockout has to live in the
--     policies, not in the sign-in screen.
--   * can_write_data() gates every insert, update and delete. Viewer is the
--     one role without it, which is what makes Viewer read-only in the
--     database rather than only in the UI.
--
-- To go back to "everyone sees everything", delete the per-table policies
-- below and add companies/contacts/site_visits/follow_ups/sent_messages back
-- into the shared-table array at the bottom of this section.
-- ============================================================================
alter table profiles enable row level security;
alter table companies enable row level security;
alter table contacts enable row level security;
alter table site_visits enable row level security;
alter table follow_ups enable row level security;
alter table sto_rate_card enable row level security;
alter table email_templates enable row level security;
alter table pricing_documents enable row level security;
alter table sent_messages enable row level security;
alter table sto_agreements enable row level security;
alter table sto_agreement_items enable row level security;

-- is_owner(), is_active_user(), can_view_all_data() and can_write_data() are
-- defined in the RBAC section above. is_owner() now means "holds
-- data.view_all" rather than "role = owner", which is what keeps the policies
-- below reading the way they always did.
--
-- profiles' own policies live in that section too, next to the role and status
-- guard they belong with.

-- Helper: can the current user see this company?
-- security definer on purpose: the lookup bypasses RLS on companies, which
-- both avoids policy recursion when child tables call it and keeps it fast
-- (one indexed lookup instead of a nested policy evaluation per row).
create or replace function can_access_company(cid uuid)
returns boolean as $$
  select is_active_user() and exists (
    select 1 from companies c
    where c.id = cid
      and (can_view_all_data() or c.owner_id = auth.uid() or c.owner_id is null)
  );
$$ language sql security definer stable set search_path = public, pg_temp;

-- Drop the old "everyone sees everything" policies. This matters when
-- re-running over a database created by an earlier version of this file:
-- Postgres ORs multiple permissive policies together, so a leftover
-- *_all_authenticated policy would quietly re-open everything the
-- per-rep policies below are meant to close.
do $$
declare
  t text;
begin
  foreach t in array array['companies', 'contacts', 'site_visits', 'follow_ups', 'sent_messages']
  loop
    execute format('drop policy if exists "%s_all_authenticated" on %I', t, t);
  end loop;
end $$;

-- Each table gets a read policy and a write policy. The write policy is the
-- read condition plus can_write_data(), so a Viewer can open everything in
-- their scope and change none of it — enforced here, not in the UI.

-- companies: reps see their own plus the unassigned pool; data.view_all sees all.
drop policy if exists "companies_select" on companies;
create policy "companies_select" on companies for select
  using (is_active_user() and (can_view_all_data() or owner_id = auth.uid() or owner_id is null));

-- Reps must own what they create, so a rep can't file a company under
-- someone else's name (or into the pool) and lose track of it.
drop policy if exists "companies_insert" on companies;
create policy "companies_insert" on companies for insert
  with check (can_write_data() and (can_view_all_data() or owner_id = auth.uid()));

-- `using` picks the rows a rep may edit (theirs + the pool); `with check`
-- constrains the row afterwards. A rep may claim a pool company or release
-- their own back to the pool, but cannot hand one to a named colleague --
-- `owner_id is null` in the check must stay, or a rep dragging an unassigned
-- card to a new stage would be rejected for not claiming it in the same
-- statement. Another rep's company fails `using`, so it is untouchable.
drop policy if exists "companies_update" on companies;
create policy "companies_update" on companies for update
  using (can_write_data() and (can_view_all_data() or owner_id = auth.uid() or owner_id is null))
  with check (can_write_data() and (can_view_all_data() or owner_id = auth.uid() or owner_id is null));

drop policy if exists "companies_delete" on companies;
create policy "companies_delete" on companies for delete
  using (can_write_data() and (can_view_all_data() or owner_id = auth.uid()));

-- contacts: follow the parent company.
drop policy if exists "contacts_access" on contacts;
drop policy if exists "contacts_select" on contacts;
create policy "contacts_select" on contacts for select
  using (can_access_company(company_id));

drop policy if exists "contacts_write" on contacts;
create policy "contacts_write" on contacts for all
  using (can_write_data() and can_access_company(company_id))
  with check (can_write_data() and can_access_company(company_id));

-- site_visits: parent company, or assigned directly to this rep.
drop policy if exists "site_visits_access" on site_visits;
drop policy if exists "site_visits_select" on site_visits;
create policy "site_visits_select" on site_visits for select
  using (is_active_user() and (can_access_company(company_id) or rep_id = auth.uid()));

drop policy if exists "site_visits_write" on site_visits;
create policy "site_visits_write" on site_visits for all
  using (can_write_data() and (can_access_company(company_id) or rep_id = auth.uid()))
  with check (can_write_data() and (can_access_company(company_id) or rep_id = auth.uid()));

-- follow_ups: parent company, or assigned directly to this rep.
drop policy if exists "follow_ups_access" on follow_ups;
drop policy if exists "follow_ups_select" on follow_ups;
create policy "follow_ups_select" on follow_ups for select
  using (is_active_user() and (can_access_company(company_id) or assigned_to = auth.uid()));

drop policy if exists "follow_ups_write" on follow_ups;
create policy "follow_ups_write" on follow_ups for all
  using (can_write_data() and (can_access_company(company_id) or assigned_to = auth.uid()))
  with check (can_write_data() and (can_access_company(company_id) or assigned_to = auth.uid()));

-- sto_agreements: parent company, or built by this rep. A rep who drafted an
-- agreement keeps it even if the company is later reassigned, the same way a
-- follow-up assigned to them survives.
drop policy if exists "sto_agreements_access" on sto_agreements;
drop policy if exists "sto_agreements_select" on sto_agreements;
create policy "sto_agreements_select" on sto_agreements for select
  using (is_active_user() and (can_access_company(company_id) or created_by = auth.uid()));

drop policy if exists "sto_agreements_write" on sto_agreements;
create policy "sto_agreements_write" on sto_agreements for all
  using (can_write_data() and (can_access_company(company_id) or created_by = auth.uid()))
  with check (can_write_data() and (can_access_company(company_id) or created_by = auth.uid()));

-- sto_agreement_items: follow the agreement they belong to. security definer
-- on the helper for the same reasons as can_access_company -- it reads
-- sto_agreements, whose own policy would otherwise be evaluated per line.
create or replace function can_access_agreement(aid uuid)
returns boolean as $$
  select is_active_user() and exists (
    select 1 from sto_agreements a
    where a.id = aid
      and (can_access_company(a.company_id) or a.created_by = auth.uid())
  );
$$ language sql security definer stable set search_path = public, pg_temp;

drop policy if exists "sto_agreement_items_access" on sto_agreement_items;
drop policy if exists "sto_agreement_items_select" on sto_agreement_items;
create policy "sto_agreement_items_select" on sto_agreement_items for select
  using (can_access_agreement(agreement_id));

drop policy if exists "sto_agreement_items_write" on sto_agreement_items;
create policy "sto_agreement_items_write" on sto_agreement_items for all
  using (can_write_data() and can_access_agreement(agreement_id))
  with check (can_write_data() and can_access_agreement(agreement_id));

-- sent_messages: parent company, or sent by this rep. company_id is nullable,
-- so the sent_by fallback is what keeps a company-less log entry reachable.
drop policy if exists "sent_messages_access" on sent_messages;
drop policy if exists "sent_messages_select" on sent_messages;
create policy "sent_messages_select" on sent_messages for select
  using (
    is_active_user()
    and ((company_id is not null and can_access_company(company_id)) or sent_by = auth.uid())
  );

drop policy if exists "sent_messages_write" on sent_messages;
create policy "sent_messages_write" on sent_messages for all
  using (
    can_write_data()
    and ((company_id is not null and can_access_company(company_id)) or sent_by = auth.uid())
  )
  with check (
    can_write_data()
    and ((company_id is not null and can_access_company(company_id)) or sent_by = auth.uid())
  );

-- Shared reference data: every active team member reads it, data.write edits
-- it. Viewers get the rate card and the templates read-only, like everything
-- else.
do $$
declare
  t text;
begin
  foreach t in array array['sto_rate_card', 'email_templates', 'pricing_documents']
  loop
    execute format('drop policy if exists "%s_all_authenticated" on %I', t, t);
    execute format('drop policy if exists "%s_select" on %I', t, t);
    execute format(
      'create policy "%s_select" on %I for select using (is_active_user())', t, t
    );
    execute format('drop policy if exists "%s_write" on %I', t, t);
    execute format(
      'create policy "%s_write" on %I for all using (can_write_data()) with check (can_write_data())',
      t, t
    );
  end loop;
end $$;

-- ============================================================================
-- STORAGE: the `pricing` bucket
-- ============================================================================
-- Holds the price list PDFs. The bucket is PUBLIC, and that is a deliberate
-- trade-off worth understanding before you run this:
--
--   The whole point is that a client receives a link they can open. A signed
--   URL expires (a week at most), which would break every quote already sent.
--   A public bucket gives a permanent link instead.
--
--   "Public" means anyone holding the URL can read the file — it is unlisted,
--   not secret. Files are stored under a random uuid, so the URL cannot be
--   guessed, but treat it as you would treat emailing the PDF: once it is out,
--   it is out. Do not put anything in this bucket you would not send a client.
--
-- Writing requires an active team member holding data.write; only reading is
-- open.
insert into storage.buckets (id, name, public)
values ('pricing', 'pricing', true)
on conflict (id) do update set public = true;

drop policy if exists "pricing_public_read" on storage.objects;
create policy "pricing_public_read" on storage.objects for select
  using (bucket_id = 'pricing');

drop policy if exists "pricing_authenticated_insert" on storage.objects;
create policy "pricing_authenticated_insert" on storage.objects for insert
  with check (bucket_id = 'pricing' and public.can_write_data());

drop policy if exists "pricing_authenticated_update" on storage.objects;
create policy "pricing_authenticated_update" on storage.objects for update
  using (bucket_id = 'pricing' and public.can_write_data());

drop policy if exists "pricing_authenticated_delete" on storage.objects;
create policy "pricing_authenticated_delete" on storage.objects for delete
  using (bucket_id = 'pricing' and public.can_write_data());

-- @@BEGIN:migrations/0003_sto_rate_agreements.sql@@
-- Generated from supabase/migrations/0003_sto_rate_agreements.sql by supabase/build-schema.mjs.
-- Edit that file, then run `npm run sync:schema`.

-- ============================================================================
-- 0003 — STO RATE AGREEMENTS (versions, sends, acceptance)
-- ============================================================================
-- What Zondela actually sends an operator is not an invoice. It is the season's
-- rate sheet for Zondela House — the same document for everybody, published
-- once a year, sent to many tour operators, and accepted by each of them.
--
-- The 0001/0002 model was invoice-shaped: one agreement per company, priced
-- line by line with quantities and a discount. This replaces it with three
-- tables that match the real thing:
--
--   1. sto_agreement_versions — the season's rate agreement. Carries the PDF
--      as uploaded (what the operator asked for) *and* the rates as data (what
--      the CRM renders, what the accept page shows, what reports describe).
--   2. sto_version_rates — one row per room type per season inside a version.
--   3. sto_agreement_sends — one row per operator the version went to, with
--      where it got to: sent, viewed, accepted, declined.
--
-- Acceptance happens on a public page reached by a token in the email. No
-- login, and no tax details asked for — the operator confirms who they are and
-- accepts the rates, and that is the whole record.
--
-- The old sto_agreements / sto_agreement_items tables are left in place and
-- untouched: they hold real history, and dropping them would lose it. Nothing
-- in the app writes to them any more.
--
-- Included verbatim in schema.sql; run on its own to apply just this to a live
-- database. Idempotent.

-- ----------------------------------------------------------------------------
-- VERSIONS
-- ----------------------------------------------------------------------------
create table if not exists sto_agreement_versions (
  id uuid primary key default gen_random_uuid(),
  -- What the team calls it: "Zondela House STO Rates 2026".
  name text not null,
  -- The season the rates are for. Separate from valid_from/valid_to because a
  -- 2026 sheet is often published in 2025 and quoted as "the 2026 rates".
  year int not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  valid_from date,
  valid_to date,

  -- Prose. `summary` is the one-line description read in lists and reports;
  -- `intro` is what the operator reads above the rates on the accept page;
  -- `terms` is the conditions block under them.
  summary text,
  intro text,
  terms text,

  -- The uploaded rate sheet, kept exactly as supplied. The CRM renders its own
  -- branded version from sto_version_rates, but the operator still gets the
  -- original: it is the document they know. Key into the `sto` bucket below.
  pdf_path text,
  pdf_name text,
  pdf_size_bytes bigint not null default 0,

  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sto_agreement_versions_year_idx
  on sto_agreement_versions(year desc);
create index if not exists sto_agreement_versions_status_idx
  on sto_agreement_versions(status);

-- ----------------------------------------------------------------------------
-- RATES (room type × season, inside one version)
-- ----------------------------------------------------------------------------
-- Zondela House is one property, so the scope of a version is its room types
-- and the seasons they are priced for. Both are free text rather than lookup
-- tables: a season is renamed ("Green season", "Festive") more often than a
-- schema should have to be migrated, and the rate sheet is the authority.
create table if not exists sto_version_rates (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references sto_agreement_versions(id) on delete cascade,
  season text not null default 'All year',
  room_type text not null,
  -- How the price is read: "Per person sharing, half board", "Per room, B&B".
  basis text,
  description text,
  price numeric(12,2) not null default 0 check (price >= 0),
  currency text not null default 'USD',
  sort_order int not null default 0
);

create index if not exists sto_version_rates_version_idx on sto_version_rates(version_id);

-- ----------------------------------------------------------------------------
-- SENDS (one operator, one version)
-- ----------------------------------------------------------------------------
create table if not exists sto_agreement_sends (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references sto_agreement_versions(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,

  -- Copied from the contact at send time. The email is the address it actually
  -- went to, and it has to stay true after the contact is edited or removed.
  to_name text,
  to_email text,

  -- What the emailed button points at. Random rather than the row id: the id
  -- appears in URLs the team shares internally, and a link that opens an
  -- agreement should not be guessable from one you have already seen.
  token text not null unique default encode(gen_random_bytes(18), 'hex'),

  status text not null default 'sent'
    check (status in ('sent', 'viewed', 'accepted', 'declined')),
  subject text,
  body text,
  -- The team's own note about this send: "asked for the 2027 rates too".
  note text,
  follow_up_at date,

  sent_by uuid references profiles(id) on delete set null,
  sent_at timestamptz not null default now(),
  viewed_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,

  -- What the operator typed on the accept page. Their name and their words —
  -- no tax numbers, no registration details: Zondela is publishing rates, not
  -- onboarding a supplier.
  responded_name text,
  responded_email text,
  responded_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sto_agreement_sends_version_idx on sto_agreement_sends(version_id);
create index if not exists sto_agreement_sends_company_idx on sto_agreement_sends(company_id);
create index if not exists sto_agreement_sends_status_idx on sto_agreement_sends(status);

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- Same rule as the rest of the business data: any active user reads, only
-- someone with data.write changes anything. A version is company-independent,
-- so there is nothing to scope by owner; a send is scoped by nothing either,
-- because knowing the season's rates went to an operator is not private
-- between reps the way a company's notes are.
alter table sto_agreement_versions enable row level security;
alter table sto_version_rates enable row level security;
alter table sto_agreement_sends enable row level security;

drop policy if exists "sto_agreement_versions_select" on sto_agreement_versions;
create policy "sto_agreement_versions_select" on sto_agreement_versions for select
  using (public.is_active_user());

drop policy if exists "sto_agreement_versions_write" on sto_agreement_versions;
create policy "sto_agreement_versions_write" on sto_agreement_versions for all
  using (public.can_write_data()) with check (public.can_write_data());

drop policy if exists "sto_version_rates_select" on sto_version_rates;
create policy "sto_version_rates_select" on sto_version_rates for select
  using (public.is_active_user());

drop policy if exists "sto_version_rates_write" on sto_version_rates;
create policy "sto_version_rates_write" on sto_version_rates for all
  using (public.can_write_data()) with check (public.can_write_data());

drop policy if exists "sto_agreement_sends_select" on sto_agreement_sends;
create policy "sto_agreement_sends_select" on sto_agreement_sends for select
  using (public.is_active_user());

drop policy if exists "sto_agreement_sends_write" on sto_agreement_sends;
create policy "sto_agreement_sends_write" on sto_agreement_sends for all
  using (public.can_write_data()) with check (public.can_write_data());

-- ----------------------------------------------------------------------------
-- THE PUBLIC SIDE
-- ----------------------------------------------------------------------------
-- The operator has no login, so the accept page reaches the database as `anon`.
-- Rather than open the tables to anon and rely on a policy to hold the line,
-- three security-definer functions are the entire public surface: they take a
-- token, act on exactly the one row it names, and return only what the page
-- prints. There is no way to ask them for a list, and no anon grant on any
-- table to fall back on.

-- Everything the accept page shows, for one token. Also records the view: the
-- first open moves a send from sent to viewed, which is the only "delivered"
-- signal Zondela gets without an email provider wired up.
create or replace function public.sto_public_agreement(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_send sto_agreement_sends;
  v_version sto_agreement_versions;
  v_org org_settings;
  v_company text;
begin
  select * into v_send from sto_agreement_sends where token = p_token;
  if not found then
    return null;
  end if;

  -- Opening the link is not an answer, so a send that has already been
  -- accepted or declined keeps the status it earned.
  if v_send.status = 'sent' then
    update sto_agreement_sends
      set status = 'viewed', viewed_at = coalesce(viewed_at, now()), updated_at = now()
      where id = v_send.id
      returning * into v_send;
  end if;

  select * into v_version from sto_agreement_versions where id = v_send.version_id;
  select * into v_org from org_settings where id = 1;
  select name into v_company from companies where id = v_send.company_id;

  return jsonb_build_object(
    'send', jsonb_build_object(
      'status', v_send.status,
      'to_name', v_send.to_name,
      'company_name', v_company,
      'sent_at', v_send.sent_at,
      'viewed_at', v_send.viewed_at,
      'accepted_at', v_send.accepted_at,
      'declined_at', v_send.declined_at,
      'responded_name', v_send.responded_name,
      'responded_note', v_send.responded_note
    ),
    'version', jsonb_build_object(
      'name', v_version.name,
      'year', v_version.year,
      'summary', v_version.summary,
      'intro', v_version.intro,
      'terms', v_version.terms,
      'valid_from', v_version.valid_from,
      'valid_to', v_version.valid_to,
      'pdf_path', v_version.pdf_path,
      'pdf_name', v_version.pdf_name
    ),
    'rates', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', r.id,
            'season', r.season,
            'room_type', r.room_type,
            'basis', r.basis,
            'description', r.description,
            'price', r.price,
            'currency', r.currency
          ) order by r.sort_order, r.room_type
        )
        from sto_version_rates r
        where r.version_id = v_version.id
      ),
      '[]'::jsonb
    ),
    'org', jsonb_build_object(
      'org_name', v_org.org_name,
      'legal_name', v_org.legal_name,
      'tagline', v_org.tagline,
      'address', v_org.address,
      'city', v_org.city,
      'country', v_org.country,
      'phone', v_org.phone,
      'email', v_org.email,
      'website', v_org.website,
      'logo_url', v_org.logo_url,
      'brand_color', v_org.brand_color,
      'accent_color', v_org.accent_color,
      'agreement_footer', v_org.agreement_footer,
      'signatory_name', v_org.signatory_name,
      'signatory_title', v_org.signatory_title
    )
  );
end;
$$;

-- The answer. Accepting twice is not an error — a client who clicks the button
-- again should see the same confirmation, not a failure — so the first answer
-- stands and is returned unchanged.
create or replace function public.sto_public_respond(
  p_token text,
  p_accept boolean,
  p_name text default null,
  p_email text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_send sto_agreement_sends;
begin
  select * into v_send from sto_agreement_sends where token = p_token;
  if not found then
    return null;
  end if;

  if v_send.status in ('accepted', 'declined') then
    return jsonb_build_object(
      'status', v_send.status,
      'accepted_at', v_send.accepted_at,
      'declined_at', v_send.declined_at,
      'responded_name', v_send.responded_name,
      'already', true
    );
  end if;

  update sto_agreement_sends
    set status = case when p_accept then 'accepted' else 'declined' end,
        accepted_at = case when p_accept then now() else accepted_at end,
        declined_at = case when p_accept then declined_at else now() end,
        responded_name = nullif(btrim(coalesce(p_name, '')), ''),
        responded_email = nullif(btrim(coalesce(p_email, '')), ''),
        responded_note = nullif(btrim(coalesce(p_note, '')), ''),
        updated_at = now()
    where id = v_send.id
    returning * into v_send;

  return jsonb_build_object(
    'status', v_send.status,
    'accepted_at', v_send.accepted_at,
    'declined_at', v_send.declined_at,
    'responded_name', v_send.responded_name,
    'already', false
  );
end;
$$;

revoke all on function public.sto_public_agreement(text) from public;
revoke all on function public.sto_public_respond(text, boolean, text, text, text) from public;
grant execute on function public.sto_public_agreement(text) to anon, authenticated;
grant execute on function public.sto_public_respond(text, boolean, text, text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- STORAGE — the uploaded rate sheet
-- ----------------------------------------------------------------------------
-- Public read, like `pricing`: the operator opens the PDF from an email and
-- from the accept page, with no session either time. The path is a random
-- uuid, so the URL cannot be guessed from another one.
insert into storage.buckets (id, name, public)
values ('sto', 'sto', true)
on conflict (id) do update set public = true;

drop policy if exists "sto_public_read" on storage.objects;
create policy "sto_public_read" on storage.objects for select
  using (bucket_id = 'sto');

drop policy if exists "sto_write_insert" on storage.objects;
create policy "sto_write_insert" on storage.objects for insert
  with check (bucket_id = 'sto' and public.can_write_data());

drop policy if exists "sto_write_update" on storage.objects;
create policy "sto_write_update" on storage.objects for update
  using (bucket_id = 'sto' and public.can_write_data());

drop policy if exists "sto_write_delete" on storage.objects;
create policy "sto_write_delete" on storage.objects for delete
  using (bucket_id = 'sto' and public.can_write_data());

-- @@END:migrations/0003_sto_rate_agreements.sql@@

-- @@BEGIN:migrations/0004_sto_rate_contract_shape.sql@@
-- Generated from supabase/migrations/0004_sto_rate_contract_shape.sql by supabase/build-schema.mjs.
-- Edit that file, then run `npm run sync:schema`.

-- ============================================================================
-- 0004 — THE RATE CONTRACT'S REAL SHAPE
-- ============================================================================
-- 0003 modelled a rate as one price with a basis written beside it. The actual
-- Zondela House contract does not work that way, and the document is the
-- authority: a room type is quoted at three prices at once — bed & breakfast,
-- half board, full board — and carries the number of people it sleeps.
--
--   ROOM TYPE          STO BB   STO HB   STO FB   MAX OCCUPANCY
--   Standard Single      130      150      170          1
--   Standard Double      170      210      250          2
--   …
--
-- Three things follow from reading the contract properly:
--
--   1. sto_version_rates gains bb_price, hb_price, fb_price and max_occupancy,
--      and loses the single price/basis pair. The old price is copied into
--      bb_price first, so nothing entered under 0003 is lost.
--   2. Supplements are their own list (lunch $20 per person, dinner $20 per
--      person) — priced per person, not per room, so they cannot sit in the
--      rates table without lying about what the number means.
--   3. The contract is mostly *prose*: children's policy, tour leader,
--      check-in/out, deposit, cancellation, no-show. Those are numbered
--      sections in the PDF, so they are rows here rather than one blob of
--      terms — the document renders them numbered, and each can be edited on
--      its own next season.
--
-- The acceptance block gains the signatory's title, because that is what the
-- paper contract asks for under the client's signature.
--
-- Included verbatim in schema.sql; run on its own to apply just this to a live
-- database. Idempotent.

-- ----------------------------------------------------------------------------
-- RATES: three meal plans, one row
-- ----------------------------------------------------------------------------
alter table sto_version_rates add column if not exists bb_price numeric(12,2) not null default 0;
alter table sto_version_rates add column if not exists hb_price numeric(12,2) not null default 0;
alter table sto_version_rates add column if not exists fb_price numeric(12,2) not null default 0;
alter table sto_version_rates add column if not exists max_occupancy int not null default 2;

-- Carry anything entered under 0003 across before the column goes.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sto_version_rates' and column_name = 'price'
  ) then
    update sto_version_rates set bb_price = price where bb_price = 0 and price > 0;
    alter table sto_version_rates drop column price;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sto_version_rates' and column_name = 'basis'
  ) then
    alter table sto_version_rates drop column basis;
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- VERSION: how the rates are read, and the line under the table
-- ----------------------------------------------------------------------------
-- Both are printed on the document and both change wording between seasons, so
-- they are fields rather than strings in the renderer.
alter table sto_agreement_versions
  add column if not exists rate_basis text default 'Per room, per night';
alter table sto_agreement_versions
  add column if not exists rates_note text
  default 'All rates quoted are inclusive of VAT and Tourism development levy.';

-- ----------------------------------------------------------------------------
-- SUPPLEMENTS (priced per person, alongside the room)
-- ----------------------------------------------------------------------------
create table if not exists sto_version_supplements (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references sto_agreement_versions(id) on delete cascade,
  name text not null,
  description text,
  price numeric(12,2) not null default 0 check (price >= 0),
  currency text not null default 'USD',
  unit text not null default 'per person',
  sort_order int not null default 0
);

create index if not exists sto_version_supplements_version_idx
  on sto_version_supplements(version_id);

-- ----------------------------------------------------------------------------
-- SECTIONS (the numbered policies that make up most of the contract)
-- ----------------------------------------------------------------------------
create table if not exists sto_version_sections (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references sto_agreement_versions(id) on delete cascade,
  title text not null,
  -- Free text, blank line separated. Bullet lines starting with • or - are
  -- rendered as a list by the document; everything else is a paragraph.
  body text not null default '',
  sort_order int not null default 0
);

create index if not exists sto_version_sections_version_idx
  on sto_version_sections(version_id);

alter table sto_version_supplements enable row level security;
alter table sto_version_sections enable row level security;

drop policy if exists "sto_version_supplements_select" on sto_version_supplements;
create policy "sto_version_supplements_select" on sto_version_supplements for select
  using (public.is_active_user());

drop policy if exists "sto_version_supplements_write" on sto_version_supplements;
create policy "sto_version_supplements_write" on sto_version_supplements for all
  using (public.can_write_data()) with check (public.can_write_data());

drop policy if exists "sto_version_sections_select" on sto_version_sections;
create policy "sto_version_sections_select" on sto_version_sections for select
  using (public.is_active_user());

drop policy if exists "sto_version_sections_write" on sto_version_sections;
create policy "sto_version_sections_write" on sto_version_sections for all
  using (public.can_write_data()) with check (public.can_write_data());

-- ----------------------------------------------------------------------------
-- ACCEPTANCE: the signature block the paper contract asks for
-- ----------------------------------------------------------------------------
-- Name in print and position/title, which is what the client signs under. No
-- tax or registration details: Zondela is publishing rates, not onboarding a
-- supplier.
alter table sto_agreement_sends add column if not exists responded_title text;

-- ----------------------------------------------------------------------------
-- THE PUBLIC SIDE, WITH THE FULL CONTRACT
-- ----------------------------------------------------------------------------
create or replace function public.sto_public_agreement(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_send sto_agreement_sends;
  v_version sto_agreement_versions;
  v_org org_settings;
  v_company text;
begin
  select * into v_send from sto_agreement_sends where token = p_token;
  if not found then
    return null;
  end if;

  -- Opening the link is not an answer, so a send that has already been
  -- accepted or declined keeps the status it earned.
  if v_send.status = 'sent' then
    update sto_agreement_sends
      set status = 'viewed', viewed_at = coalesce(viewed_at, now()), updated_at = now()
      where id = v_send.id
      returning * into v_send;
  end if;

  select * into v_version from sto_agreement_versions where id = v_send.version_id;
  select * into v_org from org_settings where id = 1;
  select name into v_company from companies where id = v_send.company_id;

  return jsonb_build_object(
    'send', jsonb_build_object(
      'status', v_send.status,
      'to_name', v_send.to_name,
      'company_name', v_company,
      'sent_at', v_send.sent_at,
      'viewed_at', v_send.viewed_at,
      'accepted_at', v_send.accepted_at,
      'declined_at', v_send.declined_at,
      'responded_name', v_send.responded_name,
      'responded_title', v_send.responded_title,
      'responded_note', v_send.responded_note
    ),
    'version', jsonb_build_object(
      'name', v_version.name,
      'year', v_version.year,
      'summary', v_version.summary,
      'intro', v_version.intro,
      'terms', v_version.terms,
      'rate_basis', v_version.rate_basis,
      'rates_note', v_version.rates_note,
      'valid_from', v_version.valid_from,
      'valid_to', v_version.valid_to,
      'pdf_path', v_version.pdf_path,
      'pdf_name', v_version.pdf_name
    ),
    'rates', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', r.id,
            'season', r.season,
            'room_type', r.room_type,
            'description', r.description,
            'bb_price', r.bb_price,
            'hb_price', r.hb_price,
            'fb_price', r.fb_price,
            'max_occupancy', r.max_occupancy,
            'currency', r.currency
          ) order by r.sort_order, r.room_type
        )
        from sto_version_rates r
        where r.version_id = v_version.id
      ),
      '[]'::jsonb
    ),
    'supplements', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', s.id,
            'name', s.name,
            'description', s.description,
            'price', s.price,
            'currency', s.currency,
            'unit', s.unit
          ) order by s.sort_order, s.name
        )
        from sto_version_supplements s
        where s.version_id = v_version.id
      ),
      '[]'::jsonb
    ),
    'sections', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('id', x.id, 'title', x.title, 'body', x.body)
          order by x.sort_order
        )
        from sto_version_sections x
        where x.version_id = v_version.id
      ),
      '[]'::jsonb
    ),
    'org', jsonb_build_object(
      'org_name', v_org.org_name,
      'legal_name', v_org.legal_name,
      'tagline', v_org.tagline,
      'address', v_org.address,
      'city', v_org.city,
      'country', v_org.country,
      'phone', v_org.phone,
      'email', v_org.email,
      'website', v_org.website,
      'logo_url', v_org.logo_url,
      'brand_color', v_org.brand_color,
      'accent_color', v_org.accent_color,
      'agreement_footer', v_org.agreement_footer,
      'signatory_name', v_org.signatory_name,
      'signatory_title', v_org.signatory_title
    )
  );
end;
$$;

-- The signature block gained a title, so the old four-argument version is
-- replaced rather than overloaded — two functions answering the same call is
-- how one of them silently stops being the one that runs.
drop function if exists public.sto_public_respond(text, boolean, text, text, text);

create or replace function public.sto_public_respond(
  p_token text,
  p_accept boolean,
  p_name text default null,
  p_title text default null,
  p_email text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_send sto_agreement_sends;
begin
  select * into v_send from sto_agreement_sends where token = p_token;
  if not found then
    return null;
  end if;

  -- Accepting twice is not an error — a client who clicks again should see the
  -- same confirmation — so the first answer stands and is returned unchanged.
  if v_send.status in ('accepted', 'declined') then
    return jsonb_build_object(
      'status', v_send.status,
      'accepted_at', v_send.accepted_at,
      'declined_at', v_send.declined_at,
      'responded_name', v_send.responded_name,
      'already', true
    );
  end if;

  update sto_agreement_sends
    set status = case when p_accept then 'accepted' else 'declined' end,
        accepted_at = case when p_accept then now() else accepted_at end,
        declined_at = case when p_accept then declined_at else now() end,
        responded_name = nullif(btrim(coalesce(p_name, '')), ''),
        responded_title = nullif(btrim(coalesce(p_title, '')), ''),
        responded_email = nullif(btrim(coalesce(p_email, '')), ''),
        responded_note = nullif(btrim(coalesce(p_note, '')), ''),
        updated_at = now()
    where id = v_send.id
    returning * into v_send;

  return jsonb_build_object(
    'status', v_send.status,
    'accepted_at', v_send.accepted_at,
    'declined_at', v_send.declined_at,
    'responded_name', v_send.responded_name,
    'already', false
  );
end;
$$;

revoke all on function public.sto_public_agreement(text) from public;
revoke all on function public.sto_public_respond(text, boolean, text, text, text, text) from public;
grant execute on function public.sto_public_agreement(text) to anon, authenticated;
grant execute on function public.sto_public_respond(text, boolean, text, text, text, text)
  to anon, authenticated;

-- @@END:migrations/0004_sto_rate_contract_shape.sql@@

-- ============================================================================
-- SEED DATA
-- ============================================================================
-- None. The schema installs empty; publish the season's rate agreement on the
-- STO page's Agreement versions tab, then send it to your operators.
