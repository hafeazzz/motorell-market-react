-- ============================================================
-- 0005 — Email di profiles (agar panel Staf bisa kenali/cari user) +
--        izin penjual MENGHAPUS submission sendiri yang masih 'pending'.
--
-- Konteks peran: role disimpan di public.profiles.role ('admin' | 'kurator' |
-- NULL) — TIDAK ada tabel `admin_roles`. Promote/demote = admin meng-UPDATE
-- profiles.role (RLS profiles_update_admin dari 0002). Panel Staf sudah bekerja;
-- yang kurang: tak ada email untuk mengenali user. Email TIDAK bisa diambil dari
-- klien (auth.admin.listUsers butuh service_role), jadi kita simpan salinannya di
-- profiles saat signup. profiles hanya bisa dibaca diri sendiri & admin (RLS 0002)
-- → email tidak terekspos publik.
--
-- Idempoten. Jalankan di Supabase → SQL Editor → Run. (Butuh 0002 & 0003/0004.)
-- ============================================================

-- 1) Kolom email (salinan dari auth.users; sumber kebenaran tetap auth.users).
alter table public.profiles add column if not exists email text;

-- 2) Trigger signup: ikut menyimpan email. (Ganti fungsi dari 0002 — logika
--    full_name dipertahankan, hanya menambah email. Tetap SECURITY DEFINER.)
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
    null,
    new.email
  )
  on conflict (id) do update set email = excluded.email
    where public.profiles.email is null;   -- isi email bila baris sudah ada tanpa email
  return new;
end;
$$;

-- 3) Backfill email untuk baris profiles yang sudah ada.
update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and (p.email is null or p.email is distinct from u.email);

-- 4) RLS: penjual boleh MENGHAPUS submission MILIKNYA SENDIRI selama 'pending'
--    (batal titip sebelum direview). Setelah approved/rejected tak bisa dihapus
--    penjual (unit approved dikelola admin). Policy admin & lainnya tak berubah.
drop policy if exists titip_jual_delete_own_pending on public.titip_jual_units;
create policy titip_jual_delete_own_pending on public.titip_jual_units
  for delete to authenticated
  using (auth.uid() = seller_id and status = 'pending');
