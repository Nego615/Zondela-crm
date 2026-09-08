-- ============================================================================
-- 0009 — DELETING ACCOUNTS IS ADMIN'S TOO
-- ============================================================================
-- 0001 held users.delete back to Super Admin, on the reasoning that an Admin
-- with full user management still should not hold the one action that cannot
-- be undone. In practice the roster is run by Admins, and routing every
-- departure through the one Super Admin account made deactivation the default
-- for people who had actually left — which leaves their row in every list and
-- their name on every dropdown.
--
-- So the grant moves to Admin. Nothing else changes, and nothing else needs
-- to: assert_can_delete_user(), log_user_deleted() and the profiles_delete_admin
-- policy all read has_permission('users.delete') rather than testing a role
-- name, so this one row is the whole switch.
--
-- The guards that remain are the ones that matter more than the role does.
-- assert_can_manage_user() still refuses the caller's own row and anyone at or
-- above their own rank, so an Admin can remove Managers, Staff and Viewers,
-- and cannot touch another Admin, a Super Admin, or themselves.
-- ============================================================================

insert into role_permissions (role, permission)
values ('admin', 'users.delete')
on conflict (role, permission) do nothing;
