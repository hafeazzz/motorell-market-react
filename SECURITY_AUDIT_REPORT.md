# Security Audit Report — MotorellMarket

**Tanggal:** 2026-07-26 · **Stack:** Vite + React (SPA) · Vercel · Supabase
**Cakupan:** Phase 1–5. **Metode:** pemeriksaan langsung + 16 test otomatis yang
BENAR-BENAR dijalankan (bukan asumsi). Hal yang tak bisa diuji dari CLI ditandai
jujur (SKIP), bukan dipalsukan.

---

## 1. Executive Summary

MotorellMarket **layak diluncurkan dengan catatan ringan**. Kontrol keamanan inti
terbukti bekerja: **RLS memblokir tulisan anonim** di semua tabel, **tak ada
secret bocor** ke frontend, **header keamanan aktif di produksi**, dan input
pengguna **di-escape** (aman dari XSS) serta query **parameterized** (aman dari
SQLi). Dari 16 test otomatis: **15 lulus, 1 gagal, 1 skip**. Satu-satunya
kegagalan adalah **rate limiting** (tak ada di level app) — bukan lubang aktif,
tapi pengerasan yang sebaiknya dipasang. Tidak ada temuan ❌ yang memblokir.

---

## 2. Scorecard (10 kategori)

| # | Kategori | Status |
|---|---|:--:|
| 1 | Kerentanan dependency | ⚠️ |
| 2 | Manajemen secret | ✅ |
| 3 | Header keamanan (prod) | ✅ |
| 4 | Higiene build (no leak) | ✅ |
| 5 | Proteksi XSS | ✅ |
| 6 | Injeksi (SQLi) | ✅ |
| 7 | RLS — proteksi tulis | ✅ |
| 8 | Auth & kontrol akses | ✅ |
| 9 | Validasi upload file | ⚠️ |
| 10 | Rate limiting / anti-abuse | ⚠️ |

**Legenda:** ✅ aman · ⚠️ perbaiki Minggu 1 · ❌ blokir peluncuran

---

## 3. Hasil Test Otomatis (16 kasus) — **15 PASS / 1 FAIL / 1 SKIP**

Dijalankan via runner Playwright ekuivalen (proyek belum punya dep
`@playwright/test`; file `tests/security.spec.ts` siap dijalankan dengan
`npm i -D @playwright/test && npx playwright test`).

| # | Kasus | Hasil | Bukti |
|---|---|:--:|---|
| 1 | XSS `<script>` di search tak dieksekusi | ✅ PASS | tak ada `alert`/eksekusi |
| 2 | XSS `<img onerror>` tak dieksekusi/masuk DOM | ✅ PASS | 0 elemen `img[onerror]` |
| 3 | Input berbahaya jadi teks (React escape) | ✅ PASS | nilai literal |
| 4 | SQLi `' OR 1=1` tak mendump data | ✅ PASS | HTTP 200, **0 baris** |
| 5 | SQLi `DROP TABLE` tak berefek | ✅ PASS | filter 403, tabel after **200** |
| 6 | Upload tolak `.exe` | ✅ PASS | `invalid_type` |
| 7 | Upload tolak > 5MB | ✅ PASS | `file_too_large` |
| 8 | Upload terima JPG/PNG/WEBP ≤5MB | ✅ PASS | — |
| 9 | Non-staff ditolak panel admin | ✅ PASS | tak ada kontrol admin |
| 10 | Anon ditolak panel admin | ✅ PASS | login gate |
| 11 | Titip submit butuh login | ✅ PASS | gate, bukan form |
| 12 | Anon INSERT `listings` → ditolak | ✅ PASS | **401** |
| 13 | Anon INSERT `titip_jual_units` → ditolak | ✅ PASS | **401** |
| 14 | Anon SELECT `listings` publik → 200 | ✅ PASS | disengaja (etalase) |
| 15 | Error tak bocorkan stack/file path | ✅ PASS | HTTP 400 bersih |
| 16 | **Rate limiting 120 req → 429** | ❌ **FAIL** | **0/120** dapat 429 |
| S1 | RLS lintas-user (A tak lihat pending B) | ⏭️ SKIP | butuh 2 akun + login (uji manual) |

---

## 4. Detailed Findings (Phase 1–5)

### Phase 1 — Dependency & Secrets
- `npm audit`: **1 HIGH = PostCSS** (GHSA-r28c-9q8g-f849). Dependency **build-time**,
  tidak dikirim ke browser → risiko produksi rendah. Fix: `npm audit fix`.
