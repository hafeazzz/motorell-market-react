-- ============================================================
-- 0013 — Tabel payments untuk gateway Doku (Checkout / non-SNAP).
--
-- KEAMANAN (kenapa BEDA dari snippet rencana):
--   • Rencana menaruh VITE_DOKU_SECRET_KEY di frontend & memanggil api.doku.com
--     dari browser. VITE_* DI-INLINE ke bundel JS → secret bocor ke semua
--     pengunjung; amount pun diset di klien → bisa dimanipulasi (bayar Rp1).
--   • Di sini: klien TIDAK PERNAH menulis payments & tidak pernah memegang secret.
--     Baris payments HANYA dibuat/diubah oleh Edge Function (service_role):
--       - create-doku-payment: validasi amount di server, buat invoice, panggil Doku.
--       - doku-webhook: verifikasi tanda tangan Doku, update status.
--     Klien cuma SELECT (punya sendiri / staf).
--
-- Idempoten. Butuh 0007 (is_staff_admin) & 0009 (touch_updated_at). SQL Editor → Run.
-- ============================================================
create extension if not exists pgcrypto;

create table if not exists public.payments (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid,                                   -- null utk guest; tanpa FK (tahan hapus akun)
  type             varchar(20) not null check (type in ('etalase', 'titip')),
  amount           integer not null check (amount > 0),
  currency         varchar(3) not null default 'IDR',
  status           varchar(20) not null default 'pending'
                     check (status in ('pending', 'success', 'failed', 'expired')),
  full_name        varchar(120),
  email            varchar(255),
  phone            varchar(40),
  listing_id       uuid,                                   -- opsional (DP etalase)
  invoice_number   varchar(80) not null unique,            -- referensi order ke Doku
  doku_checkout_url text,
  doku_token_id    text,
  paid_at          timestamptz,
  raw_notification jsonb,                                  -- payload webhook mentah (audit)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists payments_user_idx    on public.payments (user_id);
create index if not exists payments_status_idx  on public.payments (status);
create index if not exists payments_created_idx on public.payments (created_at desc);

-- updated_at otomatis (fungsi dari 0009).
drop trigger if exists trg_payments_touch on public.payments;
create trigger trg_payments_touch before update on public.payments
  for each row execute function public.touch_updated_at();

alter table public.payments enable row level security;

-- Baca: pemiliknya sendiri atau staf. TANPA policy insert/update/delete →
-- klien tak bisa menulis; hanya Edge Function (service_role) yang membuat/mengubah.
drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments
  for select to authenticated
  using (user_id = auth.uid() or public.is_staff_admin());

-- ============================================================
-- VERIFIKASI
-- select tablename, rowsecurity from pg_tables where tablename='payments';
-- select polname, cmd from pg_policies where tablename='payments';
-- ============================================================
