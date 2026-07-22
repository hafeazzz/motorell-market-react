-- ============================================================
-- profiles: role staf, trigger auto-buat baris saat signup, dan RLS
--
-- KENAPA FILE INI ADA
-- Cek "apakah user ini admin" di aplikasi (src/App.jsx) sepenuhnya DINAMIS:
-- ia membaca kolom profiles.role untuk id user yang login. Tidak ada email/ID
-- admin yang di-hardcode. Jadi menambah admin = cukup setel role di tabel ini.
--
-- MASALAH yang diperbaiki: admin baru tidak bisa akses panel. Penyebab tersering
-- (dan yang file ini tutup):
--   1. Signup HANYA membuat user auth + metadata; baris profiles-nya bergantung
--      pada trigger DB. Kalau trigger belum ada, user baru tidak punya baris →
--      role tidak bisa disetel → tidak pernah jadi admin.
--   2. RLS tabel profiles mungkin tidak mengizinkan user membaca barisnya sendiri
--      atau tidak mengizinkan admin membaca/mengubah baris orang lain (StaffPanel).
--
-- AMAN DIJALANKAN BERULANG. Semua langkah idempoten (IF NOT EXISTS /
-- CREATE OR REPLACE / DROP ... IF EXISTS). Tidak menghapus data. Tidak
-- menurunkan role siapa pun. Jalankan di Supabase → SQL Editor → Run.
-- ============================================================

-- 1) Tabel (kalau belum ada). Kalau sudah ada, blok ini dilewati dan kolom
--    dipastikan lengkap di langkah 2 — struktur yang sudah ada tidak diubah.
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  role       text,
  created_at timestamptz not null default now()
);

-- 2) Pastikan kolom yang dipakai aplikasi ada (untuk tabel lama yang beda bentuk).
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists role       text;

-- 3) Batasi role ke nilai yang dikenal UI. NULL = "tanpa akses" (bukan staf).
--    Drop dulu supaya aman diulang.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role is null or role in ('admin', 'kurator'));

-- 4) Trigger: tiap user baru di auth.users otomatis dapat baris profiles.
--    full_name diambil dari metadata signup (lihat AuthModal → options.data).
--    Role sengaja NULL: admin yang menaikkan lewat panel, bukan otomatis.
--    SECURITY DEFINER supaya insert-nya lolos RLS.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- full_name: email/password signup mengirim 'full_name'; login Google (OAuth)
  -- mengisi 'full_name' atau 'name' di metadata. Coba keduanya sebelum fallback.
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name', 'Pengguna'), null)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5) BACKFILL: buat baris untuk user auth yang sudah terlanjur ada tanpa profiles
--    (mis. akun admin baru yang dibuat sebelum trigger ini ada). Tidak menyentuh
--    baris yang sudah ada — role yang sudah disetel tetap aman.
insert into public.profiles (id, full_name, role)
select u.id, coalesce(u.raw_user_meta_data ->> 'full_name', 'Pengguna'), null
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- 6) Helper anti-rekursi. Kebijakan RLS di profiles TIDAK BOLEH langsung
--    meng-query profiles lagi (memicu rekursi RLS tanpa henti). Fungsi
--    SECURITY DEFINER ini membaca role pemanggil dengan melewati RLS.
create or replace function public.is_staff_admin()
returns boolean
language sql
stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- 7) RLS.
alter table public.profiles enable row level security;

-- 7a) Baca: setiap orang boleh baca barisnya SENDIRI (inilah yang dipakai cek
--     admin di App.jsx), dan admin boleh baca SEMUA baris (dipakai StaffPanel).
drop policy if exists profiles_select_self  on public.profiles;
drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_self  on public.profiles
  for select using (auth.uid() = id);
create policy profiles_select_admin on public.profiles
  for select using (public.is_staff_admin());

-- 7b) Buat baris sendiri (jaring pengaman kalau trigger tak jalan; hanya baris
--     miliknya, dan hanya bila belum punya role — tidak bisa mengangkat diri).
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert with check (auth.uid() = id and role is null);

-- 7c) Ubah: HANYA admin yang boleh mengubah baris (menyetel role orang lain).
--     Ini yang membuat StaffPanel bisa mengangkat/menurunkan staf tanpa SQL.
--     User biasa tidak bisa menyetel role-nya sendiri → tidak ada self-promote.
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update using (public.is_staff_admin()) with check (public.is_staff_admin());

-- ============================================================
-- MENUNJUK ADMIN PERTAMA (sekali saja, saat belum ada admin mana pun)
-- Karat: kebijakan di atas menuntut SUDAH ada admin untuk mengangkat admin.
-- Untuk admin PERTAMA, jalankan baris ini sekali dengan email akunmu — ini
-- di SQL editor (service role), jadi tidak terhalang RLS:
--
--   update public.profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'EMAIL-KAMU@contoh.com');
--
-- Setelah ada satu admin, sisanya cukup lewat Panel admin → Staf, tanpa SQL.
-- ============================================================
