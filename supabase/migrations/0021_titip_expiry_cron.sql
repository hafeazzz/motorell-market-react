-- ============================================================
-- 0021 — Penjadwal arsip otomatis (pg_cron), jalan tiap jam.
-- Jalankan SETELAH 0020. Terpisah supaya kalau ekstensi pg_cron belum aktif,
-- 0020 tetap berhasil (etalase publik sudah menyembunyikan unit kedaluwarsa lewat RLS).
-- Bila error "extension pg_cron is not available": aktifkan dulu di
-- Supabase → Database → Extensions → pg_cron, lalu jalankan ulang file ini.
-- ============================================================
create extension if not exists pg_cron;

select cron.unschedule(jobid) from cron.job where jobname = 'titip-expire-hourly';
select cron.schedule('titip-expire-hourly', '0 * * * *', $$select public.titip_expire_due()$$);

-- VERIFIKASI
-- select jobname, schedule, active from cron.job;
-- select public.titip_expire_due();   -- uji manual (mengembalikan jumlah unit yang diarsipkan)
