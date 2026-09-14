-- ============================================================
-- 0016 — Tutup privilege escalation profiles.role/deleted_at (trigger, bukan
-- cuma RLS) + demosi 2 akun tak-legitimate + rapikan RLS unit-photos.
--
-- LATAR BELAKANG — lihat RLS_AUDIT.md (audit 2026-09-13) untuk detail lengkap:
--
--   1. 🔴 profiles: policy `profiles_update` & `profiles_update_role_owner`
--      (LIVE, TIDAK tercatat di migrations manapun sebelum file ini —
--      kemungkinan diterapkan ad-hoc lewat SQL Editor) mengizinkan siapa pun
--      UPDATE role/deleted_at barisnya sendiri; WITH CHECK-nya cuma
--      `auth.uid() = id`, TIDAK membatasi kolom role sama sekali. `profiles_update`
--      malah lebih parah dari yang tercatat di audit: klausanya
--      `auth.uid()=id OR EXISTS(...role='admin'...)` — subquery self-referencing
--      di dalam policy profiles-nya sendiri, mengizinkan SEMUA admin meng-UPDATE
--      SEMBARANG baris (bukan cuma miliknya), kontradiksi desain 0007 ("admin TAK
--      bisa ubah peran"). `profiles_self_update` (juga tak tercatat) sama
--      bermasalahnya: TANPA WITH CHECK sama sekali.
--
--      RLS tidak bisa membandingkan nilai LAMA vs BARU pada kolom yang sama —
--      makanya perbaikan sungguhan ada di TRIGGER (Bagian 1), bukan cuma RLS.
--      RLS untuk self-update tetap boleh longgar di level BARIS (siapa pun boleh
--      UPDATE barisnya sendiri) karena trigger yang jadi penjaga KOLOM role/
--      deleted_at, apa pun policy RLS yang meloloskan UPDATE-nya.
--
--      CATATAN scope: trigger ini menjaga role DAN deleted_at (deleted_at ikut
--      disertakan karena satu keluarga masalah yang sama — user yang di-soft-
--      delete/'inactive' bisa mengembalikan aksesnya sendiri lewat jalur RLS yang
--      sama — dan ini konsisten dengan contoh trigger yang sudah direview di
--      RLS_AUDIT.md §2a. Kalau kamu HANYA mau menjaga role, hapus baris
--      `or new.deleted_at is distinct from old.deleted_at` di bawah sebelum apply.
--
--   2. 🔴 Storage bucket unit-photos: 3 policy "unit-photos authenticated
--      {upload,update,delete}" (role authenticated, TANPA cek is_staff()) hidup
--      berdampingan dengan unit_photos_staff_* yang benar. RLS storage permisif
--      (di-OR-kan) → yang longgar menang: user login biasa (bukan staff) bisa
--      upload/timpa/hapus foto listing resmi. Dibuang di Bagian 3, sisakan
--      staff-only + satu policy baca publik (duplikatnya dibuang juga).
--
--   3. 9 akun admin/owner dicek manual oleh owner (hafizh.hasanayn9@gmail.com,
--      2026-09-14): 7 legitimate (dibiarkan), 2 TIDAK legitimate → diturunkan ke
--      'buyer' di Bagian 2, migration yang SAMA dengan trigger di atas (per
--      instruksi eksplisit).
--
--   4. audit_log (Fase 1) tidak pernah mencatat perubahan role — trigger di
--      Bagian 1 sekarang mencatat OTOMATIS setiap perubahan role yang LOLOS
--      (siapa/admin_id, dari->ke, target, kapan) supaya pertanyaan forensik
--      seperti sesi audit ini tidak perlu lagi ditanya manual.
--
-- CATATAN DRIFT SKEMA (di luar cakupan migrasi ini — sekadar didokumentasikan
-- supaya tidak mengejutkan saat migrasi ke organization Supabase baru):
--   - profiles.role LIVE bertipe ENUM public.user_role (buyer/inactive/seller/
--     kurator/owner/admin). Migrasi 0002/0007/0010 SECARA EKSPLISIT menolak
--     pendekatan enum ini ("ALTER TYPE ... → error: type tak ada") dan memakai
--     text + CHECK constraint. Live sekarang malah enum — diubah di luar file
--     migrasi ini pada suatu titik (kemungkinan lewat Table Editor dashboard).
--   - audit_log.admin_id LIVE = NOT NULL, migrasi 0012 menulis "boleh null".
--     audit_log.created_at LIVE = timestamp WITHOUT time zone, migrasi 0012
--     menulis timestamptz. audit_log.action LIVE = varchar(50), migrasi 0012
--     menulis varchar(30). profiles.deleted_at LIVE = timestamp WITHOUT time
--     zone, migrasi 0011 menulis timestamptz.
--   Kesimpulan: `supabase db push` dari folder ini ke project BARU TIDAK akan
--   menghasilkan skema yang identik dengan production saat ini. Sebelum cutover
--   organization baru, jalankan `supabase db diff --linked` (atau `db pull`)
--   dulu terhadap project LAMA untuk menangkap drift ini ke migration file —
--   di luar cakupan migrasi 0016 ini.
--
-- TIDAK disentuh migrasi ini (di luar permintaan sesi ini, rating 🟡 bukan 🔴
-- di RLS_AUDIT.md): `profiles_read_all` (semua user login bisa baca semua
-- profil), `attendance` (0 baris, RLS public r/w), `titip-jual-photos` (upload
-- tak dibatasi folder sendiri).
--
-- Idempoten untuk Bagian 1 & 3 (DROP...IF EXISTS / CREATE OR REPLACE).
-- Bagian 2 (demosi) aman diulang untuk kolom role (WHERE role='admin' jadi
-- no-op setelah pertama kali), dan entry audit_log manualnya dijaga
-- NOT EXISTS supaya tak dobel kalau file ini ke-apply lebih dari sekali.
--
-- Supabase → SQL Editor → Run, atau `supabase db push`. Butuh 0002/0007/0010/
-- 0012 (helper is_staff_admin/is_owner, tabel audit_log).
-- ============================================================


-- ------------------------------------------------------------
-- BAGIAN 1 — profiles: bersihkan policy UPDATE longgar + trigger anti-escalation
-- ------------------------------------------------------------

-- 1a) Buang 3 policy UPDATE longgar/tak-tercatat, ganti SATU policy self-update
--     yang bersih. Row-level tetap longgar (auth.uid()=id) SECARA SENGAJA —
--     kolom role/deleted_at dijaga trigger di 1b, bukan RLS ini.
drop policy if exists profiles_update           on public.profiles;
drop policy if exists profiles_update_role_owner on public.profiles;
drop policy if exists profiles_self_update       on public.profiles;

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- (profiles_update_owner, profiles_update_admin_deactivate, profiles_update_staff
--  TIDAK disentuh — sudah benar per RLS_AUDIT.md, dan setRole() di StaffPanel
--  [src/App.jsx] bergantung padanya untuk promote/demote user LAIN.)

-- 1b) Trigger: tolak perubahan role/deleted_at kecuali oleh staff admin, owner,
--     atau service_role (Edge Function masa depan) — DAN catat tiap perubahan
--     role yang lolos ke audit_log.
create or replace function public.profiles_protect_privileged_cols()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (new.role is distinct from old.role or new.deleted_at is distinct from old.deleted_at)
     and not (
       public.is_staff_admin()
       or public.is_owner()
       or auth.role() = 'service_role' -- Edge Function via service_role key: sudah
                                        -- bypass RLS by design, konsisten bypass trigger ini juga
     ) then
    raise exception 'Tidak boleh mengubah role/deleted_at pada baris sendiri'
      using errcode = '42501'; -- insufficient_privilege
  end if;

  -- Jejak audit HANYA untuk perubahan role yang LOLOS (staff/owner/service_role
  -- — kalau ditolak di atas, baris ini tak pernah tercapai, exception membatalkan
  -- seluruh statement, tak ada yang perlu dicatat). admin_id NOT NULL live →
  -- UUID nol sebagai penanda "sistem/service_role" saat auth.uid() null (tanpa
  -- FK di admin_id, aman dipakai sebagai sentinel).
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

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.profiles_protect_privileged_cols();


