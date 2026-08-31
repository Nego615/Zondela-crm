-- Zondela CRM schema
-- Run this in your Supabase project's SQL editor (Database > SQL Editor > New query).
-- Safe to re-run: uses "create table if not exists" and drops/recreates policies.

-- ============================================================================
-- EXTENSIONS
-- ============================================================================
create extension if not exists "pgcrypto";

-- ============================================================================
-- PROFILES (team members)
-- Mirrors auth.users with app-specific fields (role, display name).
-- A row is created automatically when someone signs up (see trigger below).
-- ============================================================================
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null,
  role text not null default 'marketing' check (role in ('owner', 'marketing')),
  created_at timestamptz not null default now()
);

-- Auto-create a profile row when a new user signs up via Supabase Auth.
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''));
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ============================================================================
-- COMPANIES (the pipeline)
-- ============================================================================
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  industry text,
  website text,
  address text,
  city text,
  stage text not null default 'lead'
    check (stage in ('lead', 'contacted', 'site_visit', 'proposal_sent', 'negotiation', 'won', 'lost')),
  notes text,
  owner_id uuid references profiles(id) on delete set null,
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

drop trigger if exists templates_set_updated_at on email_templates;
create trigger templates_set_updated_at
  before update on email_templates
  for each row execute procedure set_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
--
-- Visibility model — per-rep scoping:
--   * Owners see and edit everything.
--   * Marketing reps see companies assigned to them (companies.owner_id), plus
--     companies left Unassigned, which act as a shared pool of new leads any
--     rep can pick up. A rep can claim an unassigned company but cannot hand
--     one of their companies to someone else — only owners reassign.
--   * Child records (contacts, site visits, follow-ups, sent messages) follow
--     the company they belong to. A visit or follow-up assigned directly to a
--     rep stays visible to them even if the company is someone else's, so
--     delegated work doesn't vanish from their queue.
--   * The rate card and email templates are shared reference data — every
--     signed-in team member reads and edits them.
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
alter table sent_messages enable row level security;

-- Helper: is the current user an owner?
create or replace function is_owner()
returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'owner'
  );
$$ language sql security definer stable set search_path = public, pg_temp;

-- Helper: can the current user see this company?
-- security definer on purpose: the lookup bypasses RLS on companies, which
-- both avoids policy recursion when child tables call it and keeps it fast
-- (one indexed lookup instead of a nested policy evaluation per row).
create or replace function can_access_company(cid uuid)
returns boolean as $$
  select exists (
    select 1 from companies c
    where c.id = cid
      and (is_owner() or c.owner_id = auth.uid() or c.owner_id is null)
  );
$$ language sql security definer stable set search_path = public, pg_temp;

-- profiles: everyone signed in can view all profiles (needed for assigning
-- reps to companies/visits); only the owner can edit roles.
drop policy if exists "profiles_select" on profiles;
create policy "profiles_select" on profiles for select
  using (auth.role() = 'authenticated');

drop policy if exists "profiles_update_self_or_owner" on profiles;
create policy "profiles_update_self_or_owner" on profiles for update
  using (auth.uid() = id or is_owner());

drop policy if exists "profiles_insert_owner" on profiles;
create policy "profiles_insert_owner" on profiles for insert
  with check (auth.uid() = id or is_owner());

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

-- companies: reps see their own plus the unassigned pool; owners see all.
drop policy if exists "companies_select" on companies;
create policy "companies_select" on companies for select
  using (is_owner() or owner_id = auth.uid() or owner_id is null);

-- Reps must own what they create, so a rep can't file a company under
-- someone else's name (or into the pool) and lose track of it.
drop policy if exists "companies_insert" on companies;
create policy "companies_insert" on companies for insert
  with check (is_owner() or owner_id = auth.uid());

-- `using` picks the rows a rep may edit (theirs + the pool); `with check`
-- constrains the row afterwards. A rep may claim a pool company or release
-- their own back to the pool, but cannot hand one to a named colleague --
-- `owner_id is null` in the check must stay, or a rep dragging an unassigned
-- card to a new stage would be rejected for not claiming it in the same
-- statement. Another rep's company fails `using`, so it is untouchable.
drop policy if exists "companies_update" on companies;
create policy "companies_update" on companies for update
  using (is_owner() or owner_id = auth.uid() or owner_id is null)
  with check (is_owner() or owner_id = auth.uid() or owner_id is null);

drop policy if exists "companies_delete" on companies;
create policy "companies_delete" on companies for delete
  using (is_owner() or owner_id = auth.uid());

-- contacts: follow the parent company.
drop policy if exists "contacts_access" on contacts;
create policy "contacts_access" on contacts for all
  using (can_access_company(company_id))
  with check (can_access_company(company_id));

-- site_visits: parent company, or assigned directly to this rep.
drop policy if exists "site_visits_access" on site_visits;
create policy "site_visits_access" on site_visits for all
  using (can_access_company(company_id) or rep_id = auth.uid())
  with check (can_access_company(company_id) or rep_id = auth.uid());

-- follow_ups: parent company, or assigned directly to this rep.
drop policy if exists "follow_ups_access" on follow_ups;
create policy "follow_ups_access" on follow_ups for all
  using (can_access_company(company_id) or assigned_to = auth.uid())
  with check (can_access_company(company_id) or assigned_to = auth.uid());

-- sent_messages: parent company, or sent by this rep. company_id is nullable,
-- so the sent_by fallback is what keeps a company-less log entry reachable.
drop policy if exists "sent_messages_access" on sent_messages;
create policy "sent_messages_access" on sent_messages for all
  using ((company_id is not null and can_access_company(company_id)) or sent_by = auth.uid())
  with check ((company_id is not null and can_access_company(company_id)) or sent_by = auth.uid());

-- Shared reference data: any authenticated team member reads and edits.
do $$
declare
  t text;
begin
  foreach t in array array['sto_rate_card', 'email_templates']
  loop
    execute format('drop policy if exists "%s_all_authenticated" on %I', t, t);
    execute format(
      'create policy "%s_all_authenticated" on %I for all using (auth.role() = ''authenticated'') with check (auth.role() = ''authenticated'')',
      t, t
    );
  end loop;
end $$;

-- ============================================================================
-- SEED DATA (optional, edit or remove freely)
-- ============================================================================
insert into sto_rate_card (service_name, description, price, currency, unit, sort_order)
values
  ('STO Starter', 'Basic search & directory optimization for a single location', 350000, 'TZS', 'per month', 1),
  ('STO Growth', 'Multi-page optimization, monthly reporting, 2 keyword clusters', 650000, 'TZS', 'per month', 2),
  ('STO Pro', 'Full-site optimization, competitor tracking, weekly reporting', 1200000, 'TZS', 'per month', 3),
  ('STO Enterprise', 'Custom scope for multi-location or high-competition sectors', 2500000, 'TZS', 'per month', 4)
on conflict do nothing;
