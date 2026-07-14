// Kategori part modifikasi — dipakai bersama oleh App.jsx (halaman detail) dan
// ModPartForm/ModPartPanel (panel admin). Ditaruh di modul sendiri supaya panel
// tidak perlu meng-import App.jsx (yang meng-import panel-nya → lingkaran).
//
// Kolom mod_parts.category baru ada setelah migrasi
// supabase/migrations/0001_mod_part_category.sql dijalankan. Sebelum itu — dan
// untuk part lama yang category-nya NULL — part jatuh ke 'Lainnya', jadi tidak
// ada part yang hilang dari UI.
export const MOD_CATEGORIES = ['Ban', 'Jok', 'Handlebar', 'Exhaust', 'Lainnya']

export const CAT_FALLBACK = 'Lainnya'

export const catOf = (part) =>
  MOD_CATEGORIES.includes(part?.category) ? part.category : CAT_FALLBACK
