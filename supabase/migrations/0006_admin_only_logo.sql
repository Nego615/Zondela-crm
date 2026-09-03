-- ============================================================================
-- 0006 — THE LOGO IS ADMIN'S TO CHANGE
-- ============================================================================
-- settings.branding is deliberately broad: the people who send agreements are
-- the people who should be able to fix a wrong phone number on one, so Manager
-- holds it. The mark itself is not that kind of field. It is the company's
-- identity on every contract that leaves here, and a wrong one is not a typo
-- someone notices and corrects — it is a signed document with the wrong logo
-- on it.
--
-- So the logo gets its own permission, held only by Admin and Super Admin,
-- and everything that can change the logo is moved onto it:
--
--   * the `branding` bucket's writes, which is where an uploaded file lands;
--   * org_settings.logo_url itself, guarded per-column by a trigger, because
--     RLS is row-level and a Manager legitimately updates the same row.
--
-- Nobody loses the ability to edit branding. A Manager still edits every other
-- field on the letterhead; only the logo is out of reach.
-- ----------------------------------------------------------------------------

insert into permissions (key, label, description, category, sort_order) values
  ('settings.logo', 'Change the organisation logo',
   'Upload or remove the mark that heads every agreement. Admin only.',
   'Data', 136)
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  category = excluded.category,
  sort_order = excluded.sort_order;

-- 0001 clears role_permissions and re-seeds it, so this has to run after it —
-- which it does, both in schema.sql and when the files are applied in order.
insert into role_permissions (role, permission)
select r, 'settings.logo'
from unnest(array['super_admin', 'admin']) as r
on conflict do nothing;

-- A Manager who held it from an earlier install loses it here. Explicit,
-- because that is the whole point of the migration.
delete from role_permissions
where permission = 'settings.logo'
  and role not in ('super_admin', 'admin');

-- ----------------------------------------------------------------------------
-- THE COLUMN GUARD
-- ----------------------------------------------------------------------------
-- org_settings_update stays on settings.branding: a Manager updates the row.
-- This refuses the one column they may not move. Comparing the values rather
-- than checking whether logo_url was named means a form that submits every
-- field — which ours does — passes as long as the logo came back unchanged.
create or replace function guard_org_logo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.logo_url is distinct from old.logo_url
     and not has_permission('settings.logo') then
    raise exception 'Only an administrator can change the organisation logo'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_org_logo on org_settings;
create trigger guard_org_logo
  before update on org_settings
  for each row execute function guard_org_logo();

-- ----------------------------------------------------------------------------
-- STORAGE: the `branding` bucket
-- ----------------------------------------------------------------------------
-- Only the logo is uploaded here, so the bucket's writes move wholesale onto
-- the new permission. Reads stay public — a mark in a client's email has to
-- load for someone who has never signed in here.
drop policy if exists "branding_write_insert" on storage.objects;
create policy "branding_write_insert" on storage.objects for insert
  with check (bucket_id = 'branding' and public.has_permission('settings.logo'));

drop policy if exists "branding_write_update" on storage.objects;
create policy "branding_write_update" on storage.objects for update
  using (bucket_id = 'branding' and public.has_permission('settings.logo'));

drop policy if exists "branding_write_delete" on storage.objects;
create policy "branding_write_delete" on storage.objects for delete
  using (bucket_id = 'branding' and public.has_permission('settings.logo'));
