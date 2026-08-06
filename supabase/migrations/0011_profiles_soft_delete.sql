-- ============================================================
-- 0011 — Soft delete akun: kolom profiles.deleted_at.
--
-- KENAPA HANYA KOLOM, TANPA POLICY BARU:
--   Snippet rencana (STEP 2) membuat policy `profiles_update_staff` &
--   `profiles_soft_delete` dengan `is_staff_admin()` polos di USING+WITH CHECK
--   → itu MEMBATALKAN pembatasan ketat 0010: admin mana pun jadi bisa meng-UPDATE
--   baris siapa pun ke peran apa pun (promote diri ke owner, mengedit owner, dst)
--   selama deleted_at NULL. Itu regresi keamanan → TIDAK dipakai.
--
--   Policy 0010 yang ada SUDAH mengizinkan update soft-delete yang benar:
--     • admin/owner set deleted_at pada baris PENGGUNA (peran tetap buyer/inactive
--       → lolos WITH CHECK `role in ('buyer','inactive')`),
--     • owner set deleted_at pada siapa pun (profiles_update_owner, kuasa penuh).
--   Admin TIDAK bisa menghapus staf (USING 0010 menyaring baris staf) — memang
--   disengaja: hapus/pulihkan staf = hak owner. Jadi cukup tambah kolomnya.
--
-- Penegakan: loadProfile() menutup sesi bila deleted_at != null (atau role
-- 'inactive'). Blokir LUNAK (auth tak tahu deleted_at) — cukup mencegah pemakaian.
-- Restore = set deleted_at = null. Ban keras/hapus auth.users butuh Edge Function
-- service_role (di luar cakupan ini) — snippet pun memilih soft delete.
--
-- Idempoten. Butuh 0010. Supabase → SQL Editor → Run.
-- ============================================================
alter table public.profiles
  add column if not exists deleted_at timestamptz;

-- Baris yang dihapus jarang di-query per-status, tapi index parsial ini murah dan
-- mempercepat pemindaian "yang masih aktif" bila kelak dipakai.
create index if not exists profiles_deleted_at_idx
  on public.profiles (deleted_at) where deleted_at is not null;

-- ============================================================
-- VERIFIKASI
-- select column_name, data_type from information_schema.columns
--   where table_name='profiles' and column_name='deleted_at';
-- ============================================================
