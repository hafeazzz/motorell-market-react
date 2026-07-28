-- ============================================================
-- 0006 — Penjual kelola unit sendiri lebih leluasa:
--   • edit konten (termasuk FOTO) untuk unit sendiri yang 'pending' ATAU 'approved'
--   • hapus unit sendiri di status APA PUN (mis. setelah TERJUAL, atau tarik listing)
--
-- Kunci keamanannya: TRIGGER yang, untuk update oleh NON-admin, mengunci status &
-- jejak review — jadi penjual TAK bisa self-approve (pending→approved) atau
-- mengubah hasil review; hanya konten (merek/harga/deskripsi/photos/…) yang berubah.
-- Menggantikan kebijakan sempit dari 0004/0005.
--
-- Idempoten. Jalankan di Supabase → SQL Editor → Run. (Butuh 0002–0005.)
-- ============================================================

-- 1) Trigger pengaman: update oleh penjual TIDAK boleh mengubah kepemilikan,
--    status, atau jejak review. Admin (is_staff_admin) tetap bebas.
create or replace function public.titip_seller_update_guard()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if public.is_staff_admin() then
    return new;               -- admin: approve/reject/tandai terjual, dsb.
  end if;
  -- Penjual: paksa kolom sensitif kembali ke nilai lama → hanya KONTEN yang berubah.
  new.seller_id        := old.seller_id;
  new.status           := old.status;
  new.reviewed_by      := old.reviewed_by;
  new.reviewed_at      := old.reviewed_at;
  new.rejection_reason := old.rejection_reason;
  return new;
end;
$$;

drop trigger if exists titip_seller_update_guard_trg on public.titip_jual_units;
create trigger titip_seller_update_guard_trg
  before update on public.titip_jual_units
  for each row execute function public.titip_seller_update_guard();

-- 2) UPDATE: penjual boleh mengedit unit SENDIRI yang 'pending' atau 'approved'.
--    (Trigger memastikan status/jejak review tak berubah → aman dari self-approve.)
drop policy if exists titip_jual_update_own_pending on public.titip_jual_units;
drop policy if exists titip_jual_update_own on public.titip_jual_units;
create policy titip_jual_update_own on public.titip_jual_units
  for update to authenticated
  using (auth.uid() = seller_id and status in ('pending', 'approved'))
  with check (auth.uid() = seller_id);

-- 3) DELETE: penjual boleh MENGHAPUS unit MILIKNYA di status apa pun — batal saat
--    pending, tarik saat approved, atau bersihkan setelah TERJUAL.
drop policy if exists titip_jual_delete_own_pending on public.titip_jual_units;
drop policy if exists titip_jual_delete_own on public.titip_jual_units;
create policy titip_jual_delete_own on public.titip_jual_units
  for delete to authenticated
  using (auth.uid() = seller_id);
