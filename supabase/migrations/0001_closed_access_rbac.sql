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
