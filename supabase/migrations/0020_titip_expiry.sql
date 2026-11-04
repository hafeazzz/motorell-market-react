-- ============================================================
-- 0020 — Masa tayang titip jual 3 bulan + perpanjangan berbayar (Rp17.000 / 3 bulan).
--
-- Alur:
--   1) Unit titip jual 'approved' punya expires_at (= saat disetujui + 3 bulan).
--   2) Lewat expires_at: unit otomatis diarsipkan (archived_at + expired_at terisi,
--      alasan 'Masa tayang 3 bulan berakhir'). Etalase publik juga langsung
--      menyembunyikannya lewat RLS, jadi tetap benar walau penjadwal telat jalan.
--   3) Penjual melihat pemberitahuan + tombol Perpanjang. Pembayaran berhasil
--      (webhook Doku, type 'titip_extend') → fungsi titip_extend_3m() menambah 3 bulan
--      dan menayangkan kembali unit yang tadinya kedaluwarsa otomatis.
--
-- KEAMANAN: trigger pengaman penjual (0006) diperluas — penjual TIDAK boleh mengubah
-- expires_at / expired_at / extended_count, dan juga kolom arsip (celah lama: penjual
-- bisa membuka arsip unitnya sendiri). Admin, service_role, dan penjadwal tetap bebas.
--
-- Idempoten. Butuh 0003, 0006, 0013, 0015. Supabase → SQL Editor → Run.
-- ============================================================

-- 1) Kolom.
alter table public.titip_jual_units add column if not exists expires_at timestamptz;
alter table public.titip_jual_units add column if not exists expired_at timestamptz;      -- terisi = diarsipkan OTOMATIS karena masa tayang habis
alter table public.titip_jual_units add column if not exists extended_count integer not null default 0;
create index if not exists titip_jual_expiry_idx on public.titip_jual_units (expires_at)
  where status = 'approved' and archived_at is null;

-- 2) Backfill unit yang SUDAH tayang: 3 bulan sejak disetujui, tapi minimal 14 hari
--    dari sekarang (masa tenggang) supaya unit lama tidak langsung hilang malam ini.
update public.titip_jual_units
set expires_at = greatest(coalesce(reviewed_at, created_at) + interval '3 months', now() + interval '14 days')
where status = 'approved' and archived_at is null and expires_at is null;

-- 3) Saat unit DISETUJUI (status berubah menjadi 'approved'), mulai hitung 3 bulan.
create or replace function public.titip_set_expiry()
returns trigger language plpgsql as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    new.expires_at := now() + interval '3 months';
    new.expired_at := null;
  end if;
  return new;
end; $$;

drop trigger if exists titip_jual_set_expiry on public.titip_jual_units;
create trigger titip_jual_set_expiry
  before update on public.titip_jual_units
  for each row execute function public.titip_set_expiry();

-- 4) Trigger pengaman penjual (menggantikan versi 0006): kolom baru ikut dikunci.
--    Lolos tanpa batasan: admin, service_role, dan koneksi tanpa auth.uid()
--    (penjadwal pg_cron, SQL Editor, fungsi SECURITY DEFINER).
create or replace function public.titip_seller_update_guard()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if public.is_staff_admin() or auth.uid() is null or auth.role() = 'service_role' then
    return new;
  end if;
  new.seller_id        := old.seller_id;
  new.status           := old.status;
  new.reviewed_by      := old.reviewed_by;
  new.reviewed_at      := old.reviewed_at;
  new.rejection_reason := old.rejection_reason;
  new.archived_at      := old.archived_at;
  new.archived_by      := old.archived_by;
  new.archived_reason  := old.archived_reason;
  new.expires_at       := old.expires_at;
  new.expired_at       := old.expired_at;
  new.extended_count   := old.extended_count;
  return new;
end;
$$;

-- 5) Etalase publik: unit yang lewat masa tayang tidak terbaca anon (walau cron belum jalan).
drop policy if exists titip_jual_select_approved on public.titip_jual_units;
create policy titip_jual_select_approved on public.titip_jual_units
  for select using (
    status = 'approved' and archived_at is null
    and (expires_at is null or expires_at > now())
  );

-- 6) Arsip otomatis. Dipanggil penjadwal (lihat 0021).
create or replace function public.titip_expire_due()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare n integer;
begin
  update public.titip_jual_units
     set archived_at = now(), archived_by = null,
         archived_reason = 'Masa tayang 3 bulan berakhir',
         expired_at = now()
   where status = 'approved' and archived_at is null
     and expires_at is not null and expires_at <= now();
  get diagnostics n = row_count;
  return n;
end; $$;
revoke all on function public.titip_expire_due() from public, anon, authenticated;

-- 7) Perpanjang 3 bulan. Dipanggil HANYA oleh webhook Doku (service_role) setelah bayar.
--    Menambah dari tanggal berakhir bila belum lewat, atau dari sekarang bila sudah lewat.
--    Hanya unit yang kedaluwarsa OTOMATIS yang dibuka arsipnya (arsip oleh admin tetap).
create or replace function public.titip_extend_3m(p_unit uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.titip_jual_units set
    expires_at      = greatest(coalesce(expires_at, now()), now()) + interval '3 months',
    extended_count  = extended_count + 1,
    archived_at     = case when expired_at is not null then null else archived_at end,
    archived_by     = case when expired_at is not null then null else archived_by end,
    archived_reason = case when expired_at is not null then null else archived_reason end,
    expired_at      = null
  where id = p_unit and status = 'approved';
end; $$;
revoke all on function public.titip_extend_3m(uuid) from public, anon, authenticated;
grant execute on function public.titip_extend_3m(uuid) to service_role;

-- 8) Izinkan jenis pembayaran baru.
alter table public.payments drop constraint if exists payments_type_check;
alter table public.payments add constraint payments_type_check
  check (type in ('etalase', 'titip', 'titip_extend'));

-- VERIFIKASI
-- select merek, model, status, expires_at, expired_at from public.titip_jual_units where status='approved' order by expires_at;
