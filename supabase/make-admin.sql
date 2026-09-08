-- ============================================================================
-- PROMOTE AN EXISTING ACCOUNT TO ADMIN
-- ============================================================================
-- The normal way to change someone's role is Admin → Users → Change role,
-- which needs someone senior already signed in. This is the way round that
-- when there isn't one to hand: it grants Admin to a login that exists.
--
-- It is the Admin counterpart to bootstrap-super-admin.sql, and works the same
-- way — it does not create a login, only a role. Safe to re-run, and safe to
-- point at a second address later.
--
-- Set v_email and v_name in step 2 and run the file.
--
-- IF THE ACCOUNT DOES NOT EXIST YET
-- ---------------------------------
--   1. Dashboard → Authentication → Users → "Add user" → "Create new user".
--        Email:    the address you are about to put in step 2
--        Password: set it here, in the dashboard. Never in this file — this
--                  file is in git, and a password committed to git is a
--                  password to change, not a password to keep.
--        Tick "Auto Confirm User", or the account stays pending until the
--        confirmation mail is opened.
--   2. Under "User Metadata" on that same screen, set the display name:
--        { "full_name": "Their Name" }
--      handle_new_user() copies it into the profile. If you skip it, step 2
--      below fills it in anyway.

-- ---------------------------------------------------------------------------
-- STEP 1 — find the address
-- ---------------------------------------------------------------------------
-- Every login in the system and the role it currently holds. Use it to get the
-- address exactly right: the promotion matches on email, and an address that
-- matches nothing raises rather than guessing.
select u.id,
       u.email,
       p.full_name,
       p.role,
       p.status,
       u.email_confirmed_at
from auth.users u
left join profiles p on p.id = u.id
order by u.created_at;

-- ---------------------------------------------------------------------------
-- STEP 2 — the promotion
-- ---------------------------------------------------------------------------
do $$
declare
  -- ---- THE ONLY TWO LINES TO EDIT ----------------------------------------
  v_email text := 'change-me@example.com';
  v_name  text := 'Their Name';
  -- ------------------------------------------------------------------------

  v_id uuid;
  v_old_role text;
begin
  select id into v_id from auth.users where lower(email) = lower(trim(v_email));
  if v_id is null then
    raise exception
      'No account with email %. Check the list from step 1, or create the login first (Authentication → Users → Add user).',
      v_email;
  end if;

  -- handle_new_user() will have made this row already; the insert is only for
  -- the case where the trigger was not in place when the login was created.
  insert into profiles (id, email, full_name, role, status)
  values (v_id, trim(v_email), v_name, 'admin', 'active')
  on conflict (id) do nothing;

  select role into v_old_role from profiles where id = v_id;

  if v_old_role = 'super_admin' then
    raise exception
      '% is a Super Admin. This script would demote them, which is not what it is for.',
      v_email;
  end if;

  -- role and status are guarded columns: the trigger on profiles refuses them
  -- to anything in a request context, so a legitimate write announces itself
  -- the way set_user_role() does. In the SQL editor the caller is postgres and
  -- the guard would pass regardless; this keeps the two paths identical.
  perform set_config('app.privileged_profile_write', 'on', true);
  update profiles
     set role = 'admin',
         status = 'active',
         full_name = case when full_name = '' then v_name else full_name end
   where id = v_id;

  -- Every role change is in the log, including this one. An account that
  -- appears with no history behind it is the thing an audit trail is for.
  -- user.promote_admin is the action the app already renders as "promoted X
  -- from Y to Z"; an invented one would print as raw text in Admin → Logs.
  perform log_activity(
    'user.promote_admin', v_id, v_old_role, 'admin',
    jsonb_build_object('source', 'database setup'), v_id
  );

  raise notice '% is now an active Admin (was %).', v_email, v_old_role;
end;
$$;

-- ---------------------------------------------------------------------------
-- STEP 3 — check it landed
-- ---------------------------------------------------------------------------
select email, full_name, role, status
from profiles
order by role, email;

-- ---------------------------------------------------------------------------
-- WHAT AN ADMIN CANNOT DO
-- ---------------------------------------------------------------------------
-- Admin manages users and operational data, but not Super Admins — it holds
-- neither users.manage_admins nor settings.manage, and may only hand out roles
-- below its own. That last one matters here: an Admin cannot appoint another
-- Admin. If this account is meant to run the system on its own, use
-- bootstrap-super-admin.sql instead, which mints a Super Admin.
--
-- Reload the page to pick the new role up. The profile and my_permissions()
-- are read when the session loads, so a tab that is already open keeps the
-- permissions it started with until it is refreshed.
