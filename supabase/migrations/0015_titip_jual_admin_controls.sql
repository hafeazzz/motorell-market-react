-- ============================================================
-- 0015 — Kontrol admin untuk titip jual: ARSIP (soft delete) & HAPUS PERMANEN.
--
-- Kenapa dua tingkat:
--  - ARSIP  → unit hilang dari etalase publik tapi barisnya UTUH (alasan, siapa,
--             kapan). Bisa dipulihkan. Ini default untuk unit yang "tidak sesuai"
--             (foto buram, harga tak realistis, duplikat).
--  - HAPUS  → baris lenyap permanen. Hanya untuk sampah/spam/konten bermasalah.
--             Jejaknya tetap hidup di audit_log karena tabel itu TANPA FK ke
--             titip_jual_units (lihat 0012).
--
-- CATATAN beda dari draf prompt (sengaja):
--  1. TIDAK membuat trigger updated_at baru. 0003 sudah memasang trigger
--     `titip_jual_touch_updated` yang memanggil public.touch_titip_jual_updated_at().
--     Fungsi `public.touch_updated_at()` di draf TIDAK ADA di database ini —
--     CREATE TRIGGER yang memanggilnya akan gagal & membatalkan seluruh migrasi.
--  2. TIDAK ada backfill `insert into audit_log ... select ... where archived_at
--     > now() - interval '1 hour'`. Kolom archived_at baru dibuat di atas → semua
--     NULL → 0 baris. Lagi pula auth.uid() NULL di SQL Editor, jadi admin_id-nya
--     kosong. Blok itu murni no-op; dibuang.
--  3. archived_reason bertipe `text` (bukan varchar(255)) — konsisten dengan
--     rejection_reason & kolom teks lain di tabel ini.
--
-- AMAN dijalankan berulang (idempoten). Butuh 0003 (tabel) & 0007 (is_staff_admin).
-- Jalankan di Supabase → SQL Editor → Run.
-- ============================================================

-- 1) Kolom arsip.
alter table public.titip_jual_units
  add column if not exists archived_at timestamptz;
alter table public.titip_jual_units
  add column if not exists archived_by uuid references auth.users (id) on delete set null;
alter table public.titip_jual_units
  add column if not exists archived_reason text;

-- 2) Indeks PARSIAL: query terpanas adalah etalase publik
--    (status='approved' AND archived_at IS NULL). Indeks parsial hanya memuat
--    baris hidup — jauh lebih kecil daripada indeks penuh atas archived_at, dan
--    baris terarsip tak perlu diindeks sama sekali.
create index if not exists titip_jual_live_idx
  on public.titip_jual_units (status) where archived_at is null;

-- 3) RLS.
--
-- 3a) SELECT publik: unit terarsip TIDAK BOLEH terbaca anon. Ini pertahanan
--     berlapis — frontend juga memfilter, tapi policy-lah yang mengikat.
--     Penjual tetap melihat unitnya sendiri (policy titip_jual_select_own, 0003)
--     dan admin melihat semua (titip_jual_select_admin, 0003) — policy di-OR-kan,
--     jadi keduanya masih jalan.
drop policy if exists titip_jual_select_approved on public.titip_jual_units;
create policy titip_jual_select_approved on public.titip_jual_units
  for select using (status = 'approved' and archived_at is null);

-- 3b) DELETE oleh admin. Sebelum ini TIDAK ADA policy delete untuk admin —
--     RLS aktif berarti hard delete dari panel admin selalu kena tolak diam-diam
--     (0 baris terhapus, tanpa error).
--     CATATAN: policy titip_jual_delete_own (0006, penjual hapus unit sendiri)
--     SENGAJA tidak disentuh — policy di-OR-kan, keduanya hidup berdampingan.
drop policy if exists titip_jual_delete_admin on public.titip_jual_units;
create policy titip_jual_delete_admin on public.titip_jual_units
  for delete to authenticated using (public.is_staff_admin());

-- 3c) UPDATE sudah admin-only lewat titip_jual_update_admin (0003 §3e), jadi
--     penulisan archived_at/by/reason otomatis terlindungi. Tidak ada yang
--     perlu diubah di sini — dicatat supaya tak ada yang menambah policy kembar.

-- ============================================================
-- VERIFIKASI (jalankan manual bila perlu)
-- select column_name, data_type from information_schema.columns
--   where table_schema='public' and table_name='titip_jual_units'
--     and column_name like 'archived%';
-- select polname, cmd from pg_policies where tablename='titip_jual_units';
-- ============================================================
