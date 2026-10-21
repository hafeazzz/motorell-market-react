-- 0019 — Tautan listing Market ke motor di Motorell Ops (sinkron Ops -> Market).
-- ops_unit_id = id motor di Ops. Unik supaya kiriman ulang memperbarui listing yang sama, bukan menggandakan.
alter table public.listings add column if not exists ops_unit_id uuid;
alter table public.listings add column if not exists ops_synced_at timestamptz;
create unique index if not exists listings_ops_unit_uq on public.listings (ops_unit_id) where ops_unit_id is not null;