-- ------------------------------------------------------------
-- BAGIAN 2 — demosi 2 akun dikonfirmasi TIDAK legitimate
-- (dikonfirmasi hafizh.hasanayn9@gmail.com, 2026-09-14, lihat sesi audit ini)
-- ------------------------------------------------------------

-- Trigger di 1b sudah aktif saat baris ini jalan. `supabase db push`/SQL Editor
-- berjalan sebagai role `postgres` TANPA konteks JWT (auth.uid()/auth.role()
-- keduanya NULL di koneksi migrasi) → is_staff_admin()/is_owner()/service_role
-- semua FALSE → trigger akan MENOLAK update di bawah kalau tidak dinonaktifkan
-- dulu KHUSUS untuk statement ini. Dicatat manual ke audit_log setelahnya
-- (trigger tak sempat jalan selagi dinonaktifkan).
alter table public.profiles disable trigger profiles_guard_role;

update public.profiles set role = 'buyer'
where email in ('abrarrafiqi07@gmail.com', 'debonsliving@gmail.com')
  and role = 'admin'; -- jaga-jaga: hanya sentuh kalau masih persis temuan Fase 1

alter table public.profiles enable trigger profiles_guard_role;

insert into public.audit_log (admin_id, action, target_user_id, target_email, reason)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  'role_changed',
  p.id,
  p.email,
  'role: admin -> buyer (demosi manual, migration 0016 — hasil RLS_AUDIT.md ' ||
    '2026-09-13, dikonfirmasi TIDAK legitimate oleh owner hafizh.hasanayn9@gmail.com)'
