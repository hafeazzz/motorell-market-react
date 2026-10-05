-- ============================================================
-- 0017 — Perbaiki upload foto unit untuk role OWNER.
--
-- Regresi dari 0016: policy longgar "unit-photos authenticated *" dibuang
-- (benar), tapi policy staf yang tersisa memakai is_staff() yang HANYA
-- mengenali role kurator/admin — owner tidak termasuk. Dulu owner lolos
-- lewat policy longgar itu; setelah dibuang, upload owner ditolak RLS
-- ("Sesi atau izin bermasalah").
--
-- Perbaikan: policy staf unit-photos menerima is_staff() ATAU is_staff_admin()
-- (is_staff_admin = admin + owner). Tetap staff-only — user biasa tetap
-- ditolak. is_staff() sendiri TIDAK diubah (dipakai di banyak tabel lain).
-- Idempoten.
-- ============================================================
drop policy if exists unit_photos_staff_insert on storage.objects;
drop policy if exists unit_photos_staff_update on storage.objects;
drop policy if exists unit_photos_staff_delete on storage.objects;

create policy unit_photos_staff_insert on storage.objects for insert
  with check (bucket_id = 'unit-photos' and (public.is_staff() or public.is_staff_admin()));
create policy unit_photos_staff_update on storage.objects for update
  using (bucket_id = 'unit-photos' and (public.is_staff() or public.is_staff_admin()));
create policy unit_photos_staff_delete on storage.objects for delete
  using (bucket_id = 'unit-photos' and (public.is_staff() or public.is_staff_admin()));
