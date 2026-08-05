-- ============================================================
-- 0008 — PERBAIKAN: signup GAGAL TOTAL (HTTP 500) karena trigger menulis
--        role = NULL ke kolom yang di produksi sudah NOT NULL.
--
-- GEJALA (dari request nyata ke POST /auth/v1/signup, 2026-07-31):
--   {"code":"23502",
--    "message":"null value in column \"role\" of relation \"profiles\"
--               violates not-null constraint",
--    "detail":"Failing row contains (5d858c13-…, Signup Flow Test, null, null,
--              null, 2026-07-31 13:35:20+00, 2026-07-31 13:35:20+00, …)"}
--
--   Di browser, supabase-js menerjemahkannya jadi:
--     AuthApiError: Database error saving new user
--   sehingga log app berbunyi: "[AUTH] gagal: AuthApiError — Database error…"
--
-- SEBAB:
--   handle_new_user() (0005) sengaja menulis `null` sebagai role, karena SEMUA
--   migrasi di repo ini menganggap NULL = "user biasa" — lihat 0007:
--     check (role is null or role in ('owner','admin','kurator'))
--
--   Tetapi DATABASE PRODUKSI sudah berbeda dari repo (schema drift): kolom role
--   di sana NOT NULL, dan datanya memakai 'buyer' untuk user biasa
--   (terhitung: 6 admin + 2 buyer, 0 NULL). Perubahan itu TIDAK PERNAH masuk ke
--   file migrasi mana pun, dan handle_new_user() tak ikut diperbarui.
--
--   Akibatnya: setiap pendaftaran baru ditolak Postgres, GoTrue me-rollback
--   transaksi → user TIDAK dibuat, email verifikasi TIDAK PERNAH dikirim.
--   Ini menjelaskan kenapa jumlah user berhenti di 8 dan tidak ada satu pun
--   user berstatus "unconfirmed".
--
-- BUKAN penyebabnya (sudah diuji dan dikesampingkan):
--   • Client Supabase null / env var tak ter-build — bundle produksi terbukti
--     memuat VITE_SUPABASE_URL dan kunci sb_publishable_… (dicek di
--     /assets/index-B_tV8AdL.js).
--   • Kunci anon salah — GET /rest/v1/listings dengan kunci itu balas 200.
--   • Signup dimatikan — /auth/v1/settings: disable_signup=false, email=true.
--   • Resend / SMTP — transaksi gagal SEBELUM email sempat dikirim, jadi
--     Resend belum pernah benar-benar teruji. Baru bisa dipastikan setelah
--     perbaikan ini dijalankan.
--
-- Idempoten & aman dijalankan berulang. Supabase → SQL Editor → Run.
-- ============================================================

-- 1) Samakan constraint dengan kenyataan data produksi.
--    'buyer' HARUS masuk daftar (sudah dipakai 2 baris). Constraint versi 0007
--    tidak memuatnya, jadi kalau yang aktif adalah versi itu, insert 'buyer'
--    akan ditolak. Ditulis ulang agar benar di kedua kondisi.
--    Catatan: CHECK lolos bila ekspresi TRUE *atau* NULL, jadi baris ber-role
--    NULL (bila kolomnya masih nullable) tetap valid.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('owner', 'admin', 'kurator', 'buyer'));

-- 2) Default di level kolom: jaring pengaman untuk SEMUA jalur insert, bukan
--    cuma trigger (mis. seed script, import manual, admin panel).
alter table public.profiles alter column role set default 'buyer';

-- 3) Rapikan baris lama yang masih NULL (di produksi saat ini: 0 baris, jadi
--    no-op — tapi wajib ada supaya langkah 4 aman bila dijalankan di database
--    lain yang masih memakai konvensi NULL, mis. staging).
update public.profiles set role = 'buyer' where role is null;

-- 4) INTI PERBAIKAN: trigger signup menulis role yang valid, bukan NULL.
--
--    PENTING — role SENGAJA di-hardcode 'buyer' dan TIDAK diambil dari
--    new.raw_user_meta_data. Metadata itu dikirim CLIENT lewat
--    supabase.auth.signUp({ options: { data } }), sehingga siapa pun bisa
--    mendaftar sambil menyisipkan {"role":"owner"} dan langsung jadi super-admin.
--    Kenaikan peran tetap hanya lewat set_user_role() / is_owner() (0007).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', 'Pengguna'),
    'buyer',          -- sebelumnya: null  ← inilah yang melanggar NOT NULL
    new.email
  )
  on conflict (id) do update set email = excluded.email
    where public.profiles.email is null;
  return new;
end;
$$;

-- 5) Trigger-nya sendiri tidak berubah, tapi dipasang ulang agar file ini
--    lengkap bila dijalankan di database bersih.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- VERIFIKASI (jalankan setelah Run; semua harus sesuai keterangan)
-- ------------------------------------------------------------
-- a) Kolom role: apakah NOT NULL, dan apa default-nya?
--    Harap: is_nullable=NO, column_default='buyer'::text
-- select column_name, is_nullable, column_default
--   from information_schema.columns
--  where table_schema='public' and table_name='profiles' and column_name='role';
--
-- b) Constraint aktif — harus memuat 'buyer'.
-- select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--  where conrelid='public.profiles'::regclass and conname='profiles_role_check';
--
-- c) Trigger masih terpasang di auth.users.
-- select tgname from pg_trigger where tgrelid='auth.users'::regclass
--   and not tgisinternal;
--
-- d) Sebaran role sekarang (harap: tidak ada NULL).
-- select role, count(*) from public.profiles group by role order by 2 desc;
-- ============================================================
