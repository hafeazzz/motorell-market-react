-- ============================================================
-- 0010 — Peran 'inactive' (Tanpa Akses) + admin boleh nonaktifkan user biasa.
--
-- KENAPA BUKAN cara di snippet:
--   • `role` adalah VARCHAR + CHECK constraint (0007/0008), BUKAN enum. Snippet
--     `ALTER TYPE public.user_role ADD VALUE 'inactive'` → error: type tak ada.
--     Yang benar: ubah CHECK constraint (di bawah).
--   • Snippet profiles_delete_admin memakai (SELECT role FROM profiles WHERE
--     id=auth.uid()) DI DALAM policy profiles → REKURSIF (infinite recursion).
--     Di sini semua pakai is_staff_admin()/is_owner() (SECURITY DEFINER, 0007).
--   • Snippet WITH CHECK memakai `NEW.role` (sintaks TRIGGER, bukan RLS) → tak
--     kompilasi. RLS mengacu kolom langsung: `role`.
--   • Snippet update policy cuma membatasi role BARU, bukan SASARANNYA → admin
--     bisa set OWNER jadi buyer (lockout). Di sini USING membatasi baris sasaran
--     (peran LAMA harus user biasa), WITH CHECK membatasi peran baru.
--   • TANPA policy DELETE: hapus baris profiles TIDAK menghapus auth.users
--     (cascade jalan sebaliknya) → user tetap bisa login & tak bisa daftar ulang.
--     Hapus akun sejati butuh Edge Function service_role (auth.admin.deleteUser).
--
-- Idempoten. Butuh 0007 (is_staff_admin, is_owner, profiles_update_owner).
-- Supabase → SQL Editor → Run.
-- ============================================================

-- 1) Izinkan 'inactive' pada CHECK constraint.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role is null or role in ('owner', 'admin', 'kurator', 'buyer', 'inactive'));

-- 2) Admin/owner boleh MENGUBAH baris PENGGUNA BIASA saja (peran lama
--    buyer/inactive/null) dan HANYA ke buyer/inactive → aktif/nonaktif.
--    • TAK bisa menyentuh staf (admin/kurator/owner)  → USING menyaring sasaran.
--    • TAK bisa promote (mis. ke admin)                → WITH CHECK menyaring hasil.
--    Owner tetap berkuasa penuh lewat profiles_update_owner (0007, di-OR-kan).
drop policy if exists profiles_update_admin_deactivate on public.profiles;
create policy profiles_update_admin_deactivate on public.profiles
  for update to authenticated
  using (public.is_staff_admin() and (role is null or role in ('buyer', 'inactive')))
  with check (role in ('buyer', 'inactive'));

-- ============================================================
-- VERIFIKASI (opsional)
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid='public.profiles'::regclass and conname='profiles_role_check';
-- select polname, cmd, qual, with_check from pg_policies
--   where tablename='profiles' and polname like 'profiles_update%';
-- ============================================================
