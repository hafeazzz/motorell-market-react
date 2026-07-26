import { createClient } from '@supabase/supabase-js'

// ============================================================
// SATU-SATUNYA instance Supabase untuk SELURUH app (singleton).
//
// Sebelumnya createClient dipanggil di 3 modul (App.jsx, ModPartForm.jsx,
// ModPartPanel.jsx). Tiap panggilan membuat GoTrueClient sendiri yang berbagi
// storage key auth yang SAMA → peringatan browser "Multiple GoTrueClient
// instances detected in the same browser context". Semua modul kini mengimpor
// `supabase` dari sini, jadi hanya ADA SATU instance.
//
// Konfigurasi auth (pkce dsb) dipusatkan supaya konsisten di mana pun.
// ============================================================
const SUPA_URL = import.meta.env.VITE_SUPABASE_URL
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = SUPA_URL && SUPA_KEY
  ? createClient(SUPA_URL, SUPA_KEY, {
      // flowType 'pkce': login OAuth (Google) kembali dengan `?code=...` di QUERY,
      // tidak bentrok dengan hash-router; sesi ditukar otomatis (detectSessionInUrl).
      auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
    })
  : null
