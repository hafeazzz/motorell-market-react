-- 0018: hanya owner/service_role yang boleh mengubah profiles.role.
-- Admin tetap boleh menonaktifkan akun (deleted_at). Menutup celah admin -> owner lewat self-update.
create or replace function public.profiles_protect_privileged_cols()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and not (public.is_owner() or auth.role() = 'service_role') then
    raise exception 'Hanya owner yang boleh mengubah role'
      using errcode = '42501';
  end if;

  if new.deleted_at is distinct from old.deleted_at
     and not (public.is_staff_admin() or public.is_owner() or auth.role() = 'service_role') then
    raise exception 'Tidak boleh mengubah deleted_at pada baris sendiri'
      using errcode = '42501';
  end if;

  if new.role is distinct from old.role then
    insert into public.audit_log (admin_id, action, target_user_id, target_email, reason)
    values (
      coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
      'role_changed',
      new.id,
      new.email,
      'role: ' || coalesce(old.role::text, 'NULL') || ' -> ' || coalesce(new.role::text, 'NULL')
    );
  end if;

  return new;
end;
$$;