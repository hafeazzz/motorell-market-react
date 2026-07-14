-- ============================================================
-- Kategori untuk part modifikasi
--
-- Jalankan di Supabase → SQL Editor → New query → Run.
-- Aman dijalankan berulang (IF NOT EXISTS / DROP ... IF EXISTS).
--
-- Sebelum migrasi ini dijalankan, UI tetap hidup: part yang category-nya
-- belum ada / NULL otomatis masuk kategori 'Lainnya' (lihat src/modParts.js).
-- Yang BELUM bisa dilakukan sebelum migrasi: menyimpan part baru dari panel
-- admin, karena form mengirim kolom `category` yang belum ada — panel akan
-- menampilkan pesan yang menyuruh menjalankan file ini.
-- ============================================================

-- 1) Kolom kategori.
ALTER TABLE public.mod_parts
  ADD COLUMN IF NOT EXISTS category TEXT;

-- 2) Batasi ke daftar kategori yang dikenal UI. 'Lainnya' adalah default —
--    NULL juga diizinkan supaya baris lama tidak menghalangi migrasi.
ALTER TABLE public.mod_parts
  DROP CONSTRAINT IF EXISTS mod_parts_category_check;

ALTER TABLE public.mod_parts
  ADD CONSTRAINT mod_parts_category_check
  CHECK (category IS NULL OR category IN ('Ban', 'Jok', 'Handlebar', 'Exhaust', 'Lainnya'));

-- 3) Part yang sudah terlanjur ada dipindahkan ke 'Lainnya' supaya tidak ada
--    yang menggantung tanpa kategori.
UPDATE public.mod_parts
  SET category = 'Lainnya'
  WHERE category IS NULL;

-- 4) Part baru default ke 'Lainnya' kalau form tidak mengirim kategori.
ALTER TABLE public.mod_parts
  ALTER COLUMN category SET DEFAULT 'Lainnya';

-- 5) Etalase memfilter part per kategori — indeks kecil ini membuatnya murah.
CREATE INDEX IF NOT EXISTS mod_parts_category_idx
  ON public.mod_parts (category);
