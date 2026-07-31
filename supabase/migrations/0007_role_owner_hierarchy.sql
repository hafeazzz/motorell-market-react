-- ============================================================
-- 0007 — Hierarki peran: tambah 'owner' (super-admin) DI ATAS admin/kurator.
--
--   owner  → akses penuh; SATU-SATUNYA yang boleh promote/demote peran.
--   admin  → kelola/approve titip jual (seperti sebelumnya), TAK bisa ubah peran.
--   kurator→ (dipertahankan; peran staf lain bila dipakai).
--   NULL   → user biasa (seller/pembeli) — tanpa akses panel.
--
-- CATATAN kenapa BUKAN cara di prompt: PART 3 prompt memakai policy RLS yang
-- men-`SELECT ... FROM profiles` di dalam policy `profiles` → REKURSIF (Postgres
-- error/infinite recursion). Di sini pakai fungsi SECURITY DEFINER (is_owner /
-- is_staff_admin) yang melewati RLS — konsisten dengan 0002.
--
-- Idempoten. Jalankan di Supabase → SQL Editor → Run. (Butuh 0002 & 0005.)
-- ============================================================

-- 1) Izinkan 'owner' pada constraint role.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role is null or role in ('owner', 'admin', 'kurator'));

-- 2) is_staff_admin(): OWNER dihitung sebagai admin → mewarisi SEMUA hak admin
--    (akses panel, review titip jual, dll) tanpa mengubah policy lain.
create or replace function public.is_staff_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'owner')
  );
$$;

-- 3) is_owner(): khusus untuk hak eksklusif owner (ubah peran).
create or replace function public.is_owner()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'owner'
  );
$$;

-- 4) HANYA owner yang boleh MENGUBAH baris profiles (promote/demote). Menggantikan
--    policy lama (yang mengizinkan semua admin) → admin tak bisa lagi ubah peran.
drop policy if exists profiles_update_admin on public.profiles;
drop policy if exists profiles_update_owner on public.profiles;
create policy profiles_update_owner on public.profiles
  for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- 5) Tunjuk OWNER pertama. GANTI email dengan akun ownermu. (Kolom email diisi
--    migrasi 0005.) Bila kena 0 baris → baris profiles belum ada / email beda;
--    pakai UPSERT pakai User ID dari diagnostik #/admin.
update public.profiles set role = 'owner'
where email = 'hafizh.hasanayn9@gmail.com';
