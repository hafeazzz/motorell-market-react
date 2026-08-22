// ---------- Smart brand reader ----------
// Merek diketik BEBAS oleh penjual (form titip jual) dan admin, jadi "Honda",
// "HONDA", dan " honda " pasti bercampur di database. Tanpa penyeragaman:
//  - filter etalase menumbuhkan tiga chip untuk merek yang sama, dan memilih
//    satu chip menyembunyikan unit dua chip lainnya;
//  - admin tak sadar merek itu sudah ada lalu menambah ejaan keempat.
//
// Modul ini SENGAJA murni (tanpa supabase / tanpa I/O): merek selalu sudah ada
// di baris yang dimuat halaman, jadi saran bisa dihitung di memori. Rancangan
// awal menembak `select merek` ke database TIAP KETIKAN — satu query per huruf
// untuk data yang sudah ada di tangan.

// Kunci pembanding. Semua perbandingan merek harus lewat sini.
export const normalizeBrand = (brand) => String(brand ?? '').trim().toLowerCase()

// Apakah merek ini sudah ada (abaikan besar-kecil huruf & spasi tepi)?
export const isBrandExists = (brand, existing = []) => {
  const key = normalizeBrand(brand)
  return key !== '' && existing.some((b) => normalizeBrand(b) === key)
}

// Kumpulkan merek unik dari sekumpulan baris. `key` beda per tabel:
// titip_jual_units pakai 'merek', listings resmi pakai 'brand'.
export const collectBrands = (rows = [], key = 'merek') =>
  rows.map((r) => String(r?.[key] ?? '').trim()).filter(Boolean)

// Pilih SATU ejaan resmi dari beberapa varian huruf besar-kecil.
//
// Bentuk "Title Case" (Honda) MENANG lebih dulu, baru frekuensi. Sengaja bukan
// frekuensi dulu: mengetik CAPS LOCK itu lazim, jadi "HONDA" gampang jadi varian
// terbanyak dan chip filter berakhir berteriak walau ada yang mengetik "Honda".
//
// Kecuali merek pendek (≤3 huruf): KTM, BMW, TVS memang akronim — di situ
// frekuensi yang menentukan supaya "KTM" tidak berubah jadi "Ktm" hanya karena
// satu orang salah ketik.
const pickCanonical = (variants) => {
  const count = new Map()
  for (const v of variants) count.set(v, (count.get(v) || 0) + 1)
  const akronim = variants[0].replace(/[^\p{L}]/gu, '').length <= 3
  // Non-akronim → utamakan "Honda"; akronim → utamakan "BMW" (bukan "bmw").
  const disukai = (s) => (akronim
    ? (s === s.toUpperCase() ? 1 : 0)
    : (/^\p{Lu}\p{Ll}/u.test(s) ? 1 : 0))
  return [...count.entries()].sort((a, b) =>
    (disukai(b[0]) - disukai(a[0])) ||
    (b[1] - a[1]) ||
    a[0].localeCompare(b[0])
  )[0][0]
}

// Daftar merek unik CASE-INSENSITIVE, masing-masing memakai ejaan resminya.
// Inilah yang dipakai membangun chip filter etalase.
export const dedupeBrands = (brands = []) => {
  const groups = new Map()
  for (const b of brands) {
    const t = String(b ?? '').trim()
    if (!t) continue
    const key = normalizeBrand(t)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(t)
  }
  return [...groups.values()].map(pickCanonical).sort((a, b) => a.localeCompare(b))
}

// Kalau merek yang diketik sudah ada dengan ejaan lain, PAKAI ejaan yang sudah
// ada — supaya penyimpanan tidak menambah varian baru. Kalau benar-benar baru,
// pakai apa adanya (hanya dirapikan spasinya).
export const canonicalBrand = (input, existing = []) => {
  const t = String(input ?? '').trim().replace(/\s+/g, ' ')
  if (!t) return ''
  const key = normalizeBrand(t)
  const hit = existing.find((b) => normalizeBrand(b) === key)
  return hit ? String(hit).trim() : t
}

// Saran merek untuk kotak ketik admin. Cocokkan case-insensitive; yang berawalan
// sama diprioritaskan di atas yang sekadar mengandung.
export const brandSuggestions = (input, existing = [], limit = 8) => {
  const all = dedupeBrands(existing)
  const key = normalizeBrand(input)
  if (!key) return all.slice(0, limit)
  const starts = all.filter((b) => normalizeBrand(b).startsWith(key))
  const contains = all.filter((b) => !normalizeBrand(b).startsWith(key) && normalizeBrand(b).includes(key))
  return [...starts, ...contains].slice(0, limit)
}
