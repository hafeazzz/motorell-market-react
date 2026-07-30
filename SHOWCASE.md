# 3D Interactive Showcase — Dokumentasi (akurat)

Halaman showcase motor 3D di route **`#/showcase`**. Dokumen ini **menggambarkan
kode yang benar-benar ada** — bukan struktur ideal. (Doc "v1.0" sebelumnya banyak
menyebut file/dep/fitur yang tak ada; abaikan yang itu.)

## Ringkas

- **Route:** `#/showcase` (hash-router, `parseHash` di `src/App.jsx`). Bukan react-router.
- **Lazy-load:** `const Showcase3D = lazy(() => import('./Showcase3D'))` di `App.jsx`.
  three/R3F (~950KB: `three` ~700KB + chunk showcase ~236KB) hanya termuat saat
  route ini dibuka. **Bundle & performa halaman lain tidak terpengaruh** (terverifikasi:
  `three` tidak ada di entry chunk utama).
- **Render:** early-return layar penuh — hero produksi `<model-viewer>` **tidak** diganti.

## File

- **`src/Showcase3D.jsx`** — SATU file berisi seluruh scene + UI + CSS (scoped via
  `<style>`). Tidak ada folder `pages/`, `components/MotorScene/`, `hooks/`, `utils/`.
- **`src/App.jsx`** — route `#/showcase`, lazy import, tombol "Lihat 3D" di hero.
- **`public/models/harley-davidson-flhrxs.glb`** — model Harley, Draco + tekstur WebP
  (dikompres 14MB→2,44MB). Decoder Draco dimuat drei dari `www.gstatic.com`
  (sudah diizinkan CSP di `vercel.json`; sama seperti model-viewer).

## Dependensi (yang BENAR terpasang)

- `three@0.183.2` — **dipin ke 0.183** agar cocok dengan `@google/model-viewer@4.3.1`
  (yang menuntut `three ^0.183`). Menginstal three lain (mis. 0.169) **mematahkan build**.
- `@react-three/fiber@^8` (React 18 — v9 butuh React 19), `@react-three/drei@^9`.
- `framer-motion` (sudah ada) untuk animasi overlay.
- **TIDAK dipakai:** zustand (pakai `useState`), Tailwind (pakai CSS scoped),
  `@react-three/postprocessing`, analytics/gtag, react-router.

## Scene

- Kamera perspektif; `dpr={[1,2]}`; background gradient (`#1f2a38`) + `<fog>`.
- **3 lampu**: key (directional putih), fill (biru sejuk), rim (putih-sejuk belakang)
  + ambient. **Rim = DirectionalLight**, bukan gold PointLight.
- **Environment lokal** dari 3 `<Lightformer>` (drei) → env-map untuk pantulan cat
  metalik (glossy) **tanpa CDN**.
- `<ContactShadows>` bayangan lembut di bawah.

## Interaksi

| Aksi | Perilaku |
|---|---|
| Idle | Auto-rotate (turntable) + bobbing halus (±4cm) |
| Seret / sentuh | Putar (OrbitControls, damping) |
| Scroll / pinch | Zoom (jarak 2,4–7) |
| Klik dua kali | Zoom detail (lerp FOV 42↔26) |
| Hover | Highlight glossy (emissive) + **tooltip global** |
| Keyboard | ←/→ putar horizontal, ↑/↓ putar vertikal, Enter=belanja, Esc=keluar |
| Color picker | Ganti warna cat bodi (tint material metalik) |

## UI overlay

Logo "MOTORELLMARKET", 3 teks fitur (stagger via framer-motion), tombol CTA
**"Mulai Belanja"** (hover: scale 1.05 + glow emas `#9C7A45`), tombol "← Beranda",
dan **swatch warna** (kanan-atas). Loader saat model dimuat (`<Loader>` drei).
Fallback saat WebGL gagal via error boundary.

## Batasan (jujur)

- **Hover per-bagian (roda/mesin/jok terpisah): TIDAK ADA.** GLB sudah tergabung
  (join/weld saat optimasi) → hover & color picker mengenai **seluruh** model.
  Butuh **GLB baru yang mesh-nya terpisah & bernama** (bukan soal kode).
- **Color picker** men-tint material metalik → sebagian aksen krom bisa ikut berubah.
- **Tidak ada:** partikel, audio, spotlight-detail, timeline sinematik 15 detik,
  KTX2, FPS limiter, analytics.
- Diuji di **Chromium headless (swiftshader)** — **belum** di perangkat iOS/Android
  nyata, belum audit Lighthouse/axe.

## Menjalankan

```bash
npm install          # butuh three@0.183.2 + @react-three/fiber@8 + drei@9
npm run dev          # buka http://localhost:5173/#/showcase
npm run build && npm run preview
```

## Catatan performa

Selama jadi **halaman terpisah** (route sendiri), ~950KB three/R3F lazy → aman.
Kalau kelak dijadikan **hero beranda**, ~950KB itu akan dimuat semua pengunjung
beranda — bertentangan dengan target ringan. Rekomendasi: tetap sebagai showcase khusus.