from public.profiles p
where p.email in ('abrarrafiqi07@gmail.com', 'debonsliving@gmail.com')
  and p.role = 'buyer'
  and not exists (
    select 1 from public.audit_log al
    where al.target_email = p.email and al.action = 'role_changed'
  );


-- ------------------------------------------------------------
-- BAGIAN 3 — storage bucket unit-photos: buang policy longgar sisa migrasi lama
-- ------------------------------------------------------------
drop policy if exists "unit-photos authenticated upload" on storage.objects;
drop policy if exists "unit-photos authenticated update" on storage.objects;
drop policy if exists "unit-photos authenticated delete" on storage.objects;
-- Duplikat read publik — sisakan unit_photos_public_read (konvensi nama tanpa
-- spasi, konsisten dengan unit_photos_staff_*), buang yang lama.
drop policy if exists "unit-photos public read" on storage.objects;


-- ============================================================
-- VERIFIKASI MANUAL (jalankan sendiri setelah apply — TIDAK dieksekusi otomatis
-- oleh migration ini):
--
-- -- policy UPDATE profiles yang tersisa (harus 4):
-- select policyname, cmd from pg_policies
--   where schemaname='public' and tablename='profiles' and cmd='UPDATE';
--
-- -- trigger terpasang & aktif:
-- select tgname, tgenabled from pg_trigger where tgname='profiles_guard_role';
--
-- -- role 2 akun sudah turun:
-- select email, role from public.profiles
--   where email in ('abrarrafiqi07@gmail.com','debonsliving@gmail.com');
--
-- -- audit_log mencatat demosi manual:
-- select action, target_email, reason, created_at from public.audit_log
--   where action='role_changed' order by created_at desc;
--
-- -- policy unit-photos yang tersisa (harus 4: staff insert/update/delete + 1 read):
-- select policyname, cmd from pg_policies
--   where schemaname='storage' and tablename='objects'
--   and (qual ilike '%unit-photos%' or with_check ilike '%unit-photos%');
--
-- -- SIMULASI sebagai user BIASA (anon/authenticated key, BUKAN service_role) —
-- -- lakukan lewat client app atau REST dengan JWT user buyer biasa:
-- --   update profiles set role='admin' where id=auth.uid();        -- harus GAGAL
-- --   update profiles set full_name='Test' where id=auth.uid();    -- harus SUKSES
-- ============================================================