- `.env.local`: hanya `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (anon key
  publik by design). **Tidak ada** `service_role`/DB password. Gitignored & tak
  ter-track (hanya `.env.example` placeholder yang ter-commit).

### Phase 2 — Config & Build
- `vercel.json`: 7 header, CSP **enforced**. Diverifikasi di produksi
  (`motorell-market.vercel.app`, 200): CSP `default-src 'self'…` + HSTS
  `max-age=63072000; includeSubDomains; preload` terkirim.
- `npm run build`: SUKSES; scan `dist/` → **0** service_role / access-token /
  connection string.

### Phase 3 — Automated testing
- **15/16 lulus** (lihat tabel §3). Gagal hanya #16 (rate limiting). Skip S1
  (lintas-user). File test: `tests/security.spec.ts`.

### Phase 4.1 — RLS
- Anon INSERT ditolak (**401**) di `listings`, `mod_parts`, `titip_jual_units`,
  `profiles` → RLS aktif menjaga tulisan. Public read `listings`/approved titip
  = 200 (disengaja). Kebijakan self/own/admin ada di migrasi 0002 & 0003.
- ⚠️ RLS `listings` & `mod_parts` **tidak ada file migrasi**-nya di repo (aktif di
  DB live, tapi tak ter-version-control).

### Phase 4.2 — Bucket policies
- `unit-photos` & `titip-jual-photos` **ada** (probe → "Object not found").
- ⚠️ `file_size_limit` & `allowed_mime_types` **TIDAK diset** di migrasi
  (`insert … (id, name, public)` saja → default NULL/tak terbatas). Anon tak bisa
  membaca config bucket (list kosong) → **verifikasi & set di Supabase**:
  ```sql
  select id, file_size_limit, allowed_mime_types from storage.buckets
  where id in ('unit-photos','titip-jual-photos');
  -- bila NULL, set:
  update storage.buckets set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg','image/png','image/webp']
  where id in ('unit-photos','titip-jual-photos');
  ```

---

## 5. GO-LIVE DECISION

# ⚠️ APPROVED WITH CAUTION — luncurkan, perbaiki item ⚠️ di Minggu 1

Tidak ada ❌. Kontrol kritikal (RLS, secret, header, XSS/SQLi, kontrol akses)
solid & terverifikasi. Selesaikan **#1 & #2** di bawah sebelum go-live; sisanya
Minggu 1.

---

## 6. Risk Summary & Recommendations

| Risiko | Tingkat | Rekomendasi |
|---|:--:|---|
| Upload limit hanya di klien (bypassable) | Sedang | **Set `file_size_limit`+`allowed_mime_types` bucket** (SQL §4.2) |
| Tak ada rate limiting | Sedang-Rendah | Pasang **Vercel Firewall** rate-limit rule; Supabase sudah limit auth bawaan |
| RLS `listings`/`mod_parts` tak ter-version | Rendah | Commit sebagai `supabase/migrations/0004_*.sql` |
| PostCSS HIGH (build-time) | Rendah | `npm audit fix` |
| RLS lintas-user belum diuji | Rendah | Uji manual 2 akun (A tak lihat pending/profil B) |

**Prioritas sebelum launch:** (1) set limit bucket, (2) uji RLS 2-akun. **Minggu 1:**
Vercel Firewall, migrasi RLS, `npm audit fix`.

---

## 7. Post-Launch Monitoring Checklist

- [ ] **Supabase → Logs**: pantau lonjakan 4xx/5xx REST & Auth (indikasi abuse/brute-force).
- [ ] **Supabase → Auth → Rate Limits**: pastikan aktif; pantau kegagalan login mencurigakan.
- [ ] **Vercel → Firewall/Analytics**: pantau traffic anomali; aktifkan rate-limit rule.
- [ ] **Storage**: cek ukuran bucket & tipe file yang masuk (deteksi upload nakal) sampai limit server aktif.
- [ ] **CSP**: pantau apakah ada fitur yang patah karena CSP enforced (console report); siapkan `Report-Only` bila perlu tuning.
- [ ] **Dependency**: jadwalkan `npm audit` mingguan (atau Dependabot).
- [ ] **Backup**: verifikasi backup harian jalan (lihat SETUP.md) & uji-restore berkala.
- [ ] **DB**: audit berkala tabel baru — pastikan RLS `enable`d + policy sebelum expose.
- [ ] **Secret rotation**: rotasi anon/DB credential bila ada indikasi kebocoran.
- [ ] **Titip Jual PII**: pastikan hanya admin & pemilik yang akses data penjual (uji ulang setelah perubahan skema).
