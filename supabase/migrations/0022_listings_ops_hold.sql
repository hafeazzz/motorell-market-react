-- ============================================================
-- 0022 — Status listing mengikuti Motorell Ops.
-- ops_held = true: listing ditarik sementara oleh Ops (motor sedang dibooking atau diarsipkan di Ops).
-- Saat booking batal, hanya listing yang ditarik oleh Ops yang ditayangkan lagi; draft buatan admin tidak disentuh.
-- Dipakai fungsi ops-sync (event "status"). Jalankan SEBELUM deploy ulang ops-sync.
-- ============================================================
alter table public.listings add column if not exists ops_held boolean not null default false;
alter table public.listings add column if not exists sold_at timestamptz;
