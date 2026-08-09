-- ============================================================
-- 0012 — audit_log: jejak penghapusan/pemulihan akun (siapa, apa, kapan, kenapa).
--
-- Dipakai fitur hard delete (Edge Function auth-delete-user) + soft delete/restore
-- di StaffPanel. Baris audit SENGAJA tanpa FK ke profiles: hard delete meng-cascade
-- baris profiles (profiles.id → auth.users on delete cascade, 0002), jadi kalau
-- target_user_id ber-FK, catatan auditnya ikut terhapus — justru yang tak boleh.
-- Email di-denormalisasi (admin_email/target_email) supaya tetap terbaca setelah
-- baris aslinya lenyap.
--
-- Immutable dari klien: hanya ada policy SELECT & INSERT untuk staf; TANPA policy
-- UPDATE/DELETE → tak bisa diubah/dihapus lewat anon key (service_role tetap bisa).
--
-- Idempoten. Butuh 0007 (is_staff_admin). Supabase → SQL Editor → Run.
-- ============================================================
create extension if not exists pgcrypto;

create table if not exists public.audit_log (
  id             uuid primary key default gen_random_uuid(),
  admin_id       uuid,                         -- pelaku (tanpa FK; boleh null)
  admin_email    varchar(255),
  action         varchar(30) not null,         -- soft_delete | hard_delete | restore
  target_user_id uuid,
  target_email   varchar(255),
  reason         text,
  created_at     timestamptz not null default now()
);
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);

alter table public.audit_log enable row level security;

-- Staf/admin boleh membaca seluruh jejak.
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log
  for select to authenticated using (public.is_staff_admin());

-- Staf/admin boleh menyisipkan (soft delete/restore dari klien). Hard delete
-- ditulis Edge Function via service_role (mem-bypass RLS).
drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log
  for insert to authenticated with check (public.is_staff_admin());

-- (Tanpa policy UPDATE/DELETE — jejak tak bisa diubah/dihapus dari klien.)

-- ============================================================
-- VERIFIKASI
-- select polname, cmd from pg_policies where tablename='audit_log';
-- ============================================================
