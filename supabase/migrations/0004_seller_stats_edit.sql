-- ============================================================
-- 0004 — Statistik tayang/klik + izin penjual mengedit submission sendiri.
--
-- Konteks: "seller" di app ini = pemilik baris `titip_jual_units` (konsinyasi),
-- BUKAN `listings` (stok resmi Motorell, dikelola admin). Migrasi ini menambah:
--   1) kolom view_count / click_count (di dua tabel yang tampil di etalase),
--   2) RPC aman untuk MENAIKKAN counter dari pengunjung anon (tanpa memberi
--      izin UPDATE tabel ke publik — itu lubang keamanan),
--   3) kebijakan RLS agar penjual bisa mengedit submission MILIKNYA sendiri
--      selama masih 'pending' (tak bisa self-approve).
--
-- CATATAN kenapa BUKAN cara di prompt aslinya:
--   - supabase.raw('view_count+1') tak ada di supabase-js v2 → pakai RPC ini.
--   - update counter langsung dari anon = harus buka UPDATE listings utk anon
--     (bahaya). RPC SECURITY DEFINER hanya menaikkan angka → aman.
--   - TIDAK ada tabel log per-view yang bisa ditulis anon (membengkak DB+egress
--     & rawan spam) dan TIDAK ada panggilan ke ipify (diblokir CSP, bocor privasi).
--
-- Idempoten. Jalankan di Supabase → SQL Editor → Run.
-- ============================================================

-- 1) Kolom counter.
alter table public.titip_jual_units add column if not exists view_count  integer not null default 0;
alter table public.titip_jual_units add column if not exists click_count integer not null default 0;
alter table public.listings        add column if not exists view_count  integer not null default 0;
alter table public.listings        add column if not exists click_count integer not null default 0;

-- 2) RPC penaik counter — SATU-SATUNYA jalan menaikkan view/click dari klien.
--    SECURITY DEFINER: berjalan dengan hak pemilik fungsi, jadi anon boleh
--    menaikkan counter TANPA punya izin UPDATE tabel. Hanya menyentuh dua kolom
--    counter; kolom lain tak tersentuh. Argumen divalidasi (whitelist).
create or replace function public.bump_stat(p_table text, p_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind not in ('view', 'click') then
    raise exception 'kind tidak valid: %', p_kind;
  end if;

  if p_table = 'titip_jual_units' then
    -- Hanya unit yang sudah tayang (approved) yang dihitung.
    if p_kind = 'view' then
      update public.titip_jual_units set view_count = view_count + 1
        where id = p_id and status = 'approved';
    else
      update public.titip_jual_units set click_count = click_count + 1
        where id = p_id and status = 'approved';
    end if;
  elsif p_table = 'listings' then
    if p_kind = 'view' then
      update public.listings set view_count = view_count + 1 where id = p_id;
    else
      update public.listings set click_count = click_count + 1 where id = p_id;
    end if;
  else
    raise exception 'tabel tidak valid: %', p_table;
  end if;
end;
$$;

-- Fungsi hanya menaikkan angka → aman dipanggil publik.
grant execute on function public.bump_stat(text, uuid, text) to anon, authenticated;

-- 3) RLS: penjual boleh UPDATE submission MILIKNYA SENDIRI selama 'pending'
--    (ubah harga/deskripsi/foto sebelum direview). WITH CHECK memaksa status
--    TETAP 'pending' & seller_id tetap dirinya → tak bisa self-approve / mencuri.
--    Policy admin (0003 3e) tetap ada; keduanya di-OR (permissive).
drop policy if exists titip_jual_update_own_pending on public.titip_jual_units;
create policy titip_jual_update_own_pending on public.titip_jual_units
  for update to authenticated
  using (auth.uid() = seller_id and status = 'pending')
  with check (auth.uid() = seller_id and status = 'pending');
