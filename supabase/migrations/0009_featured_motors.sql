-- ============================================================
-- 0009 — Featured Motors (motor unggulan hero) + jadwal rotasi mingguan.
--
-- Admin (is_staff_admin, lihat 0007) mengelola dari panel; PUBLIK hanya SELECT.
--
-- ROTASI — SENGAJA BUKAN cron/edge function. Snippet rencana menjanjikan
-- "auto-rotate Senin 00:00" lewat kolom rotation_day/rotation_time, tapi tak
-- ada satu pun proses yang membacanya. Di sini rotasi murni berbasis WAKTU:
-- hero memilih baris jadwal dengan start_date <= now() TERBARU (end_date NULL =
-- masih berjalan). Begitu jam start_date jadwal berikutnya lewat, hero otomatis
-- berganti tanpa kode/cron. Admin menjadwalkan "mulai Senin depan 00:00 WIB"
-- dari panel; itulah "auto-switch mingguan"-nya.
--
-- Perbedaan lain dari snippet: (1) TANPA Sketchfab — model dirender <model-viewer>
-- GLB (CSP frame-src tak mengizinkan sketchfab.com). (2) RLS WAJIB — tanpa ini
-- siapa pun dengan anon key bisa insert/hapus featured motor.
--
-- Idempoten. Butuh 0007 (is_staff_admin). Supabase → SQL Editor → Run.
-- ============================================================
create extension if not exists pgcrypto;

-- 1) Perpustakaan motor unggulan (showpiece; tak harus dijual).
create table if not exists public.featured_motors (
  id           uuid primary key default gen_random_uuid(),
  name         varchar(120) not null,
  brand        varchar(60),
  model_type   varchar(60),
  model_url    text,           -- GLB (Supabase storage / /models/…) → <model-viewer>
  image_url    text,           -- poster / cadangan bila 3D gagal dimuat
  description  text,           -- tampil di hero
  color_accent varchar(7),     -- #RRGGBB aksen UI hero
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 2) Jadwal rotasi. start_date menentukan "mulai kapan tampil".
create table if not exists public.featured_motor_schedule (
  id                uuid primary key default gen_random_uuid(),
  featured_motor_id uuid not null references public.featured_motors(id) on delete cascade,
  start_date        timestamptz not null,
  end_date          timestamptz,          -- NULL = berjalan sampai jadwal lain menggantikan
  note              varchar(120),
  created_at        timestamptz not null default now()
);

create index if not exists featured_motor_active_idx   on public.featured_motors(is_active);
create index if not exists featured_schedule_start_idx on public.featured_motor_schedule(start_date desc);

-- 3) updated_at otomatis di setiap UPDATE.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_featured_motors_touch on public.featured_motors;
create trigger trg_featured_motors_touch before update on public.featured_motors
  for each row execute function public.touch_updated_at();

-- 4) RLS: publik baca (hero anon perlu ini), hanya staf/admin tulis.
alter table public.featured_motors          enable row level security;
alter table public.featured_motor_schedule  enable row level security;

drop policy if exists featured_motors_read on public.featured_motors;
create policy featured_motors_read on public.featured_motors
  for select using (true);
drop policy if exists featured_schedule_read on public.featured_motor_schedule;
create policy featured_schedule_read on public.featured_motor_schedule
  for select using (true);

-- for all mencakup insert/update/delete; SELECT sudah dibuka policy 'read' di
-- atas (policy di-OR-kan), jadi publik tetap bisa baca sedangkan tulis wajib staf.
drop policy if exists featured_motors_write on public.featured_motors;
create policy featured_motors_write on public.featured_motors
  for all to authenticated
  using (public.is_staff_admin()) with check (public.is_staff_admin());
drop policy if exists featured_schedule_write on public.featured_motor_schedule;
create policy featured_schedule_write on public.featured_motor_schedule
  for all to authenticated
  using (public.is_staff_admin()) with check (public.is_staff_admin());

-- ============================================================
-- VERIFIKASI (opsional, jalankan setelah Run)
-- select tablename, rowsecurity from pg_tables
--   where schemaname='public' and tablename like 'featured_motor%';
-- select polname, cmd from pg_policies where tablename like 'featured_motor%';
-- ============================================================
