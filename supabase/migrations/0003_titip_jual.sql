-- ============================================================
-- Titip Jual (consignment) — marketplace unit dari masyarakat umum.
--
-- TERPISAH dari tabel `listings` (stok resmi Motorell) supaya data & alur
-- approval-nya jelas berbeda. Unit di sini baru tayang di etalase publik setelah
-- di-approve admin, dan SELALU diprioritaskan DI BAWAH unit resmi (logika urutan
-- ada di frontend, bukan di sini).
--
-- Keputusan produk (dikonfirmasi):
--  - Submit WAJIB login → seller_id = auth.uid() (RLS insert menuntut ini).
--  - Kontak pembeli langsung ke nomor penjual (seller_phone) — bukan CS.
--
-- Reuse function public.is_staff_admin() dari 0002 (JANGAN bikin baru). Catatan:
-- fungsi itu admin-only, jadi review titip jual = khusus admin (kurator tidak).
--
-- AMAN dijalankan berulang (idempoten). Jalankan di Supabase → SQL Editor → Run.
-- ============================================================

-- 1) Tabel.
create table if not exists public.titip_jual_units (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid references auth.users (id) on delete cascade,
  seller_name  text not null,
  seller_phone text not null,
  seller_email text,

  merek   text not null,
  model   text not null,
  tahun   integer not null,
  odometer integer,
  warna   text,
  plat_nomor text,
  kondisi text,                 -- Istimewa | Bagus | Standar
  harga_diinginkan numeric not null,
  deskripsi text,
  kelengkapan text,             -- STNK/BPKB/Faktur dsb (teks bebas)

  photos  text[] not null default '{}',

  status  text not null default 'pending'
          check (status in ('pending', 'approved', 'rejected', 'sold')),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  rejection_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Kolom dipastikan ada untuk tabel lama yang beda bentuk (idempoten).
alter table public.titip_jual_units add column if not exists photos text[] not null default '{}';
alter table public.titip_jual_units add column if not exists rejection_reason text;

-- Etalase publik hanya menarik yang 'approved' → indeks kecil ini membuatnya murah.
create index if not exists titip_jual_status_idx on public.titip_jual_units (status);
create index if not exists titip_jual_seller_idx on public.titip_jual_units (seller_id);

-- 2) updated_at otomatis.
create or replace function public.touch_titip_jual_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists titip_jual_touch_updated on public.titip_jual_units;
create trigger titip_jual_touch_updated
  before update on public.titip_jual_units
  for each row execute function public.touch_titip_jual_updated_at();

-- 3) RLS.
alter table public.titip_jual_units enable row level security;

-- 3a) INSERT: wajib login, dan hanya boleh mendaftarkan submission ATAS NAMA
--     DIRI SENDIRI (seller_id = auth.uid()). Anon (auth.uid() null) otomatis
--     tertolak karena null = null bernilai NULL (bukan true).
drop policy if exists titip_jual_insert_own on public.titip_jual_units;
create policy titip_jual_insert_own on public.titip_jual_units
  for insert with check (auth.uid() = seller_id);

-- 3b) SELECT: publik hanya lihat yang sudah 'approved'.
drop policy if exists titip_jual_select_approved on public.titip_jual_units;
create policy titip_jual_select_approved on public.titip_jual_units
  for select using (status = 'approved');

-- 3c) SELECT: penjual lihat submission miliknya sendiri (termasuk pending/rejected)
--     supaya bisa cek status.
drop policy if exists titip_jual_select_own on public.titip_jual_units;
create policy titip_jual_select_own on public.titip_jual_units
  for select using (auth.uid() = seller_id);

-- 3d) SELECT: admin lihat semua (untuk review).
drop policy if exists titip_jual_select_admin on public.titip_jual_units;
create policy titip_jual_select_admin on public.titip_jual_units
  for select using (public.is_staff_admin());

-- 3e) UPDATE: hanya admin (approve/reject/tandai terjual).
drop policy if exists titip_jual_update_admin on public.titip_jual_units;
create policy titip_jual_update_admin on public.titip_jual_units
  for update using (public.is_staff_admin()) with check (public.is_staff_admin());

-- ============================================================
-- 4) Storage bucket `titip-jual-photos` (terpisah dari unit-photos resmi).
-- ============================================================
insert into storage.buckets (id, name, public)
values ('titip-jual-photos', 'titip-jual-photos', true)
on conflict (id) do nothing;

-- 4a) Baca publik (foto tampil di etalase).
drop policy if exists titip_jual_photos_read on storage.objects;
create policy titip_jual_photos_read on storage.objects
  for select using (bucket_id = 'titip-jual-photos');

-- 4b) Upload: user login boleh unggah ke bucket ini (foto submission-nya).
drop policy if exists titip_jual_photos_insert on storage.objects;
create policy titip_jual_photos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'titip-jual-photos');
