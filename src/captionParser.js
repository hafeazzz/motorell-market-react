// ============================================================
// Parser caption Instagram → field form unit.
//
// Modul terpisah (bukan di dalam App.jsx) supaya logika regex-nya bisa diuji
// langsung tanpa merender React — lihat jangan-sampai-salah-parse di bawah.
//
// Prinsip: LEBIH BAIK MENGAKU TIDAK TAHU daripada menebak. Tiap field yang
// tidak yakin dikembalikan null supaya UI bisa menandainya "isi manual",
// bukan diisi angka karangan yang lolos begitu saja ke etalase.
//
// Caption diproses PER BARIS, bukan satu regex global. Caption IG memang
// ditulis satu fakta per baris, dan cara ini mencegah angka saling comot
// (harga tidak tertukar dengan KM, tahun tidak terambil dari digit harga).
// ============================================================

// Nama kanonis — output-nya SELALU casing dari daftar ini, bukan dari caption.
// Alasannya bukan kosmetik: filter etalase mencocokkan brand persis string
// (panel.brands.includes(l.brand)), jadi "YAMAHA" dari caption all-caps akan
// memunculkan entri facet kedua di samping "Yamaha" yang sudah ada.
// Yang multi-kata ditaruh duluan supaya "Royal Enfield" menang atas "Enfield".
const KNOWN_BRANDS = [
  'Harley-Davidson', 'Harley Davidson', 'Royal Enfield', 'Moto Guzzi',
  'Honda', 'Yamaha', 'Kawasaki', 'Suzuki', 'Vespa', 'Piaggio', 'Benelli',
  'Ducati', 'Aprilia', 'Triumph', 'Husqvarna', 'Kymco', 'Minerva',
  'Bajaj', 'Viar', 'KTM', 'BMW', 'TVS', 'SYM', 'Harley',
]

// Harga motor bekas yang masuk akal. Batas bawah 1 juta bukan iseng: ia yang
// membuat "DP 500rb bisa booking" tidak terbaca sebagai harga unit.
const PRICE_MIN = 1_000_000
const PRICE_MAX = 1_000_000_000
const KM_MAX = 999_999
const YEAR_MIN = 2010

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
const digitsOf = (s) => Number(String(s).replace(/[^\d]/g, ''))
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim()

// ---------- Harga ----------
// Urutan dicoba dari yang paling eksplisit ke yang paling longgar.
export function parsePrice(line) {
  // "27,8 juta" / "27jt" / "27.8 jt"
  let m = line.match(/(\d+(?:[.,]\d+)?)\s*(?:juta|jt)\b/i)
  if (m) {
    const v = Math.round(Number(m[1].replace(',', '.')) * 1_000_000)
    if (v >= PRICE_MIN && v <= PRICE_MAX) return v
  }
  // "27.800.000" / "27,800,000" / "Rp 27.800.000"
  // Butuh MINIMAL 2 gugus ribuan — inilah yang memisahkan harga dari "KM 8.500"
  // (1 gugus), tanpa perlu tahu kata "KM"-nya sama sekali.
  m = line.match(/\b\d{1,3}(?:[.,]\d{3}){2,}\b/)
  if (m) {
    const v = digitsOf(m[0])
    if (v >= PRICE_MIN && v <= PRICE_MAX) return v
  }
  // "27800000" telanjang
  m = line.match(/\b\d{7,10}\b/)
  if (m) {
    const v = digitsOf(m[0])
    if (v >= PRICE_MIN && v <= PRICE_MAX) return v
  }
  return null
}

// ---------- Kilometer ----------
export function parseKm(line) {
  // "KM 8.500" / "km: 8500" — satuan di DEPAN angka
  let m = line.match(/\bkm\.?\s*:?\s*(\d[\d.,]*)/i)
  // "8.500 KM" / "8500km" / "8.500 kilometer" — satuan di BELAKANG
  if (!m) m = line.match(/(\d[\d.,]*)\s*(?:km|kilometer)\b/i)
  if (!m) return null
  const v = digitsOf(m[1])
  return Number.isFinite(v) && v >= 0 && v <= KM_MAX ? v : null
}

// ---------- Tahun ----------
// \b penting: "27800000" tidak mengandung batas kata di dalamnya, jadi digit
// "2780" di tengah harga tidak akan terbaca sebagai tahun.
export function parseYear(text, now = new Date().getFullYear()) {
  const hits = [...String(text).matchAll(/\b(19[89]\d|20[0-3]\d)\b/g)].map((m) => Number(m[1]))
  const ok = hits.filter((y) => y >= YEAR_MIN && y <= now + 1)
  return ok.length ? ok[0] : null
}

// ---------- Merek & model ----------
export function parseBrandModel(line) {
  for (const brand of KNOWN_BRANDS) {
    const m = line.match(new RegExp('\\b' + escapeRe(brand) + '\\b', 'i'))
    if (!m) continue
    let rest = line.slice(m.index + m[0].length)
    rest = rest.replace(/\b(19[89]\d|20[0-3]\d)\b/g, ' ')      // tahun
    rest = rest.replace(/\b(th|thn|tahun)\b\.?/gi, ' ')        // "th 2021"
    rest = rest.replace(/[^\w\s/-]/g, ' ')                     // emoji/tanda baca
    rest = clean(rest)
    // Model dibiarkan apa adanya dari caption (mis. "XSR 155", "W175 SE") —
    // di-Title-Case-kan justru merusak: "XSR" akan jadi "Xsr".
    return { brand, model: rest || null }
  }
  return null
}

// ---------- Caption utuh ----------
// Mengembalikan { fields, filled, missing, nett } — `filled` dipakai UI untuk
// menandai field mana yang hasil auto-isi, `missing` untuk yang harus diisi
// tangan.
export function parseCaption(raw) {
  const lines = String(raw || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const out = { brand: null, model: null, year: null, price: null, mileage_km: null, description: null }
  const rest = []
  let nett = false
  let titleDone = false

  for (const line of lines) {
    // Urutan pengecekan menentukan: KM lebih dulu supaya baris "KM 8.500"
    // tidak sempat diadu ke parser harga.
    const km = parseKm(line)
    if (km !== null && out.mileage_km === null) { out.mileage_km = km; continue }

    const price = parsePrice(line)
    if (price !== null && out.price === null) {
      out.price = price
      if (/\bnett?\b/i.test(line)) nett = true
      if (/\bnego\b/i.test(line)) nett = false
      continue
    }

    if (!titleDone) {
      const bm = parseBrandModel(line)
      if (bm) {
        out.brand = bm.brand
        out.model = bm.model
        out.year = parseYear(line)
        titleDone = true
        continue
      }
    }
    rest.push(line)
  }

  // Tahun boleh berada di baris lain kalau tidak ada di baris judul — tapi
  // hanya dicari di sisa teks yang BUKAN harga/KM, supaya tidak salah comot.
  if (out.year === null) out.year = parseYear(rest.join(' '))

  out.description = rest.length ? rest.join('\n') : null

  const filled = Object.keys(out).filter((k) => out[k] !== null && out[k] !== '')
  const missing = Object.keys(out).filter((k) => out[k] === null || out[k] === '')
  return { fields: out, filled, missing, nett }
}

export { KNOWN_BRANDS }
