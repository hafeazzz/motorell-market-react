-- ============================================================
-- 0008 — Kolom `kota` (lokasi penjual) untuk titip_jual_units.
-- Dipakai di form titip jual (pilih provinsi → kota) & ditampilkan di kartu/detail
-- unit titip supaya pembeli tahu lokasi penjual. Idempoten.
-- ============================================================
alter table public.titip_jual_units add column if not exists kota varchar(100);
create index if not exists titip_jual_kota_idx on public.titip_jual_units (kota);
