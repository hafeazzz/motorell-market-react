// ============================================================
// MOTORELL MARKET — src/App.jsx (single-file SPA)
// Tema: showroom terang ala Porsche (putih, lapang, bersih)
// Stack: React + Vite + Supabase (auth, DB, storage, realtime)
// Pembayaran: Edge Function create-dp-payment -> Midtrans QRIS
// ============================================================

import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import { motion, AnimatePresence, useScroll, useTransform, useInView } from 'framer-motion'
import { createClient } from '@supabase/supabase-js'
import QRCode from 'qrcode'
import ArchiveTab from './ArchiveTab';
import ModPartPanel from './ModPartPanel';
import MotorCarousel from './MotorCarousel';
import Blueprint from './Blueprint';
import { MOD_CATEGORIES, catOf } from './modParts';
import { parseCaption } from './captionParser';
import { openSocialApp } from './utils/deepLink';

// ---------- Konfigurasi ----------
const SUPA_URL = import.meta.env.VITE_SUPABASE_URL
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabase = SUPA_URL && SUPA_KEY ? createClient(SUPA_URL, SUPA_KEY) : null

// Status koneksi dilog sekali saat modul dimuat — cukup untuk memastikan env
// var terbaca tanpa membanjiri console tiap render.
if (!supabase) {
  console.error(
    '[SUPABASE] Env var belum lengkap — app akan menampilkan layar konfigurasi.',
    { VITE_SUPABASE_URL: Boolean(SUPA_URL), VITE_SUPABASE_ANON_KEY: Boolean(SUPA_KEY) },
  )
} else {
  console.info('[SUPABASE] Client siap →', SUPA_URL)
}

// DP dikunci flat Rp500.000 untuk semua unit (bukan persentase).
// Nilai ini juga divalidasi ulang di Edge Function create-dp-payment.
const DP_FIXED = 500000

// Batas foto per unit — foto pertama dalam urutan menjadi sampul etalase.
const MAX_PHOTOS = 10

// Format yang diterima. Dulu filternya cuma `type.startsWith('image/')`, yang
// juga meloloskan GIF/BMP/SVG — tidak pernah dipakai untuk foto motor, dan SVG
// di bucket publik membawa risiko script. Dibatasi ke tiga format foto saja.
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// Batas ukuran file MENTAH, sekadar penjaga: compressImage() sudah menekan tiap
// foto ke maks 1600px @ q0.82 (umumnya <500KB) sebelum diunggah, jadi ukuran
// yang TERSIMPAN sudah aman berapa pun besar aslinya. Batas ini hanya untuk
// menolak file raksasa/rusak yang bisa membuat createImageBitmap tersedak —
// dan kalau kompresi gagal, ia mengembalikan file asli, jadi tetap perlu pagar.
// Sengaja TIDAK 5MB: foto HP kelas atas rutin 8–15MB dan akan tertolak semua
// padahal hasil kompresinya justru kecil.
const MAX_PHOTO_MB = 15

// Paket perlindungan — HARGA FINAL divalidasi ulang di Edge Function.
// Kalau mengubah harga di sini, ubah juga di create-dp-payment.
// Nama paket sengaja tanpa kata "Garansi" (branding), tapi deskripsi tetap
// menjelaskan cakupan garansi mesinnya secara eksplisit.
const WARRANTIES = [
  { code: 'standard', name: 'Avantgard', desc: 'Garansi mesin 7 hari', price: 0 },
  { code: 'plus', name: 'Spectre', desc: 'Garansi mesin 21 hari + free 1× ganti oli', price: 350000 },
  { code: 'max', name: 'Cullinan', desc: 'Garansi mesin 37 hari + free 1× servis & tune up', price: 750000 },
]

// Paket yang boleh dipilih per grade. Unit grade B hanya kebagian paket dasar
// (Avantgard) — Spectre & Cullinan disembunyikan untuk grade B.
const warrantiesForGrade = (grade) =>
  grade === 'B' ? WARRANTIES.filter((w) => w.code === 'standard') : WARRANTIES

// Payment gateway QRIS belum siap produksi — untuk sementara tombol booking
// mengarahkan ke WhatsApp CS. Ganti balik ke 'qris' saat gateway sudah siap;
// BookingModal & invokeCreatePayment tetap utuh, tidak dihapus.
const PAYMENT_MODE = 'whatsapp' // 'whatsapp' | 'qris'
const CS_WHATSAPP_NUMBER = '6285180643531'

// ---------- Lokasi showroom ----------
// Alamat & titik peta diambil dari link Google Maps resmi Motorell Garage.
// MAPS_EMBED memakai output=embed (tanpa perlu API key) supaya peta ASLI-nya
// tampil langsung di halaman; MAPS_LINK membuka Maps penuh untuk rute.
const MAPS_ADDRESS = 'Hb. 2 JI No.2, RT.007/RW.016, Uwung Jaya, Cibodas, Kota Tangerang, Banten 15138'
const MAPS_LINK = 'https://maps.app.goo.gl/W8rsqGtkCVjdy3Ug7?g_st=iw'
const MAPS_EMBED = 'https://maps.google.com/maps?q=' +
  encodeURIComponent('Motorell Garage, ' + MAPS_ADDRESS) + '&z=16&output=embed'

const rupiah = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(Number(n) || 0))
const fmt = (n) => new Intl.NumberFormat('id-ID').format(Number(n) || 0)
const slugify = (s) =>
  String(s).toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const STATUS_LABEL = {
  draft: 'Draft', published: 'Tayang', booked: 'Di-booking', sold: 'Terjual', delisted: 'Arsip',
}

// Definisi grade lengkap — tampil sebagai kartu penjelasan di section kurasi.
const GRADE_DEF = [
  { g: 'S', text: 'Tidak berpatokan pada kilometer rendah, tapi meliputi seluruh kelayakan mesin, tampilan, dan suku cadang dalam kondisi prima — nyaris tidak ada minus.' },
  { g: 'A', text: 'Unit siap pakai, terawat sesuai umur, tanpa masalah yang berarti.' },
  { g: 'B', text: 'Minus ringan tercatat jujur dan tetap layak untuk digunakan sehari-hari.' },
]

// ---------- Section fitur "Kenapa Motorell" ----------
// Foto tetap (bukan foto unit yang berganti-ganti) diunggah manual ke bucket
// unit-photos/features/ di Supabase Storage — jadi tiap section punya foto
// yang benar-benar menggambarkan isinya, bukan foto unit acak yang kebetulan
// termuat lebih dulu.
const STORAGE_BASE = 'https://kaaxeqbocgylrqwxuurc.supabase.co/storage/v1/object/public/unit-photos/features'
const FEATURE_SECTIONS = [
  {
    kicker: 'Kurasi jujur',
    title: 'Minus pun ditulis apa adanya.',
    text: 'Setiap unit diperiksa mekanik sebelum boleh tayang — mesin, rangka, kelistrikan, dokumen, sampai uji jalan. Catatan kurasinya kamu baca sendiri di halaman unit, bukan disembunyikan.',
    photoUrl: STORAGE_BASE + '/minus-pun.jpeg',
  },
  {
    kicker: 'Perlindungan',
    title: 'Garansi mesin sampai 37 hari.',
    text: 'Tiga paket perlindungan bisa dipilih saat booking — dari 7 hari standar sampai 37 hari plus servis & tune up. Semua tertulis, bukan janji lisan.',
    photoUrl: STORAGE_BASE + '/garansi-mesin.jpeg',
  },
  {
    kicker: 'Booking aman',
    title: 'DP ' + rupiah(DP_FIXED) + ', unit langsung terkunci.',
    text: 'Begitu DP masuk, unit hilang dari etalase dan aman dari serobotan. DP kembali penuh bila kondisi unit tidak sesuai laporan kurasi. Sudah diinspeksi sejumlah 50+ titik dan layak kamu bawa pulang.',
    photoUrl: STORAGE_BASE + '/dp-unit.jpeg',
  },
]

// ---------- Cerita/Sejarah Motorell (section "Sejarah Motorell" di home) ----------
// Tiap elemen = satu <p>. Kalimat penutup sengaja berdiri sendiri sebagai
// paragraf terakhir (bukan disambung ke paragraf sebelumnya) supaya tetap
// terbaca sebagai penutup, sesuai naskah aslinya.
const ABOUT_STORY = [
  'Motorell bukan lahir dari modal besar atau showroom mewah. Semua berawal pada tahun 2023, ketika pendirinya masih duduk di bangku Kelas 1 SMA. Berbekal ketertarikan pada dunia otomotif dan keinginan untuk membangun sesuatu sejak usia muda, perjalanan ini dimulai dari jual beli motor bekas secara sederhana.',
  'Di setiap transaksi, ada satu prinsip yang selalu dijaga: kejujuran. Kami percaya motor bekas tidak seharusnya dijual dengan cerita yang disembunyikan. Riwayat kendaraan, kondisi mesin, hingga kekurangan yang ada harus disampaikan apa adanya. Dari situlah kepercayaan pelanggan mulai tumbuh, satu unit demi satu unit.',
  'Seiring waktu, Motorell berkembang dari aktivitas jual beli kecil menjadi sebuah perusahaan yang memiliki standar inspeksi, dokumentasi, serta proses penjualan yang mengutamakan transparansi. Apa yang awalnya dikerjakan sendiri kini berkembang bersama sebuah tim dengan satu visi yang sama: menghadirkan pengalaman membeli motor bekas yang aman, jelas, dan dapat dipercaya.',
  'Hari ini, meski perjalanan masih panjang, semangatnya tetap tidak berubah. Motorell dibangun bukan hanya untuk menjual motor, tetapi untuk membuktikan bahwa usia bukanlah batas untuk membangun bisnis yang profesional. Setiap motor yang kami jual bukan sekadar membawa kendaraan, melainkan tentang membawa kepercayaan yang telah kami bangun sejak langkah pertama di bangku SMA.',
  'Karena bagi kami, reputasi selalu lebih berharga daripada satu kali penjualan.',
]

// ---------- Suara klik "berat" (Web Audio) untuk tombol utama ----------
// Sintesis nada pendek berkarakter "thud"/thunk — tanpa file audio eksternal.
// AudioContext dibuat lazy pada klik pertama (di dalam user gesture) sehingga
// tidak melanggar autoplay policy. Bisa dimatikan lewat localStorage 'm-mute'.
let _audioCtx = null
function playThunk() {
  try {
    if (localStorage.getItem('m-mute') === '1') return
  } catch { /* private mode — anggap tidak mute */ }
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    if (!_audioCtx) _audioCtx = new AC()
    const ctx = _audioCtx
    if (ctx.state === 'suspended') ctx.resume()
    const t = ctx.currentTime
    // dua osilator: badan rendah (thud) + klik atas singkat
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.34, t + 0.006)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
    gain.connect(ctx.destination)
    const body = ctx.createOscillator()
    body.type = 'sine'
    body.frequency.setValueAtTime(180, t)
    body.frequency.exponentialRampToValueAtTime(58, t + 0.14)
    body.connect(gain)
    body.start(t); body.stop(t + 0.17)
    const tick = ctx.createOscillator()
    tick.type = 'triangle'
    tick.frequency.setValueAtTime(320, t)
    const tg = ctx.createGain()
    tg.gain.setValueAtTime(0.14, t)
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.04)
    tick.connect(tg); tg.connect(ctx.destination)
    tick.start(t); tick.stop(t + 0.05)
  } catch { /* audio gagal — abaikan, jangan ganggu klik */ }
}

// ---------- Util ----------
async function compressImage(file, maxW = 1600, quality = 0.82) {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, maxW / bmp.width)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bmp.width * scale))
    canvas.height = Math.max(1, Math.round(bmp.height * scale))
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality))
    return blob || file
  } catch {
    return file
  }
}

// Pesan CS menyebut paket perlindungan yang SEDANG disorot di panel — CS jadi
// tahu paket mana yang dimaksud tanpa harus bertanya balik.
// Tidak ada state baru untuk ini: DetailView sudah memegang `warranty` (turunan
// dari wcode, default avail[0] = Avantgard) dan sudah mengopernya ke onBook →
// requestBooking. Sebelumnya nilai itu berhenti di situ dan tidak pernah
// sampai ke pesannya.
function buildWaMessage(listing, warranty) {
  const url = window.location.origin + window.location.pathname + '#/unit/' + listing.slug
  return 'Halo Motorell! Saya tertarik dengan unit ini:\n' +
    // `title` sudah memuat tahun (kolomnya "brand + model + year"), jadi tahun
    // tidak ditempel lagi di sini — lihat catatan yang sama di unitWaLink.
    '🏍️ ' + listing.title + '\n' +
    '💰 Harga: ' + rupiah(listing.price) + '\n' +
    (warranty ? '🛡️ Dengan paket perlindungan ' + warranty.name + '\n' : '') +
    '📍 Link: ' + url + '\n\n' +
    'Apakah unit ini masih tersedia?'
}

function openWhatsAppCS(listing, toast, warranty) {
  toast('Kamu akan diarahkan ke WhatsApp CS kami untuk melanjutkan pembayaran')
  console.info('[WA] Hubungi CS →', listing.title, '· paket:', warranty ? warranty.name : '(tidak dipilih)')
  const url = 'https://wa.me/' + CS_WHATSAPP_NUMBER + '?text=' +
    encodeURIComponent(buildWaMessage(listing, warranty))
  window.open(url, '_blank', 'noopener,noreferrer')
}

async function invokeCreatePayment(listing_id, warranty_code) {
  const { data, error } = await supabase.functions.invoke('create-dp-payment', {
    body: { listing_id, warranty_code },
  })
  if (error) {
    let msg = 'Gagal membuat pembayaran. Coba lagi.'
    try {
      const body = await error.context.json()
      if (body && body.error) msg = body.error
    } catch { /* pakai pesan default */ }
    throw new Error(msg)
  }
  return data
}

function useCountdown(expiresAt) {
  const [left, setLeft] = useState(() =>
    expiresAt ? Math.max(0, Math.floor((new Date(expiresAt) - Date.now()) / 1000)) : 0)
  useEffect(() => {
    if (!expiresAt) return
    const t = setInterval(() => {
      setLeft(Math.max(0, Math.floor((new Date(expiresAt) - Date.now()) / 1000)))
    }, 1000)
    return () => clearInterval(t)
  }, [expiresAt])
  const mm = String(Math.floor(left / 60)).padStart(2, '0')
  const ss = String(left % 60).padStart(2, '0')
  return { left, text: mm + ':' + ss }
}

const prefersReduced = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Foto yang muncul dengan fade halus begitu selesai dimuat
function FadeImg({ className = '', ...props }) {
  const [ok, setOk] = useState(false)
  return (
    <img {...props} draggable={false}
      className={[className, ok ? 'ok' : ''].filter(Boolean).join(' ')}
      onLoad={() => setOk(true)} />
  )
}

// Foto section fitur: photoUrl selalu berupa string (bukan hasil ?. yang bisa
// falsy), jadi fallback ke Blueprint di sini dicek lewat error load — bukan
// lewat "apakah src ada" seperti pola foto unit biasa.
function FeatureMedia({ src, alt }) {
  const [broken, setBroken] = useState(false)
  if (broken) return <Blueprint />
  return <FadeImg src={src} alt={alt} loading="lazy" onError={() => setBroken(true)} />
}

// ---------- Smart search ----------
// Search bar bukan pajangan: teks bebas diurai jadi filter beneran (harga,
// tahun, grade) lalu sisanya dicocokkan ke brand/model/judul/warna. Jadi
// "xsr 2021 di bawah 30 juta" langsung menyaring, bukan cuma cocok-cocokan
// string ke judul.
function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return v
}

// "20 juta" / "20jt" / "20 jt" → 20_000_000 ; "15000000" → 15_000_000
function parseAmount(numStr, unit) {
  const n = Number(String(numStr).replace(/[.,]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return null
  return unit ? n * 1_000_000 : n
}

function parseQuery(raw) {
  let s = String(raw || '').toLowerCase().trim()
  const f = { text: '', priceMax: null, priceMin: null, year: null, grade: null }
  if (!s) return f

  // batas harga atas: "di bawah 20 juta", "dibawah 20jt", "< 20 juta", "max 20jt"
  s = s.replace(/(?:di\s?bawah|dibawah|kurang dari|max(?:imal)?|<=?)\s*(\d[\d.,]*)\s*(juta|jt)?/g,
    (_, n, u) => { const v = parseAmount(n, u); if (v) f.priceMax = v; return ' ' })
  // batas harga bawah: "di atas 20 juta", "min 20jt", "> 20 juta"
  s = s.replace(/(?:di\s?atas|diatas|lebih dari|min(?:imal)?|>=?)\s*(\d[\d.,]*)\s*(juta|jt)?/g,
    (_, n, u) => { const v = parseAmount(n, u); if (v) f.priceMin = v; return ' ' })
  // grade: "grade a" / "grade-s"
  s = s.replace(/grade[\s-]*([sab])\b/g, (_, g) => { f.grade = g.toUpperCase(); return ' ' })
  // tahun: 4 digit yang masuk akal untuk motor
  s = s.replace(/\b(19[89]\d|20[0-4]\d)\b/g, (_, y) => { f.year = Number(y); return ' ' })
  // "20 juta" telanjang (tanpa kata di bawah/di atas) diperlakukan sebagai plafon —
  // orang mengetik angka biasanya berarti "budget saya segini"
  if (f.priceMax === null && f.priceMin === null) {
    s = s.replace(/(\d[\d.,]*)\s*(juta|jt)\b/g,
      (_, n, u) => { const v = parseAmount(n, u); if (v) f.priceMax = v; return ' ' })
  }

  f.text = s.replace(/\s+/g, ' ').trim()
  return f
}

// Sebuah unit lolos kalau SEMUA filter yang terurai cocok (AND), dan teks
// sisanya muncul di brand/model/judul/warna.
function matchListing(l, f) {
  if (!f) return true
  if (f.grade && String(l.grade || '').toUpperCase() !== f.grade) return false
  if (f.year && Number(l.year) !== f.year) return false
  if (f.priceMax && Number(l.price) > f.priceMax) return false
  if (f.priceMin && Number(l.price) < f.priceMin) return false
  if (f.text) {
    const hay = [l.brand, l.model, l.title, l.color].filter(Boolean).join(' ').toLowerCase()
    // tiap kata harus ada — "xsr hitam" tidak cocok ke XSR merah
    return f.text.split(' ').every((w) => hay.includes(w))
  }
  return true
}

const hasFilter = (f) =>
  Boolean(f && (f.text || f.grade || f.year || f.priceMax || f.priceMin))

// Ringkasan filter aktif untuk ditampilkan sebagai chip di dropdown
function filterChips(f) {
  const out = []
  if (f.grade) out.push('Grade ' + f.grade)
  if (f.year) out.push('Tahun ' + f.year)
  if (f.priceMax) out.push('≤ ' + rupiah(f.priceMax))
  if (f.priceMin) out.push('≥ ' + rupiah(f.priceMin))
  return out
}

// ---------- Panel filter & urutan ----------
// Panel ini HIDUP BERDAMPINGAN dengan smart search di navbar: search bar
// mengurai teks bebas jadi filter (parseQuery), panel memberi kontrol eksplisit.
// Keduanya di-AND — unit harus lolos dua-duanya. Jadi mengetik "di bawah 30
// juta" lalu mencentang Honda menyaring keduanya, bukan saling menimpa.
//
// "Kondisi" di UI = kolom `grade` di DB. Tidak ada kolom kondisi terpisah;
// grade S/A/B sudah mewakili istimewa/bagus/standar (lihat GRADE_DEF).
const GRADE_COND_LABEL = { S: 'Istimewa', A: 'Bagus', B: 'Standar' }

// Urutan: "Terlaris" TIDAK ada di sini — tabel listings tidak menyimpan
// views/interest sama sekali, jadi opsi itu cuma bisa jadi urutan bohongan.
// Tambahkan kalau kolom penghitung tayangan sudah ada.
const SORT_OPTIONS = [
  { code: 'newest', label: 'Terbaru' },
  { code: 'price_asc', label: 'Harga: Rendah ke Tinggi' },
  { code: 'price_desc', label: 'Harga: Tinggi ke Rendah' },
]

// showTitip: true (default) = tampilkan unit titip jual juga; false = HANYA unit
// resmi Motorell. Disimpan di panel supaya ikut URL & tombol reset.
const EMPTY_PANEL = { priceMin: null, priceMax: null, brands: [], year: null, grades: [], showTitip: true }

const panelActive = (p) =>
  Boolean(p && (p.priceMin || p.priceMax || p.brands.length || p.year || p.grades.length ||
    p.showTitip === false))

function matchPanel(l, p) {
  if (!p) return true
  if (p.showTitip === false && isTitip(l)) return false
  if (p.priceMin && Number(l.price) < p.priceMin) return false
  if (p.priceMax && Number(l.price) > p.priceMax) return false
  if (p.year && Number(l.year) !== Number(p.year)) return false
  if (p.brands.length && !p.brands.includes(String(l.brand || '').trim())) return false
  if (p.grades.length && !p.grades.includes(String(l.grade || '').toUpperCase())) return false
  return true
}

// sort() memutasi array — listings berasal dari state, jadi selalu salin dulu.
//
// PRIORITAS SUMBER (wajib): unit resmi Motorell (source 'official') SELALU di
// atas unit titip jual, di SEMUA mode sort. Caranya: rank sumber jadi kunci
// urut PRIMER; pilihan sort user (harga/terbaru) hanya berlaku SEBAGAI kunci
// SEKUNDER di dalam masing-masing grup. Jadi "harga termurah" pun tidak pernah
// menyelipkan unit titip jual di atas unit resmi.
function sortListings(arr, sort) {
  const rank = (l) => (isTitip(l) ? 1 : 0)
  const within = (a, b) => {
    if (sort === 'price_asc') return Number(a.price) - Number(b.price)
    if (sort === 'price_desc') return Number(b.price) - Number(a.price)
    // 'newest': published_at bisa null (unit lama), jatuh balik ke created_at.
    return new Date(b.published_at || b.created_at || 0) - new Date(a.published_at || a.created_at || 0)
  }
  return [...arr].sort((a, b) => (rank(a) - rank(b)) || within(a, b))
}

// Rentang harga & daftar merek diturunkan DARI DATA, bukan dikunci konstanta —
// showroom ganti stok tiap minggu, angka hardcoded akan basi diam-diam.
function facetsOf(listings) {
  const prices = listings.map((l) => Number(l.price)).filter((n) => Number.isFinite(n) && n > 0)
  const years = [...new Set(listings.map((l) => Number(l.year)).filter(Boolean))].sort((a, b) => b - a)
  const brands = [...new Set(listings.map((l) => String(l.brand || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
  const grades = [...new Set(listings.map((l) => String(l.grade || '').toUpperCase()).filter(Boolean))]
    .sort()
  // Slider butuh rentang yang tidak nol-lebar walau etalase cuma berisi 1 unit.
  const lo = prices.length ? Math.min(...prices) : 0
  const hi = prices.length ? Math.max(...prices) : 100_000_000
  return { brands, years, grades, priceLo: lo, priceHi: hi > lo ? hi : lo + 1_000_000 }
}

// ---------- Badge status unit ----------
// Etalase memuat status 'published' + 'booked' (lihat loadListings). Unit
// 'sold' sengaja TIDAK diambil — jadi badge "terjual" tidak dibuat di sini:
// kartunya tidak akan pernah ada. Kalau nanti sold ikut ditampilkan, tambahkan
// cabangnya di sini dan longgarkan query-nya bersamaan.
const NEW_UNIT_DAYS = 3
function statusBadge(l) {
  if (l.status === 'booked') return { label: '🔥 Hampir Terjual', cls: 'st-booked' }
  const created = l.created_at ? new Date(l.created_at) : null
  if (created && !Number.isNaN(created.getTime())) {
    const days = (Date.now() - created.getTime()) / 86_400_000
    if (days < NEW_UNIT_DAYS) return { label: 'Baru!', cls: 'st-new' }
  }
  return null
}

// ---------- WhatsApp cepat per unit ----------
// Nomor diambil dari CS_WHATSAPP_NUMBER yang sudah dipakai flow booking —
// satu sumber kebenaran, jangan tulis ulang nomornya di tempat lain.
function unitWaLink(l) {
  const url = window.location.origin + window.location.pathname + '#/unit/' + l.slug
  // `title` SUDAH memuat tahun — kolomnya dibentuk "brand + model + year" di
  // form admin. Menempelkan l.year lagi menghasilkan "XSR 155 2020 2020".
  const msg = 'Halo Motorell! Saya tertarik dengan unit ini:\n' +
    '🏍️ ' + l.title + '\n' +
    '💰 Harga: ' + rupiah(l.price) + '\n' +
    '📍 Link: ' + url + '\n\n' +
    'Apakah unit ini masih tersedia?'
  return 'https://wa.me/' + CS_WHATSAPP_NUMBER + '?text=' + encodeURIComponent(msg)
}

// ---------- Titip Jual (marketplace unit dari masyarakat) ----------
// Unit titip jual disimpan di tabel terpisah (titip_jual_units) dengan skema
// berbahasa Indonesia. Di frontend ia DINORMALKAN ke bentuk yang sama dengan
// unit resmi supaya Card/DetailView/filter bisa memakainya tanpa cabang di mana-
// mana — pembedanya cukup field `source`.
const KONDISI_OPTS = ['Istimewa', 'Bagus', 'Standar']
// "Kondisi" titip jual dipetakan ke huruf grade HANYA untuk keperluan filter
// "Kondisi" bersama; kartunya TIDAK menampilkan badge grade emas/perak (itu
// menandakan kurasi resmi Motorell), melainkan badge "TITIP JUAL".
const KONDISI_TO_GRADE = { Istimewa: 'S', Bagus: 'A', Standar: 'B' }

// 08xxxx / +62xxxx / 62xxxx → 62xxxx (format wa.me). Non-digit dibuang.
function waPhone(raw) {
  let d = String(raw || '').replace(/[^\d]/g, '')
  if (d.startsWith('0')) d = '62' + d.slice(1)
  else if (d.startsWith('62')) { /* sudah benar */ }
  else if (d.startsWith('8')) d = '62' + d
  return d
}

// Baris titip_jual_units → bentuk "unit" yang dikenal Card/DetailView.
function normalizeTitip(row) {
  const title = [row.merek, row.model, row.tahun].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  return {
    ...row,
    source: 'titip_jual',
    // slug sintetis stabil untuk routing #/unit/<slug>; deep-link mem-parse 'tj-'.
    slug: 'tj-' + String(row.id).slice(0, 8),
    title,
    brand: row.merek, model: row.model, year: row.tahun,
    mileage_km: row.odometer || 0, color: row.warna || null,
    price: Number(row.harga_diinginkan) || 0,
    grade: KONDISI_TO_GRADE[row.kondisi] || null,
    description: row.deskripsi || null,
    photos: Array.isArray(row.photos) ? row.photos : [],
    // published_at dipakai sort 'newest'; pakai waktu approve bila ada.
    published_at: row.reviewed_at || row.created_at,
  }
}

// Kontak pembeli titip jual mengarah LANGSUNG ke nomor penjual (keputusan
// bisnis), bukan CS Motorell.
function sellerWaLink(l) {
  const msg = 'Halo, saya lihat motor Anda di Motorell Market:\n' +
    '🏍️ ' + l.title + '\n' +
    '💰 ' + rupiah(l.price) + '\n\n' +
    'Apakah masih tersedia?'
  return 'https://wa.me/' + waPhone(l.seller_phone) + '?text=' + encodeURIComponent(msg)
}

const isTitip = (l) => l && l.source === 'titip_jual'

// ---------- Unit terakhir dilihat (localStorage) ----------
const RECENT_KEY = 'recently_viewed'
const RECENT_MAX = 6

function readRecent() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string').slice(0, RECENT_MAX) : []
  } catch {
    // Isi rusak / mode privat — anggap belum ada riwayat, jangan lempar error.
    return []
  }
}

function pushRecent(id) {
  if (!id) return []
  try {
    // Yang baru dilihat naik ke depan; duplikat dibuang supaya 6 slotnya berisi
    // 6 unit BERBEDA, bukan unit yang sama enam kali.
    const next = [String(id), ...readRecent().filter((x) => x !== String(id))].slice(0, RECENT_MAX)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
    console.info('[RECENT] Riwayat unit diperbarui →', next.length + ' unit')
    return next
  } catch {
    return readRecent()
  }
}

// Potong judul jadi bagian cocok / tidak cocok supaya bisa di-<mark>.
// Perhatikan: split() dengan grup tangkap mempertahankan delimiter-nya, jadi
// potongan yang cocok bisa dikenali cukup dengan membandingkan lowercase-nya
// (jangan pakai re.test — regex /g menyimpan lastIndex dan hasilnya selang-seling).
function highlight(text, words) {
  const src = String(text || '')
  const ws = (words || []).filter(Boolean)
  if (!ws.length) return [{ t: src, on: false }]
  const re = new RegExp('(' + ws.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'ig')
  const lower = new Set(ws.map((w) => w.toLowerCase()))
  return src.split(re).filter(Boolean).map((t) => ({ t, on: lower.has(t.toLowerCase()) }))
}

// ---------- Gaya (tema terang) ----------
const CSS = `
:root{
  --bg:#ffffff; --bg-2:#f3f3f1; --bg-3:#ececea;
  --panel:#ffffff; --panel-2:#f6f6f4;
  --line:#e4e4e1; --line-2:#d4d4d0;
  --ink:#111114; --muted:#5c6067; --dim:#9a9ea6;
  --accent:#1a2f5e; --accent-ink:#0f1d3d; --ok:#1f9d55; --warn:#b8791b;
  --radius:12px;
  --font:'Archivo',system-ui,-apple-system,sans-serif;
  --mono:'IBM Plex Mono',monospace;
  --shadow:0 1px 2px rgba(17,17,20,.04),0 8px 30px rgba(17,17,20,.06);
}
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth;background:var(--bg)}
body{background:var(--bg);color:var(--ink);font-family:var(--font);
  -webkit-font-smoothing:antialiased;overflow-x:hidden;line-height:1.5}
img{display:block;max-width:100%}
a{color:inherit;text-decoration:none}
button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit}
input,select,textarea{font-family:inherit;color:var(--ink)}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:3px}
::selection{background:var(--ink);color:#fff}

/* ---------- Tugas 1: tipografi kapital untuk heading/label/aksi ----------
   Judul (h1–h4), nama tombol, badge, tab, dan nama paket ditulis KAPITAL
   lewat CSS (bukan mengubah string JSX) supaya konsisten & gampang dirawat.
   Teks isi/paragraf (deskripsi, fine print) sengaja TIDAK disentuh. */
h1,h2,h3,h4,.btn,.badge,.card-go,.w-body b,
.dtabs button,.a-tabs button,.switcher button{text-transform:uppercase}

.container{width:100%;max-width:1260px;margin-inline:auto;
  padding-inline:clamp(20px,5vw,64px)}
.mono{font-family:var(--mono)}
.kicker{font-family:var(--mono);font-size:11.5px;letter-spacing:.18em;
  text-transform:uppercase;color:var(--muted);display:flex;align-items:center;gap:11px}
.kicker::before{content:"";width:24px;height:2px;background:var(--accent)}
.hero .kicker::before{display:none}

/* ---------- nav ---------- */
.nav{position:fixed;inset:0 0 auto 0;z-index:60;
  background:rgba(255,255,255,0);border-bottom:1px solid transparent;
  transition:background .3s,border-color .3s,backdrop-filter .3s}
.nav.scrolled{background:rgba(255,255,255,.86);backdrop-filter:blur(16px);
  border-color:var(--line)}
.nav-in{position:relative;display:flex;align-items:center;justify-content:space-between;
  padding-block:calc(16px + env(safe-area-inset-top)) 16px}
.logo{font-weight:800;font-size:19px;letter-spacing:.01em;display:flex;
  align-items:center;gap:8px}
.logo i{font-style:normal;color:var(--accent);font-size:15px}
.logo small{font-family:var(--mono);font-weight:500;font-size:10px;
  letter-spacing:.22em;color:var(--dim)}
.nav-actions{display:flex;align-items:center;gap:10px}
.nav-links{display:flex;align-items:center;gap:10px}
.nav-loc{display:inline-flex;align-items:center;gap:6px}
.nav-loc-ic{width:15px;height:15px;color:var(--accent)}
/* Hamburger hanya tampil di mobile (lihat media query) — di desktop tombol
   aksi inline. */
.nav-burger{display:none;width:44px;height:44px;border-radius:999px;flex:none;
  border:1px solid var(--line-2);background:var(--panel);align-items:center;justify-content:center}
.nav-burger:active{transform:scale(.94)}
.nav-burger svg{width:21px;height:21px;color:var(--ink)}
.nav-menu-backdrop{display:none}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;
  font-weight:600;font-size:14.5px;padding:12px 24px;border-radius:999px;
  transition:transform .15s,background .18s,color .18s,border-color .18s,opacity .18s}
.btn:active{transform:scale(.975)}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn-accent{background:var(--accent);color:#fff}
.btn-accent:hover:not(:disabled){background:var(--accent-ink)}
.btn-dark{background:var(--ink);color:#fff}
.btn-dark:hover:not(:disabled){background:#2a2a30}
.btn-ghost{border:1.5px solid var(--line-2);color:var(--ink)}
.btn-ghost:hover:not(:disabled){border-color:var(--ink)}
.btn-quiet{color:var(--muted);font-weight:500;padding:10px 14px}
.btn-quiet:hover{color:var(--ink)}
.btn-sm{padding:9px 17px;font-size:13px}
.btn-full{width:100%}

/* ---------- hero (full-bleed, 3D as ambient background) ----------
   Basis mobile dulu (tinggi otomatis, padding atas secukupnya untuk lolos
   dari nav fixed); baru di layar besar hero dikunci ke tinggi viewport dan
   padding atas ditambah — lihat @media(min-width:1021px) di bagian bawah. */
.hero{position:relative;min-height:0;display:flex;align-items:center;
  padding:120px 0 52px;border-bottom:1px solid var(--line);overflow:hidden;
  background:
    radial-gradient(1200px 640px at 80% 34%, #fafaf9, transparent 62%),
    linear-gradient(180deg,#ffffff 0%,#fbfbfa 100%)}
.hero-grid-lines{position:absolute;inset:0;z-index:0;pointer-events:none;opacity:.55;
  background-image:
    linear-gradient(90deg, var(--line) 1px, transparent 1px),
    linear-gradient(0deg, var(--line) 1px, transparent 1px);
  background-size:64px 64px;
  mask-image:radial-gradient(80% 70% at 68% 40%, #000 0%, transparent 72%);
  -webkit-mask-image:radial-gradient(80% 70% at 68% 40%, #000 0%, transparent 72%)}
.hero-inner{position:relative;z-index:3;width:100%}
/* hero-main: kolom teks + kolom model 3D. Mobile bertumpuk (teks lalu model);
   di ≥1021px berdampingan (lihat media query di bawah). */
.hero-main{display:grid;grid-template-columns:1fr;gap:clamp(28px,5vw,52px);align-items:center}
.hero-copy{max-width:100%}

/* ---------- model 3D hero (tanpa kotak: hanya motornya) ---------- */
/* Slot pembungkus untuk animasi intro (fade-in). Transparan ke layout: ia
   sekadar meneruskan tinggi kolom grid ke .hero-embed di dalamnya. */
.hero-model-slot{min-width:0;display:flex;flex-direction:column}
.hero-model-slot > .hero-embed{flex:1}
.hero-embed{min-width:0;display:flex;flex-direction:column}
/* Bingkai = kotak ukuran tak terlihat (tanpa border/latar/bayangan/sudut) —
   yang tampak hanya modelnya. Di mobile aspect-ratio menahan tingginya; di
   desktop ia MEMANJANG mengisi tinggi kolom teks (lihat align-items:stretch di
   media query) supaya motor punya ruang vertikal sebesar section teks. */
.hero-embed-frame{position:relative;width:100%;aspect-ratio:3/2;flex:1;min-height:0}
/* <model-viewer> ditarget lewat nama tag (menghindari keruwetan class pada
   custom element di React). Latar transparan; cursor:grab menandakan bisa
   diputar (interaktif). --poster-color kosong: matikan poster default supaya
   loader branded kita yang terlihat. */
.hero-embed-frame model-viewer{position:absolute;inset:0;width:100%;height:100%;
  background-color:transparent;--poster-color:transparent;cursor:grab;
  transition:opacity .5s ease}
.hero-embed-frame model-viewer:active{cursor:grabbing}
.hero-embed-fallback{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero-embed-ph{position:absolute;inset:0;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:13px;font-family:var(--mono);
  font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.hero-embed-spinner{width:30px;height:30px;border-radius:50%;
  border:3px solid var(--line-2);border-top-color:var(--accent);
  animation:hero-spin .8s linear infinite}
@keyframes hero-spin{to{transform:rotate(360deg)}}
/* Kredit lisensi model 3D — dipindah dari bawah hero ke footer (tetap WAJIB
   ada demi lisensi Creative Commons; hanya lokasinya yang lebih tenang). */
.foot-credit{margin-top:14px;font-family:var(--mono);font-size:10.5px;
  letter-spacing:.04em;color:var(--dim);line-height:1.6}
.foot-credit a{color:var(--muted);text-decoration:underline;text-underline-offset:2px}
.foot-credit a:hover{color:var(--accent)}
/* Ukuran diturunkan dari clamp(46px,6.4vw,86px): di ukuran lama "anti was-was."
   pecah di tanda hubung jadi "ANTI WAS-" / "WAS." — baris yatim yang jelek. */
.hero-copy h1{font-size:clamp(34px,5.2vw,64px);font-weight:750;line-height:1.06;
  letter-spacing:-.02em;margin:22px 0 22px}
/* nowrap di SEMUA ukuran: "anti was-was." tidak boleh pecah di tanda hubung
   (yang menyisakan baris yatim "WAS."). Ukuran minimum clamp sengaja 34px
   supaya frasa ini tetap muat utuh bahkan di layar 320px. nowrap dipasang di
   <em>, bukan di h1 — h1 memuat dua kalimat dan akan meluber kalau dikunci. */
.hero-copy h1 em{font-style:normal;color:var(--accent);white-space:nowrap}
.hero-copy p{font-size:16.5px;line-height:1.62;color:var(--muted);max-width:440px;margin-bottom:26px}
.hero-copy .from{font-family:var(--mono);font-size:13px;color:var(--ink);margin-bottom:28px}
.hero-copy .from b{color:var(--accent)}
.hero-cta{display:flex;gap:12px;flex-wrap:wrap}
/* Tombol sekunder "Standar kurasi" DI HERO diberi latar putih solid — di atas
   latar hero yang ramai, versi transparannya kurang kontras. Di-scope ke
   .hero-cta saja: .btn-ghost di tempat lain (modal, admin) berdiri di atas
   panel putih sehingga transparan sudah terbaca putih; mengubahnya global
   malah bisa janggal di panel abu-abu. Border & teks gelap tetap dari
   .btn-ghost, jadi ia tetap terbaca sebagai tombol outline sekunder. */
.hero-cta .btn-ghost{background:#fff}
.hero-cta .btn-ghost:hover:not(:disabled){background:#fff}
/* strip spesifikasi tipis ala lembar spek — label mono kecil di atas,
   angka besar di bawah, dipisah whitespace (bukan kotak-kotak card) */
/* Mobile: 2×2 (bukan 4 baris menumpuk yang boros ruang & terasa panjang).
   Di ≥768px kembali sebaris berempat (lihat media query di bawah). */
.spec-rail{display:grid;grid-template-columns:repeat(2,1fr);gap:20px 18px;
  margin-top:28px;padding-top:22px;border-top:1px solid var(--line-2);max-width:100%}
.spec-rail span{display:flex;flex-direction:column;gap:7px;font-family:var(--mono);
  font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.spec-rail b{color:var(--ink);font-size:clamp(19px,5vw,29px);font-weight:750;
  letter-spacing:-.02em;line-height:1;font-family:var(--font);white-space:nowrap}

/* ---------- section ---------- */
/* overflow-x:clip — menahan elemen reveal yang meluncur dari sisi (translateX)
   agar tidak memicu horizontal scroll di HP, tanpa membuat scroll-container
   vertikal (overflow-y tetap visible) */
/* Padding vertikal section: di mobile dulu 76px atas+bawah (152px whitespace di
   antara TIAP section, di halaman yang sangat panjang) — terasa lega berlebihan.
   Lantai clamp diturunkan ke 52px supaya mobile lebih ringkas & minimalis;
   tablet/desktop (11vw) tak berubah. */
.section{padding:clamp(52px,11vw,132px) 0;overflow-x:clip}
.section.grey{background:var(--bg-2);border-block:1px solid var(--line)}
.sec-head{display:flex;flex-direction:column;justify-content:space-between;align-items:flex-start;gap:26px;
  margin-bottom:clamp(30px,4vw,46px)}
.sec-head h2{font-size:clamp(30px,4vw,50px);font-weight:740;letter-spacing:-.025em;
  line-height:1.02;margin-top:13px}
.sec-head .aside{max-width:330px;font-size:14.5px;color:var(--muted);line-height:1.55}

/* ---------- grid unit ---------- */
.grid{display:grid;grid-template-columns:1fr;gap:18px}
.card-wrap{opacity:0;transform:translateY(24px) scale(.96);
  transition:opacity .55s ease,transform .6s cubic-bezier(.2,.7,.25,1)}
.card-wrap.shown{opacity:1;transform:none}
.card{position:relative;width:100%;height:100%;background:var(--panel);border:1px solid var(--line);
  border-radius:var(--radius);overflow:hidden;display:flex;flex-direction:column;
  text-align:left;
  transform:perspective(950px) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg))
    translateY(var(--lift,0px));
  transition:transform .16s ease-out,box-shadow .25s,border-color .25s}
.card:hover{--lift:-6px;box-shadow:var(--shadow);border-color:var(--line-2)}
.card-media{aspect-ratio:1/1;position:relative;overflow:hidden;
  background:radial-gradient(120% 120% at 50% 25%, #fbfbfa, var(--bg-3) 82%)}
.card-media img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;
  opacity:0;transition:opacity .45s ease,transform .6s cubic-bezier(.2,.6,.25,1)}
.card-media img.ok{opacity:1}
.card:hover .card-media img{transform:scale(1.055)}
/* Tugas 12b: kilau menyapu HANYA saat hover masuk. Saat kursor menjauh,
   transisi dimatikan (base transition:none) supaya elemen kilau langsung
   reset ke kiri tanpa animasi mundur yang terlihat. */
.card-media::after{content:"";position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(105deg,transparent 42%,rgba(255,255,255,.5) 50%,transparent 58%);
  transform:translateX(-130%);transition:none}
.card:hover .card-media::after{transform:translateX(130%);transition:transform .65s ease}
.card-media .blp{position:absolute;inset:11% 8%;opacity:1}
/* Badge grade DIAM saat kartu di-hover. Dulu ada aturan .card:hover .badge yang
   memberinya translateY(-48px) — itulah "badge ikut bergerak" yang terlihat.
   Ia TIDAK pernah ikut ter-scale bersama foto: scale-nya menempel di elemen
   img saja, dan badge ini saudaranya, bukan anaknya. Angkatan itu semata untuk
   memberi ruang bagi panel teks kurasi yang kini sudah dihapus dari kartu, jadi
   alasannya ikut hilang. Sekarang perilakunya sama dengan .card-wa: diam.
   overflow:hidden tetap perlu — kilau ::after pada badge S/A dipotong olehnya. */
.badge{position:absolute;bottom:13px;left:13px;z-index:2;font-family:var(--mono);font-size:10.5px;
  font-weight:600;letter-spacing:.08em;padding:6px 11px;border-radius:999px;
  background:rgba(255,255,255,.92);backdrop-filter:blur(6px);border:1px solid var(--line-2);
  color:var(--ink);overflow:hidden}
/* varian warna per grade: S emas, A diamond, B silver — teks gelap agar kontras */
.badge.g-s{background:linear-gradient(135deg,#ffe975 0%,#ffd700 38%,#b8860b 100%);
  border-color:rgba(184,134,11,.55);color:#231a00;
  box-shadow:0 2px 9px rgba(184,134,11,.35),inset 0 1px 1px rgba(255,255,255,.7)}
.badge.g-a{background:linear-gradient(135deg,#ffffff 0%,#e8f4ff 42%,#b0e0e6 100%);
  border-color:rgba(116,170,196,.5);color:#0e2a38;
  box-shadow:0 2px 9px rgba(116,170,196,.32),inset 0 1px 1px rgba(255,255,255,.85)}
.badge.g-b{background:linear-gradient(135deg,#e2e2e2 0%,#c0c0c0 46%,#a8a8a8 100%);
  border-color:rgba(118,118,122,.45);color:#232327;
  box-shadow:0 2px 7px rgba(90,90,94,.3),inset 0 1px 1px rgba(255,255,255,.6)}
/* Badge "TITIP JUAL" — netral & datar (bukan metalik seperti grade), supaya
   jelas beda dari unit kurasi resmi Motorell. */
.badge.badge-titip{background:rgba(20,22,28,.9);backdrop-filter:blur(6px);
  border-color:rgba(255,255,255,.18);color:#fff;letter-spacing:.1em}
/* kilau lembut yang menyapu pelan di badge S (shine) dan A (shimmer) */
.badge.g-s::after,.badge.g-a::after{content:"";position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(115deg,transparent 32%,rgba(255,255,255,.6) 47%,transparent 62%);
  transform:translateX(-130%);animation:badge-shine 3.6s ease-in-out infinite}
@keyframes badge-shine{0%{transform:translateX(-130%)}22%{transform:translateX(130%)}100%{transform:translateX(130%)}}
.card-body{padding:19px 19px 17px;display:flex;flex-direction:column;gap:6px}
.card-body h3{font-size:17.5px;font-weight:680;letter-spacing:-.01em}
.card-meta{font-family:var(--mono);font-size:11.5px;color:var(--dim);letter-spacing:.04em}
.card-price{font-size:18px;font-weight:750;margin-top:9px;letter-spacing:-.01em}
.card-go{position:relative;border-top:1px solid var(--line);padding:14px 19px;font-size:13.5px;
  font-weight:600;color:var(--muted);display:flex;justify-content:space-between;
  transition:color .2s}
.card-go::before{content:"";position:absolute;top:-1px;left:0;height:2px;width:0;
  background:var(--accent);transition:width .38s ease}
.card-go .aro{transition:transform .22s ease}
.card:hover .card-go{color:var(--accent)}
.card:hover .card-go::before{width:100%}
.card:hover .card-go .aro{transform:translateX(5px)}
.empty{border:1px dashed var(--line-2);border-radius:var(--radius);padding:60px 24px;
  text-align:center;color:var(--muted);font-size:15px;grid-column:1/-1;background:var(--panel)}

/* ---------- kartu: area klik, badge status, tombol WhatsApp ----------
   .card dulunya <button> yang membungkus SELURUH kartu. Tombol WhatsApp tidak
   boleh bersarang di dalamnya (nested <button>/<a> = HTML tidak valid dan
   browser menolak me-render-nya dengan benar), jadi kartu sekarang <div> dengan
   .card-hit sebagai lapisan klik yang merentang penuh. Semua lapisan dekoratif
   dimatikan pointer-events-nya supaya tidak mencuri klik dari .card-hit. */
.card-hit{position:absolute;inset:0;z-index:3;border-radius:var(--radius)}
.card-hit:focus-visible{outline-offset:-3px}
.badge,.card-status{pointer-events:none}
.card-status{position:absolute;top:13px;left:13px;z-index:4;font-family:var(--mono);
  font-size:10px;font-weight:700;letter-spacing:.07em;padding:6px 10px;border-radius:999px;
  text-transform:uppercase;color:#fff;box-shadow:0 2px 8px rgba(17,17,20,.22)}
.card-status.st-new{background:#c62828}
.card-status.st-booked{background:#e07b1c}
/* Tombol WA melayang di atas .card-hit — z-index harus lebih tinggi, kalau
   tidak lapisan klik kartu menelan klik-nya dan malah membuka halaman unit.
   Ia diam di tempat saat kartu di-hover: sasaran klik yang bergeser persis
   ketika kursor mendekat akan kabur dari bawah jari/kursor penggunanya.
   Badge grade kini mengikuti aturan yang sama. */
.card-wa{position:absolute;right:12px;bottom:12px;z-index:5;display:inline-flex;
  align-items:center;gap:7px;padding:9px 14px;border-radius:999px;
  background:#25D366;color:#fff;font-size:12.5px;font-weight:700;letter-spacing:.01em;
  box-shadow:0 3px 12px rgba(37,211,102,.42);
  transition:transform .18s ease,box-shadow .18s ease}
.card-wa:hover{transform:scale(1.08);box-shadow:0 5px 18px rgba(37,211,102,.55)}
.card-wa:active{transform:scale(.97)}
.card-wa svg{width:15px;height:15px;fill:currentColor;flex:none}

/* ---------- kepala etalase: hitungan + urutan + tombol filter ---------- */
.et-layout{display:grid;grid-template-columns:1fr;gap:26px;align-items:start}
/* Tanpa sidebar (memuat/gagal/kosong), grid memakai lebar penuh — kalau tidak,
   kolom 230px milik sidebar tetap dipesan dan menyisakan lubang kosong.
   Specificity 0,0,2,0 sengaja mengalahkan .et-layout di @media di bawah. */
.et-layout.bare{grid-template-columns:1fr}
/* Mobile-first: sidebar mati, filter dijangkau lewat tombol → drawer. */
.et-side{display:none}
.et-bar{display:flex;align-items:center;justify-content:space-between;gap:14px;
  flex-wrap:wrap;margin-bottom:18px}
.et-count{font-family:var(--mono);font-size:12px;letter-spacing:.06em;color:var(--muted)}
.et-count b{color:var(--ink);font-weight:700}
.et-tools{display:flex;align-items:center;gap:10px}
.et-sort{appearance:none;border:1px solid var(--line-2);background:var(--panel);
  border-radius:999px;padding:10px 34px 10px 15px;font-size:13px;font-weight:600;
  cursor:pointer;background-image:linear-gradient(45deg,transparent 50%,var(--muted) 50%),
  linear-gradient(135deg,var(--muted) 50%,transparent 50%);
  background-position:calc(100% - 17px) 50%,calc(100% - 12px) 50%;
  background-size:5px 5px,5px 5px;background-repeat:no-repeat}
.et-filter-btn{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line-2);
  background:var(--panel);border-radius:999px;padding:10px 16px;font-size:13px;font-weight:600}
.et-filter-btn .n{background:var(--accent);color:#fff;font-family:var(--mono);font-size:10px;
  min-width:17px;height:17px;border-radius:999px;display:grid;place-items:center;padding:0 4px}
/* bar filter+sort di atas kedua galeri (bukan lagi sidebar) */
.et-bar-top{justify-content:flex-start;margin-bottom:24px}

/* ---------- galeri carousel (Motorell & Titip Jual, IDENTIK) ---------- */
.gal{margin-bottom:clamp(30px,4vw,44px)}
.gal-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:15px}
.gal-title{font-size:clamp(19px,2.6vw,26px);font-weight:730;letter-spacing:-.02em}
.gal-sub{font-family:var(--mono);font-size:11px;letter-spacing:.05em;color:var(--muted);margin-top:5px}
.gal-arrows{display:none;gap:8px;flex:none}
.gal-arrows button{width:38px;height:38px;border-radius:50%;border:1px solid var(--line-2);
  background:var(--panel);font-size:16px;color:var(--ink);display:grid;place-items:center;
  transition:border-color .2s,opacity .2s}
.gal-arrows button:hover:not(:disabled){border-color:var(--ink)}
.gal-arrows button:disabled{opacity:.3;cursor:not-allowed}
/* fade tepi-kanan = penanda "masih ada unit lagi, geser" */
.gal-wrap{position:relative}
.gal-wrap::after{content:"";position:absolute;top:0;right:0;bottom:14px;width:54px;pointer-events:none;
  background:linear-gradient(90deg,transparent,var(--bg));opacity:0;transition:opacity .25s;z-index:2}
.gal-wrap.more::after{opacity:1}
.gal-rail{display:flex;gap:16px;overflow-x:auto;scroll-snap-type:x mandatory;
  padding-bottom:14px;scrollbar-width:thin}
.gal-rail::-webkit-scrollbar{height:6px}
.gal-rail::-webkit-scrollbar-thumb{background:var(--line-2);border-radius:9px}
/* Lebar kartu: mobile ~70vw (kecil, terlihat sekilas kartu berikutnya — Tugas 3);
   ≥768 empat sekaligus; ≥1100 ENAM sekaligus (maks 6 — Tugas 2). Semua unit
   tetap dirender, sisanya lewat geser. */
.gal-item{flex:0 0 70vw;max-width:320px;scroll-snap-align:start}
.gal-item > .card-wrap{width:100%}
@media(min-width:520px){ .gal-item{flex-basis:46vw;max-width:300px} }
@media(min-width:768px){
  .gal-item{flex-basis:calc((100% - 3*16px)/4);max-width:none}
  .gal-arrows{display:flex}
}
@media(min-width:1100px){ .gal-item{flex-basis:calc((100% - 5*16px)/6)} }
/* Kartu di carousel lebih ringkas agar 6 muat rapi tanpa terasa sesak. */
.gal-item .card-body{padding:14px 14px 12px;gap:4px}
.gal-item .card-body h3{font-size:14.5px;line-height:1.25}
.gal-item .card-meta{font-size:10.5px}
.gal-item .card-price{font-size:15.5px;margin-top:6px}
.gal-item .card-go{padding:11px 14px;font-size:12px}
.gal-item .card-wa{font-size:11px;padding:7px 10px;gap:5px;right:10px;bottom:10px}
.gal-item .card-wa svg{width:13px;height:13px}
.gal-item .badge{font-size:9.5px;padding:5px 8px;bottom:10px;left:10px}
.gal-item .card-status{font-size:9px;padding:4px 8px;top:10px;left:10px}
/* Di ≥768px kartu jadi sempit (4/6 sekaligus): tombol chat jadi IKON saja
   supaya tak bertabrakan dengan badge grade. Di mobile (kartu ~70vw lebar)
   teks penuh "Chat Sekarang" tetap ditampilkan. CTA chat lengkap juga ada di
   halaman detail. */
@media(min-width:768px){
  .gal-item .card-wa{padding:9px;gap:0}
  .gal-item .card-wa span{display:none}
  .gal-item .card-wa svg{width:16px;height:16px}
}

/* CTA di antara kedua galeri */
.gal-cta{display:flex;flex-direction:column;gap:15px;align-items:flex-start;
  border:1px solid var(--line);border-radius:16px;padding:clamp(22px,4vw,34px);
  background:var(--panel-2);margin:clamp(6px,1.5vw,16px) 0 clamp(30px,4vw,44px)}
.gal-cta h3{font-size:clamp(20px,3vw,30px);font-weight:730;letter-spacing:-.02em;margin-bottom:7px}
.gal-cta p{color:var(--muted);font-size:14.5px;line-height:1.55;max-width:520px}
@media(min-width:640px){
  .gal-cta{flex-direction:row;align-items:center;justify-content:space-between;gap:28px}
  .gal-cta .btn{flex:none}
}

/* ---------- panel filter ---------- */
.fp{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);
  padding:20px 18px;display:flex;flex-direction:column;gap:22px}
.fp-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.fp-head h4{font-size:12px;font-family:var(--mono);letter-spacing:.13em;color:var(--muted)}
.fp-reset{font-size:12px;font-weight:600;color:var(--accent);text-decoration:underline;
  text-underline-offset:3px}
.fp-reset:disabled{color:var(--dim);text-decoration:none;cursor:not-allowed}
.fp-grp{display:flex;flex-direction:column;gap:11px}
.fp-grp > label{font-size:12px;font-family:var(--mono);letter-spacing:.1em;color:var(--muted);
  text-transform:uppercase}
.fp-opts{display:flex;flex-direction:column;gap:9px;max-height:190px;overflow-y:auto}
.fp-opt{display:flex;align-items:center;gap:9px;font-size:14px;cursor:pointer;color:#33363c}
.fp-opt input{width:16px;height:16px;accent-color:var(--accent);cursor:pointer;flex:none}
.fp-sel{width:100%;border:1px solid var(--line-2);background:var(--panel);border-radius:8px;
  padding:9px 11px;font-size:13.5px;cursor:pointer}
.fp-price-val{font-family:var(--mono);font-size:12px;color:var(--ink);font-weight:600}
/* Dual slider: dua <input type=range> ditumpuk di jalur yang sama. Track-nya
   dimatikan (pointer-events:none) supaya thumb kedua tetap bisa diraih walau
   tumpang tindih — thumb-nya sendiri dihidupkan lagi. */
.fp-range{position:relative;height:26px;margin-top:2px}
.fp-range .track{position:absolute;top:11px;left:0;right:0;height:3px;border-radius:3px;
  background:var(--bg-3)}
.fp-range .fill{position:absolute;top:11px;height:3px;border-radius:3px;background:var(--accent)}
.fp-range input[type=range]{position:absolute;top:0;left:0;width:100%;height:26px;margin:0;
  appearance:none;background:none;pointer-events:none}
.fp-range input[type=range]::-webkit-slider-thumb{appearance:none;pointer-events:auto;
  width:16px;height:16px;border-radius:50%;background:var(--panel);border:2px solid var(--accent);
  cursor:grab;box-shadow:0 1px 4px rgba(17,17,20,.25);margin-top:0}
.fp-range input[type=range]::-moz-range-thumb{pointer-events:auto;width:14px;height:14px;
  border-radius:50%;background:var(--panel);border:2px solid var(--accent);cursor:grab;
  box-shadow:0 1px 4px rgba(17,17,20,.25)}
.fp-range input[type=range]::-webkit-slider-runnable-track{height:26px;background:none}
.fp-range input[type=range]::-moz-range-track{height:26px;background:none}

/* Mobile: panel jadi drawer geser dari kiri. Di desktop drawer & backdrop
   tidak pernah dipakai (lihat @media min-width:768px). */
.fp-backdrop{position:fixed;inset:0;z-index:70;background:rgba(17,17,20,.42);
  backdrop-filter:blur(2px)}
.fp-drawer{position:fixed;inset:0 auto 0 0;z-index:71;width:min(86vw,330px);
  background:var(--bg);border-right:1px solid var(--line);overflow-y:auto;
  padding:calc(18px + env(safe-area-inset-top)) 16px calc(18px + env(safe-area-inset-bottom))}
.fp-drawer .fp{border:none;padding:0;background:none}
.fp-close{position:sticky;top:0;z-index:2;display:flex;justify-content:flex-end;
  padding-bottom:10px;background:var(--bg)}
.fp-close button{font-size:22px;line-height:1;color:var(--muted);padding:4px 8px}

/* ---------- skeleton loading ---------- */
/* Meniru struktur Card (media 1:1 + body + kaki) supaya grid tidak melompat
   saat data asli datang. Animasi murni CSS — tanpa library. */
.sk{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);
  overflow:hidden;display:flex;flex-direction:column}
.sk-media{aspect-ratio:1/1}
.sk-body{padding:19px 19px 17px;display:flex;flex-direction:column;gap:10px}
.sk-foot{border-top:1px solid var(--line);padding:14px 19px}
.sk-line{height:11px;border-radius:5px}
.sk-media,.sk-line{background:linear-gradient(100deg,var(--bg-2) 30%,var(--bg-3) 50%,var(--bg-2) 70%);
  background-size:220% 100%;animation:sk-shimmer 1.25s ease-in-out infinite}
@keyframes sk-shimmer{0%{background-position:150% 0}100%{background-position:-50% 0}}

/* ---------- terakhir dilihat ---------- */
.recent{margin-bottom:clamp(34px,5vw,52px)}
.recent-head{display:flex;align-items:baseline;justify-content:space-between;gap:14px;
  margin-bottom:16px}
.recent-head h3{font-size:clamp(15px,2.2vw,18px);font-weight:700;letter-spacing:-.01em}
.recent-clear{font-size:12px;font-weight:600;color:var(--muted);text-decoration:underline;
  text-underline-offset:3px}
/* Carousel scroll horizontal — snap supaya berhenti rapi di tiap kartu. */
.recent-rail{display:flex;gap:13px;overflow-x:auto;scroll-snap-type:x mandatory;
  padding-bottom:6px;scrollbar-width:thin}
.recent-rail::-webkit-scrollbar{height:5px}
.recent-rail::-webkit-scrollbar-thumb{background:var(--line-2);border-radius:9px}
.rcard{position:relative;flex:none;width:150px;scroll-snap-align:start;text-align:left;
  background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden;
  transition:border-color .2s,transform .2s}
.rcard:hover{border-color:var(--line-2);transform:translateY(-3px)}
.rcard-media{aspect-ratio:1/1;position:relative;background:var(--bg-3)}
.rcard-media img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;
  opacity:0;transition:opacity .4s}
.rcard-media img.ok{opacity:1}
.rcard-media .blp{position:absolute;inset:11% 8%}
.rcard-body{padding:10px 11px 12px;display:flex;flex-direction:column;gap:3px}
.rcard-body b{font-size:12.5px;font-weight:650;line-height:1.3;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.rcard-body span{font-size:12px;font-weight:700;color:var(--accent)}

/* ---------- feature editorial (foto besar + teks berselang-seling) ---------- */
.reveal{opacity:0;transform:translateY(28px);
  transition:opacity .6s ease,transform .7s cubic-bezier(.2,.7,.25,1)}
.reveal.shown{opacity:1;transform:none}
.feature{display:grid;grid-template-columns:1fr;gap:28px;align-items:center}
.feature + .feature{margin-top:clamp(64px,10vw,120px)}
.feature-media{aspect-ratio:4/3;border-radius:16px;overflow:hidden;position:relative;
  background:radial-gradient(120% 120% at 50% 25%, #fbfbfa, var(--bg-3) 82%);
  border:1px solid var(--line)}
.feature-media img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;
  opacity:0;transition:opacity .5s ease}
.feature-media img.ok{opacity:1}
.feature-media .blp{position:absolute;inset:12% 9%}
.feature-copy h3{font-size:clamp(30px,4.6vw,46px);font-weight:745;letter-spacing:-.025em;
  line-height:1.04;margin:14px 0 18px}
.feature-copy > p:not(.kicker){font-size:15.5px;line-height:1.72;color:var(--muted);max-width:46ch}

/* ---------- detail ---------- */
.detail{padding:118px 0 calc(112px + env(safe-area-inset-bottom))}
.back{font-family:var(--mono);font-size:12px;letter-spacing:.08em;color:var(--muted);
  margin-bottom:28px;display:inline-flex;gap:8px}
.back:hover{color:var(--accent)}
.detail-grid{display:grid;grid-template-columns:1fr;gap:clamp(26px,3.5vw,56px);align-items:start}
/* min-width:0 — WAJIB, bukan hiasan. Grid item punya min-width:auto secara
   default, artinya ia MENOLAK menyusut di bawah lebar min-content isinya.
   Baris tab (.dtabs) min-content-nya ~434px, jadi kolom "1fr" ini melar ke
   434px di layar 375px dan menyeret seluruh dokumen ikut melebar (halaman unit
   meluber 79px). Efek sampingnya: overflow-x:auto pada .dtabs tidak pernah
   aktif karena lebarnya tidak pernah dibatasi. Dengan min-width:0 kolomnya
   menyusut mengikuti layar dan tab-nya menggulung sendiri seperti yang
   dimaksudkan sejak awal. */
.detail-grid > *{min-width:0}
/* CTA menempel di bawah layar HP (basis/default) — panel harga lengkap
   tetap ada di alur normal, sticky bar ini jalan pintas biar tak perlu
   scroll jauh. Disembunyikan lagi di layar besar lewat
   @media(min-width:768px) di bagian bawah, karena di situ CTA di dalam
   panel sudah cukup dekat/terlihat tanpa perlu jalan pintas. */
.sticky-cta{display:flex;align-items:center;gap:8px;position:fixed;left:0;right:0;bottom:0;
  z-index:70;background:rgba(255,255,255,.94);backdrop-filter:blur(14px);
  border-top:1px solid var(--line);box-shadow:0 -6px 24px rgba(17,17,20,.1);
  padding:12px 14px calc(12px + env(safe-area-inset-bottom))}
.sticky-cta-price{display:flex;flex-direction:column;line-height:1.2;flex:none}
.sticky-cta-price span{font-family:var(--mono);font-size:9.5px;letter-spacing:.08em;
  color:var(--muted);text-transform:uppercase}
.sticky-cta-price b{font-size:13.5px;font-weight:760;white-space:nowrap;letter-spacing:-.01em}
.sticky-cta .btn{flex:1;white-space:nowrap;min-height:46px;font-size:13px;padding:12px 14px}
/* tombol besar di panel disembunyikan kalau sticky bar kembar sudah tampil,
   supaya tidak ada dua CTA identik terlihat berbarengan di layar sempit */
.panel-cta.has-sticky-twin{display:none}
.gallery-main{aspect-ratio:3/4;border-radius:14px;overflow:hidden;position:relative;
  background:radial-gradient(120% 120% at 50% 25%, #fbfbfa, var(--bg-3) 82%);
  border:1px solid var(--line)}
.gallery-main img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
/* touch-action:pan-y pinch-zoom — foto tak lagi menangkap seret horizontal
   (fitur seret-untuk-memutar sudah dihapus), jadi jari bebas untuk pinch-zoom
   native dan gulir vertikal halaman lewat begitu saja. Ganti foto kini hanya
   lewat panah/thumbnail. */
.gallery-main.has-photo img{cursor:zoom-in;touch-action:pan-y pinch-zoom;user-select:none}
.gallery-main .blp{position:absolute;inset:13% 10%;opacity:1}
.g-arrow{position:absolute;top:50%;transform:translateY(-50%);z-index:3;width:44px;height:44px;
  border-radius:50%;background:rgba(255,255,255,.92);border:1px solid var(--line-2);
  font-size:15px;display:flex;align-items:center;justify-content:center;
  box-shadow:0 2px 10px rgba(17,17,20,.14);transition:opacity .2s,border-color .2s,color .2s}
.g-arrow:hover:not(:disabled){border-color:var(--accent);color:var(--accent)}
.g-arrow:disabled{opacity:.3;cursor:default}
.g-arrow.prev{left:12px}
.g-arrow.next{right:12px}
.g-count{position:absolute;top:12px;right:12px;z-index:3;font-family:var(--mono);font-size:11px;
  font-weight:600;letter-spacing:.05em;color:var(--muted);background:rgba(255,255,255,.9);
  border:1px solid var(--line);padding:4px 11px;border-radius:999px;pointer-events:none}
.lightbox{position:fixed;inset:0;z-index:140;background:rgba(13,13,16,.93);overflow:hidden}
.lightbox img{position:absolute;inset:0;margin:auto;max-width:92vw;max-height:84vh;
  width:auto;height:auto;object-fit:contain;cursor:zoom-in;touch-action:none;user-select:none}
.lightbox img.lb-zoomed{cursor:grab}
.lightbox img.lb-zoomed:active{cursor:grabbing}
.lb-hint{position:absolute;left:50%;bottom:48px;transform:translateX(-50%);z-index:4;
  font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;
  color:rgba(255,255,255,.6);white-space:nowrap;pointer-events:none;max-width:92vw;
  overflow:hidden;text-overflow:ellipsis}
.lightbox .g-arrow{background:rgba(255,255,255,.13);border-color:rgba(255,255,255,.3);color:#fff}
.lightbox .g-arrow:hover:not(:disabled){border-color:#fff;color:#fff}
.lightbox .g-arrow.prev{left:20px}
.lightbox .g-arrow.next{right:20px}
.lightbox .g-count{top:auto;bottom:20px;left:50%;right:auto;transform:translateX(-50%);
  background:rgba(255,255,255,.13);border-color:rgba(255,255,255,.25);color:#fff}
.lb-close{position:absolute;top:16px;right:16px;z-index:4;width:44px;height:44px;border-radius:50%;
  border:1.5px solid rgba(255,255,255,.4);color:#fff;font-size:16px;
  display:flex;align-items:center;justify-content:center;transition:border-color .2s}
.lb-close:hover{border-color:#fff}
.thumbs{display:flex;gap:10px;margin-top:11px;flex-wrap:wrap}
.thumbs button{width:64px;height:50px;border-radius:9px;overflow:hidden;
  border:1.5px solid var(--line);opacity:.6;transition:opacity .2s,border-color .2s;background:var(--bg-2)}
.thumbs button.on{opacity:1;border-color:var(--accent)}
.thumbs img{width:100%;height:100%;object-fit:cover}
/* tab switcher detail teknis (pola Engine/Chassis ala lembar spek) */
.dtabs-wrap{margin-top:40px}
/* Tab detail: cukup lebar untuk muat SEMUA tab tanpa gulir horizontal. Dulu
   di HP baris ini meluber (~434px di layar 335px) sehingga tab terakhir
   ("Perlindungan") terpotong dan butuh geser + bayangan tepi (terasa
   "floating"). Sekarang di ≤560px tab dibagi rata (flex:1) dengan font lebih
   kecil → ketiganya muat rapi dalam satu baris, tanpa gulir. */
.dtabs{display:flex;gap:2px;border-bottom:1px solid var(--line)}
.dtabs button{padding:13px 16px;font-size:14px;font-weight:600;color:var(--muted);
  position:relative;white-space:nowrap;transition:color .2s}
@media(max-width:560px){
  .dtabs button{flex:1 1 0;min-width:0;padding:11px 6px;font-size:12px;
    white-space:normal;text-align:center;line-height:1.25;letter-spacing:.02em}
}
.dtabs button:hover{color:var(--ink)}
.dtabs button.on{color:var(--ink)}
.dtabs button.on::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;
  background:var(--accent)}
/* Wrapper = grid; ketiga panel menempati sel yang sama (grid-area 1/1) sehingga
   barisnya setinggi panel terpanjang. Tinggi tak berubah saat ganti tab. */
.dtab-body{display:grid;padding-top:22px;min-height:96px}
.dtab-panel{grid-area:1/1;font-size:15.5px;line-height:1.72;color:#33363c;
  max-width:60ch;white-space:pre-line;
  opacity:0;visibility:hidden;transition:opacity .22s ease-out}
.dtab-panel.on{opacity:1;visibility:visible}
@media(prefers-reduced-motion:reduce){.dtab-panel{transition:none}}
.dtab-body .muted{color:var(--muted)}
.dtab-warranty{list-style:none;max-width:540px}
.dtab-warranty li{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline;
  padding:13px 0;border-bottom:1px solid var(--line)}
.dtab-warranty b{font-size:14.5px;font-weight:680;flex:none}
.dtab-warranty span{color:var(--muted);font-size:13px;flex:1;min-width:150px}
.dtab-warranty em{font-style:normal;font-family:var(--mono);font-size:12.5px;font-weight:600}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;
  padding:28px;position:static;top:98px;box-shadow:var(--shadow)}
.panel h1{font-size:clamp(25px,2.6vw,33px);font-weight:760;letter-spacing:-.02em;line-height:1.06}
.panel .price{font-size:26px;font-weight:780;margin:11px 0 22px;letter-spacing:-.02em}
.specs{display:grid;grid-template-columns:repeat(2,1fr);border:1px solid var(--line);
  border-radius:11px;overflow:hidden;margin-bottom:26px}
.specs div{padding:13px 10px;border-right:1px solid var(--line);text-align:center}
.specs div:last-child{border-right:none}
.specs div:nth-child(2){border-right:none}
.specs small{display:block;font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;
  color:var(--dim);text-transform:uppercase;margin-bottom:6px}
.specs b{font-size:14px;font-weight:700;white-space:nowrap}
.w-title{font-family:var(--mono);font-size:11px;letter-spacing:.13em;text-transform:uppercase;
  color:var(--muted);margin-bottom:12px}
.w-opts{display:flex;flex-direction:column;gap:9px;margin-bottom:24px}
.w-opt{display:flex;align-items:center;gap:13px;border:1.5px solid var(--line);
  border-radius:11px;padding:14px 15px;text-align:left;transition:border-color .18s,background .18s}
.w-opt:hover{border-color:var(--line-2)}
.w-opt.on{border-color:var(--accent);background:rgba(26,47,94,.055)}
.w-dot{width:18px;height:18px;border-radius:50%;border:2px solid var(--dim);flex:none;
  display:flex;align-items:center;justify-content:center}
.w-opt.on .w-dot{border-color:var(--accent)}
.w-opt.on .w-dot::after{content:"";width:9px;height:9px;border-radius:50%;background:var(--accent)}
.w-body{flex:1}
.w-body b{display:block;font-size:14.5px;font-weight:680}
.w-body span{font-size:12.5px;color:var(--muted)}
.w-price{font-family:var(--mono);font-size:13px;font-weight:600;color:var(--ink)}
.rows{border:1px solid var(--line);border-radius:11px;overflow:hidden;margin-bottom:19px}
.row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:13px 16px;font-size:14px}
.row + .row{border-top:1px solid var(--line)}
.row span{color:var(--muted);min-width:0}
.row span small{display:block;font-size:11px;color:var(--dim)}
.row b{font-weight:680;white-space:nowrap;flex:none}
.row.hl{background:var(--panel-2)}
.row.hl b{color:var(--accent);font-size:16px;font-weight:760}
.fine{font-size:12px;color:var(--dim);line-height:1.58;margin-top:15px}
.stnote{margin-bottom:17px;font-family:var(--mono);font-size:12px;padding:11px 14px;
  border-radius:9px;border:1px solid var(--line-2)}
.stnote.warn{color:var(--warn);border-color:rgba(184,121,27,.32);background:rgba(184,121,27,.05)}
.stnote.dim{color:var(--muted)}
.stnote.titip-note{font-family:var(--font);font-size:13px;line-height:1.55;color:#33363c;
  background:var(--panel-2);border-color:var(--line-2)}
.stnote.titip-note b{color:var(--ink)}

/* ---------- modal ---------- */
.overlay{position:fixed;inset:0;z-index:90;background:rgba(20,20,24,.42);
  backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px}
.modal{background:var(--panel);border:1px solid var(--line);border-radius:18px;
  width:min(430px,100%);max-height:92svh;overflow:auto;box-shadow:0 24px 70px rgba(17,17,20,.22);
  animation:pop .28s cubic-bezier(.2,.9,.3,1.12)}
@keyframes pop{from{transform:translateY(20px) scale(.97);opacity:0}}
.m-head{display:flex;justify-content:space-between;align-items:center;gap:12px;
  padding:19px 20px;border-bottom:1px solid var(--line);
  position:sticky;top:0;background:var(--panel);z-index:2}
.m-head h3{font-size:16px;font-weight:700}
.m-head .sub{font-family:var(--mono);font-size:11.5px;color:var(--dim)}
.m-close{width:42px;height:42px;border-radius:50%;border:1.5px solid var(--line-2);
  font-size:15px;line-height:1;flex:none;transition:border-color .2s,color .2s}
.m-close:hover{border-color:var(--accent);color:var(--accent)}
.m-body{padding:20px}
.tag-qris{display:inline-flex;align-items:center;gap:7px;font-family:var(--mono);
  font-size:10.5px;font-weight:600;letter-spacing:.06em;color:var(--muted);
  border:1px solid var(--line-2);padding:6px 11px;border-radius:999px;margin-bottom:15px}
.qr-tile{background:#fff;border:1px solid var(--line);border-radius:13px;padding:15px;
  width:fit-content;margin:0 auto 14px}
.qr-tile img{width:220px;height:220px}
.qr-amount{font-size:22px;font-weight:780;text-align:center;letter-spacing:-.02em}
.qr-timer{font-family:var(--mono);font-size:12.5px;color:var(--muted);text-align:center;margin-top:6px}
.qr-timer b{color:var(--accent)}
.waiting{display:flex;align-items:center;justify-content:center;gap:9px;margin:15px 0 6px;
  font-size:13px;color:var(--muted)}
.dotp{width:8px;height:8px;border-radius:50%;background:var(--accent);animation:pulse 1.1s infinite}
@keyframes pulse{50%{opacity:.25}}
.m-note{font-size:12px;color:var(--dim);line-height:1.58;text-align:center;margin-top:12px}
.m-actions{display:flex;flex-direction:column;gap:10px;margin-top:16px}
/* Dua tombol (pratinjau + publish): menumpuk di HP, berdampingan begitu muat.
   Publish diberi porsi lebih besar — ia aksi utamanya. */
.m-actions-2{flex-direction:column}
.m-actions-2 .btn{width:100%}
@media(min-width:520px){
  .m-actions-2{flex-direction:row}
  .m-actions-2 .btn{width:auto}
  .m-actions-2 .btn-ghost{flex:0 0 auto}
  .m-actions-2 .btn-accent{flex:1}
}
.ok-mark{width:72px;height:72px;border-radius:50%;background:rgba(31,157,85,.1);
  display:flex;align-items:center;justify-content:center;margin:4px auto 14px}
.ok-mark svg{width:34px;height:34px;stroke:var(--ok);stroke-width:3;fill:none;
  stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:48;stroke-dashoffset:48;
  animation:draw .5s .15s forwards}
@keyframes draw{to{stroke-dashoffset:0}}
.ok-title{text-align:center;font-size:18px;font-weight:700;margin-bottom:4px}
.ok-sub{text-align:center;font-size:13px;color:var(--muted);margin-bottom:16px}
.chip-ok{font-family:var(--mono);font-size:11px;font-weight:600;color:var(--ok);
  background:rgba(31,157,85,.1);padding:4px 10px;border-radius:999px}

/* ---------- form ---------- */
.f-grid{display:grid;grid-template-columns:1fr;gap:13px}
.field{display:flex;flex-direction:column;gap:6px}
.field.full{grid-column:1/-1}
.field label{font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;
  text-transform:uppercase;color:var(--muted)}
.field input,.field select,.field textarea{background:var(--bg);
  border:1.5px solid var(--line-2);border-radius:10px;padding:12px 13px;font-size:14.5px;
  transition:border-color .2s;width:100%}
.field textarea{min-height:90px;resize:vertical;line-height:1.5}
.field input:focus,.field select:focus,.field textarea:focus{outline:none;border-color:var(--ink)}
.f-err{font-size:13px;color:#c62f14;margin-top:12px;line-height:1.5}
.f-info{font-size:13px;color:var(--muted);margin-top:12px;line-height:1.5}
.switcher{display:flex;gap:6px;background:var(--bg-2);border:1px solid var(--line);
  border-radius:999px;padding:4px;margin-bottom:18px}
.switcher button{flex:1;padding:9px;border-radius:999px;font-size:13.5px;font-weight:600;color:var(--muted)}
.switcher button.on{background:var(--panel);color:var(--ink);box-shadow:0 1px 3px rgba(17,17,20,.08)}

/* ---------- admin ---------- */
.admin{padding:120px 0 90px}
/* Kotak diagnostik akses admin — muncul saat login tapi belum diakui staf. */
.admin-diag{margin-top:22px;max-width:560px;border:1px solid var(--line);
  border-radius:12px;padding:18px 20px;background:var(--panel-2)}
.admin-diag > b{display:block;margin-bottom:12px}
.admin-diag dl{display:flex;flex-direction:column;gap:7px;margin-bottom:12px}
.admin-diag dl > div{display:flex;gap:10px;font-size:13.5px}
.admin-diag dt{flex:none;width:120px;color:var(--muted)}
.admin-diag dd{word-break:break-all}
.admin-diag .mono{font-family:var(--mono);font-size:12.5px}
.admin-diag-hint{font-size:13.5px;line-height:1.6;color:#33363c;margin-bottom:14px}
.a-head{display:flex;justify-content:space-between;align-items:center;gap:16px;
  flex-wrap:wrap;margin-bottom:28px}
.a-head h1{font-size:clamp(27px,3.4vw,40px);font-weight:750;letter-spacing:-.025em}
/* width:fit-content memaksa pil ini selebar isinya dan menolak menyusut: empat
   tab butuh ~387px, jadi di layar 375px ia meluber dan MELEBARKAN SELURUH
   DOKUMEN (navbar ikut salah lebar, muncul scroll horizontal di semua halaman
   admin). max-width:100% mengembalikan batasnya ke lebar induk, dan overflow-x
   membuat tab-nya menggulung di dalam pil — bukan mendorong halaman. */
.a-tabs{display:flex;gap:6px;background:var(--bg-2);border:1px solid var(--line);
  border-radius:999px;padding:4px;width:fit-content;max-width:100%;
  overflow-x:auto;scrollbar-width:none;margin-bottom:24px}
.a-tabs::-webkit-scrollbar{display:none}
.a-tabs button{padding:9px 18px;border-radius:999px;font-size:13.5px;font-weight:600;
  color:var(--muted);flex:none;white-space:nowrap}
.a-tabs button.on{background:var(--panel);color:var(--ink);box-shadow:0 1px 3px rgba(17,17,20,.08)}
.a-list{display:flex;flex-direction:column;gap:11px}
.a-row{background:var(--panel);border:1px solid var(--line);border-radius:12px;
  padding:15px 18px;display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap;box-shadow:var(--shadow)}
.a-thumb{width:76px;height:56px;border-radius:8px;overflow:hidden;flex:none;
  background:var(--bg-2);border:1px solid var(--line);
  display:flex;align-items:center;justify-content:center}
.a-thumb img{width:100%;height:100%;object-fit:cover}
.a-info{flex:1;min-width:180px}
.a-info b{display:block;font-size:15px;font-weight:700}
.a-info span{font-family:var(--mono);font-size:11.5px;color:var(--dim)}
.a-price{font-size:15px;font-weight:750}
.st{font-family:var(--mono);font-size:10.5px;font-weight:600;letter-spacing:.06em;
  padding:5px 11px;border-radius:999px;border:1px solid var(--line-2)}
.st.published,.st.approved{color:var(--ok);border-color:rgba(31,157,85,.32);background:rgba(31,157,85,.06)}
.st.booked,.st.pending{color:var(--warn);border-color:rgba(184,121,27,.32);background:rgba(184,121,27,.06)}
.st.sold{color:var(--dim)}
.st.draft{color:var(--muted)}
.st.rejected{color:#c62828;border-color:rgba(198,40,40,.32);background:rgba(198,40,40,.06)}

/* ---------- halaman Titip Jual ---------- */
.titip{padding:clamp(96px,12vw,132px) 0 clamp(56px,8vw,90px)}
.titip-h1{font-size:clamp(28px,5vw,46px);font-weight:750;letter-spacing:-.025em;margin:12px 0 12px}
.titip-lead{color:var(--muted);max-width:600px;line-height:1.62;margin-bottom:30px}
.titip-sec{font-size:13px;font-family:var(--mono);letter-spacing:.12em;text-transform:uppercase;
  color:var(--muted);margin:28px 0 14px}
.titip-form{max-width:720px}
.titip-gate{max-width:520px;border:1px solid var(--line);border-radius:14px;padding:22px 24px;
  background:var(--panel-2)}
.titip-gate p{color:#33363c;line-height:1.6;margin-bottom:16px}
.titip-ok{max-width:600px;border:1px solid var(--ok);background:rgba(31,157,85,.07);
  border-radius:14px;padding:20px 22px;margin-bottom:28px}
.titip-ok b{display:block;margin-bottom:8px}
.titip-ok p{color:#33363c;line-height:1.6;font-size:14.5px;margin-bottom:14px}
.titip-mine{max-width:720px;margin-top:38px}
/* panduan foto (read-only) di form titip jual */
.titip-guide{margin:6px 0 22px}
.titip-guide-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:10px}
.titip-guide-item{margin:0}
.titip-guide-item img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px;
  border:1px solid var(--line);pointer-events:none;user-select:none}
.titip-guide-item figcaption{font-family:var(--mono);font-size:10.5px;letter-spacing:.06em;
  text-transform:uppercase;color:var(--muted);margin-top:6px}
@media(min-width:560px){ .titip-guide-grid{grid-template-columns:repeat(3,1fr)} }
/* detail submission di panel review admin */
.titip-detail{border:1px solid var(--line);border-top:none;border-radius:0 0 11px 11px;
  padding:14px 16px;margin:-6px 0 10px;background:var(--panel-2)}
.titip-detail-photos{display:flex;gap:8px;overflow-x:auto;margin-bottom:12px}
.titip-detail-photos img{width:104px;height:78px;object-fit:cover;border-radius:8px;flex:none}
.titip-detail dl{display:flex;flex-direction:column;gap:7px}
.titip-detail dl > div{display:flex;gap:10px;font-size:13.5px}
.titip-detail dt{flex:none;width:96px;color:var(--muted)}
.titip-detail dd{color:#33363c}
/* band CTA titip jual di homepage */
.titip-band{padding:clamp(40px,6vw,72px) 0}
.titip-band-in{display:flex;flex-direction:column;gap:20px;align-items:flex-start;
  border:1px solid var(--line);border-radius:16px;padding:clamp(24px,4vw,40px);
  background:var(--panel-2)}
.titip-band-in h2{font-size:clamp(22px,3.2vw,34px);font-weight:740;letter-spacing:-.02em;margin:10px 0 8px}
.titip-band-in .aside{max-width:520px;font-size:14.5px;color:var(--muted);line-height:1.55}
@media(min-width:768px){
  .titip-band-in{flex-direction:row;align-items:center;justify-content:space-between;gap:32px}
}
.a-actions{display:flex;gap:7px;flex-wrap:wrap}
/* ---------- parser caption Instagram ---------- */
/* ---------- tata letak form unit: foto | caption+field ---------- */
.uf-cols{display:grid;grid-template-columns:1fr;gap:22px;align-items:start}
/* min-width:0 pada anak grid — tanpa ini kolomnya menolak menyusut di bawah
   min-content isinya dan modal ikut melar (pelajaran dari .detail-grid). */
.uf-cols > *{min-width:0}
@media(min-width:900px){
  .uf-cols{grid-template-columns:320px 1fr;gap:26px}
  /* strip foto ikut menggulung sendiri kalau kolomnya penuh, bukan melebar */
  .uf-left{position:sticky;top:0}
}
.cap{border:1px solid var(--line);background:var(--panel-2);border-radius:12px;
  padding:15px 15px 13px;margin-bottom:18px;display:flex;flex-direction:column;gap:9px}
.cap > label{font-size:12px;font-family:var(--mono);letter-spacing:.1em;
  text-transform:uppercase;color:var(--muted)}
.cap-ta{width:100%;min-height:120px;resize:vertical;border:1px solid var(--line-2);
  border-radius:9px;padding:11px 12px;font-size:14px;line-height:1.55;background:var(--panel)}
.cap-ta:focus{outline:none;border-color:var(--ink)}
.cap-act{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.cap-note{display:flex;flex-direction:column;gap:3px;font-size:12.5px}
.cap-note b{font-weight:600}
.cap-note b.ok{color:var(--ok)}
.cap-note b.warn{color:var(--warn)}

/* Penanda asal-usul isi field: hijau = diisi parser, kuning = parser menyerah
   dan kolomnya masih kosong. Dipasang di .field supaya label ikut berwarna. */
.field.ok input,.field.ok textarea,.field.ok select{border-color:var(--ok);
  box-shadow:0 0 0 2px rgba(31,157,85,.12)}
.field.warn input,.field.warn textarea,.field.warn select{border-color:var(--warn);
  box-shadow:0 0 0 2px rgba(184,121,27,.14)}
.field.ok > label::after{content:" · terisi otomatis";color:var(--ok);font-weight:600}
.field.warn > label::after{content:" · isi manual";color:var(--warn);font-weight:600}

/* ---------- progres unggah ---------- */
.up-prog{display:flex;align-items:center;gap:10px;margin-top:9px}
.up-bar{flex:1;height:5px;border-radius:5px;background:var(--bg-3);overflow:hidden}
.up-bar span{display:block;height:100%;background:var(--accent);border-radius:5px;
  transition:width .3s ease}
.up-prog .mono{font-size:11px;color:var(--muted);flex:none}

/* ---------- pratinjau kartu etalase ---------- */
.prev-wrap{margin-top:16px;padding-top:16px;border-top:1px dashed var(--line-2)}
.prev-card{max-width:290px;margin-top:10px}
/* Kartu pratinjau tidak boleh "muncul saat masuk layar" seperti di etalase —
   di dalam modal ia sering tidak pernah memicu IntersectionObserver dan akan
   diam tak terlihat. */
.prev-card .card-wrap{opacity:1;transform:none}

/* ---------- konfirmasi setelah simpan ---------- */
.a-done{display:flex;align-items:center;justify-content:space-between;gap:14px;
  flex-wrap:wrap;border:1px solid var(--ok);background:rgba(31,157,85,.07);
  border-radius:11px;padding:12px 14px;margin-bottom:16px;font-size:14px}
.a-done-act{display:flex;align-items:center;gap:8px}
.a-done-x{width:26px;height:26px;border-radius:50%;color:var(--muted);flex:none}
.a-done-x:hover{color:var(--ink)}

.photo-strip{display:flex;gap:9px;flex-wrap:wrap;margin-top:4px}
.photo-strip .ph{position:relative;width:90px;height:66px;border-radius:9px;overflow:hidden;
  border:1px solid var(--line-2);cursor:grab}
.photo-strip .ph:active{cursor:grabbing}
.photo-strip .ph.main{border-color:var(--accent);box-shadow:0 0 0 1.5px var(--accent)}
.ph-main-tag{position:absolute;left:0;right:0;bottom:0;font-family:var(--mono);font-size:8px;
  font-weight:600;letter-spacing:.09em;text-align:center;background:var(--accent);color:#fff;
  padding:2.5px 0;pointer-events:none}
.photo-strip img{width:100%;height:100%;object-fit:cover}
.photo-strip .rm{position:absolute;top:4px;right:4px;width:30px;height:30px;border-radius:50%;
  background:rgba(255,255,255,.92);border:1px solid var(--line-2);font-size:13px;
  display:flex;align-items:center;justify-content:center;color:var(--ink)}
.photo-strip .rm:hover{color:var(--accent);border-color:var(--accent)}
.up-tile{width:90px;height:66px;border:1.5px dashed var(--line-2);border-radius:9px;
  display:flex;align-items:center;justify-content:center;font-size:22px;color:var(--dim);
  transition:border-color .2s,color .2s}
.up-tile:hover{border-color:var(--accent);color:var(--accent)}

/* ---------- footer & toast ---------- */
footer{border-top:1px solid var(--line);padding:46px 0 30px;margin-top:20px;background:var(--bg-2)}
.foot{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;flex-wrap:wrap}
.foot-logo{display:flex;flex-direction:column;gap:4px}
.foot .logo{font-size:24px}
.foot-est{font-family:var(--mono);font-size:10.5px;font-weight:600;letter-spacing:.16em;
  text-transform:uppercase;color:var(--dim)}
.foot-links{display:flex;gap:24px;flex-wrap:wrap;font-size:13px;color:var(--muted)}
.foot-links a:hover{color:var(--accent)}
/* baris sosial: dipisah garis tipis atas-bawah, tombol memakai navy brand */
.foot-socials{margin-top:26px;padding:20px 0;border-top:1px solid var(--line);
  border-bottom:1px solid var(--line);display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.foot-socials-label{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;
  text-transform:uppercase;color:var(--dim)}
.social-links{display:flex;align-items:center;gap:18px;flex-wrap:wrap}
.social-link{display:inline-flex;align-items:center;gap:8px;font-weight:600;font-size:14px;
  color:var(--accent);transition:color .2s,opacity .15s}
.social-link:hover{color:var(--accent-ink)}
.social-link:hover .social-label{text-decoration:underline;text-underline-offset:3px}
.social-link:active{opacity:.7}
.social-icon{width:19px;height:19px;flex:none}
.foot-base{margin-top:28px;font-family:var(--mono);font-size:11px;color:var(--dim);
  display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-end}
/* baris kanan: tagline + "Powered by" di bawahnya. Aksen memakai navy brand
   (--accent), bukan hijau — hijau tabrakan dengan palet showroom di sini. */
.foot-brand{display:flex;flex-direction:column;gap:5px;text-align:right}
.foot-brand small{font-size:10.5px;letter-spacing:.06em;color:var(--dim);text-transform:none}
.foot-brand b{color:var(--accent);font-weight:700}
@media(max-width:560px){
  .foot-base{flex-direction:column;align-items:flex-start;gap:14px}
  .foot-brand{text-align:left}
}
/* Mobile (≤720px): deretan tombol aksi dilipat ke menu dropdown yang dibuka
   lewat hamburger — supaya nav tidak meluber/terpotong (mis. tombol "Keluar ·
   Nama" yang dulu terpotong). Logo + search + hamburger tetap di bar. */
@media(max-width:720px){
  .nav-burger{display:inline-flex}
  .nav-links{display:none}
  .nav-links.open{display:flex;flex-direction:column;align-items:stretch;gap:8px;
    position:absolute;top:calc(100% + 6px);right:0;width:min(258px,74vw);
    background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:12px;
    box-shadow:0 18px 46px rgba(17,17,20,.18);z-index:80}
  .nav-links.open .btn{width:100%;justify-content:flex-start;padding:13px 16px;font-size:14.5px}
  .nav-links.open .nav-loc{gap:10px}
  .nav-menu-backdrop{display:block;position:fixed;inset:0;z-index:55}
}
.toast{position:fixed;left:50%;bottom:calc(86px + env(safe-area-inset-bottom));transform:translate(-50%,16px);z-index:120;
  background:var(--ink);color:#fff;font-size:13.5px;font-weight:500;padding:12px 20px;
  border-radius:999px;opacity:0;pointer-events:none;transition:.3s;max-width:88vw;
  text-align:center;box-shadow:0 12px 40px rgba(17,17,20,.24)}
.toast.show{opacity:1;transform:translate(-50%,0)}
.portal-reveal{position:fixed;inset:0;z-index:65;pointer-events:none;overflow:hidden;
  display:flex;align-items:center;justify-content:center}
.portal-reveal-glow{width:300px;height:300px;border-radius:50%;
  background:radial-gradient(closest-side, rgba(26,47,94,.42), rgba(26,47,94,0) 72%)}
.wa-handoff{position:fixed;inset:0;z-index:150;display:flex;align-items:center;
  justify-content:center;background:rgba(255,255,255,.82);backdrop-filter:blur(14px);
  pointer-events:none}
.wa-handoff-spinner{position:absolute;width:38px;height:38px;border-radius:50%;
  border:3px solid var(--line-2);border-top-color:var(--accent);
  animation:wa-spin .7s linear infinite}
@keyframes wa-spin{to{transform:rotate(360deg)}}
.wa-handoff-logo{font-weight:800;font-size:22px;letter-spacing:.01em;
  display:flex;align-items:center;gap:8px;color:var(--ink)}
.wa-handoff-logo i{font-style:normal;color:var(--accent);font-size:17px}
.cfg{min-height:100svh;display:flex;align-items:center;justify-content:center;padding:24px}
.cfg div{max-width:520px;border:1px solid var(--line);border-radius:14px;padding:32px;
  background:var(--panel);font-size:14.5px;line-height:1.65;color:var(--muted);box-shadow:var(--shadow)}
.cfg b{color:var(--ink)}
.cfg code{font-family:var(--mono);font-size:12.5px;color:var(--accent)}

/* ---------- Tugas 4: search bar di header (typewriter placeholder) ---------- */
.nav-search{flex:1 1 auto;min-width:0;max-width:360px;position:relative;
  margin:0 clamp(10px,3vw,26px)}
.nav-search input{width:100%;background:var(--panel);border:1.5px solid var(--line-2);
  border-radius:999px;padding:9px 16px 9px 38px;font-size:13.5px;transition:border-color .2s}
.nav-search input:focus{outline:none;border-color:var(--ink)}
.nav-search .si{position:absolute;left:14px;top:50%;transform:translateY(-50%);
  width:15px;height:15px;color:var(--muted);pointer-events:none}

/* ---------- Tugas 8: kartu penjelasan grade ---------- */
.grade-head{margin-top:clamp(56px,8vw,104px)}
.grade-head h3{font-size:clamp(24px,3.4vw,36px);font-weight:740;letter-spacing:-.02em;margin-top:12px}
.grade-cards{display:grid;grid-template-columns:1fr;gap:16px;margin-top:clamp(26px,4vw,40px)}
.grade-card{border:1px solid var(--line);border-radius:14px;padding:22px 20px;
  background:var(--panel);box-shadow:var(--shadow);display:flex;flex-direction:column;gap:14px}
.grade-card .badge{position:static;display:inline-flex;width:fit-content;font-size:11px}
.grade-card p{font-size:14px;line-height:1.62;color:var(--muted)}

/* ---------- section "Sejarah Motorell" ---------- */
.section.about{background:var(--bg-2);border-block:1px solid var(--line)}
.about-inner{max-width:760px}
.about-inner h2{font-size:clamp(30px,4vw,50px);font-weight:740;letter-spacing:-.025em;
  line-height:1.02;margin:13px 0 clamp(24px,3.5vw,38px)}
.about-story{display:flex;flex-direction:column;gap:20px}
/* rata kiri (bukan justify) — justify bikin "rivers" jarak antar-kata di kolom
   sempit dan susah dibaca di mobile */
.about-story p{font-size:16px;line-height:1.8;color:#33363c;max-width:68ch}

/* ---------- section "Temukan Kami" (peta Google Maps asli, dibingkai bulat) ---------- */
.lokasi-grid{display:grid;grid-template-columns:1fr;gap:44px;align-items:center;margin-top:16px}
/* lingkaran peta: iframe Google Maps di dalam frame bulat, seluruhnya jadi
   satu tautan ke Maps. */
.lokasi-map{position:relative;display:block;width:min(300px,80vw);aspect-ratio:1/1;
  margin:0 auto;border-radius:50%;overflow:hidden;background:var(--bg-3);
  box-shadow:0 14px 44px rgba(17,17,20,.18);cursor:pointer}
.lokasi-map iframe{position:absolute;inset:0;width:100%;height:100%;border:0;
  pointer-events:none} /* non-interaktif: gulir tembus ke halaman, klik ke <a> */
/* cincin tipis di tepi supaya batas lingkaran tegas di atas peta */
.lokasi-map-ring{position:absolute;inset:0;border-radius:50%;pointer-events:none;
  box-shadow:inset 0 0 0 6px var(--panel),inset 0 0 0 7px var(--line-2)}
.lokasi-map:hover{box-shadow:0 16px 50px rgba(26,47,94,.28)}
.lokasi-info{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--accent);
  border-radius:16px;padding:26px 24px;box-shadow:var(--shadow)}
.lokasi-info h3{font-size:20px;font-weight:720;letter-spacing:-.01em;margin-bottom:8px}
.lokasi-info > p{color:var(--muted);font-size:14.5px;line-height:1.62;margin-bottom:20px}
.lokasi-facts{list-style:none;display:flex;flex-direction:column;gap:13px;margin-bottom:22px}
.lokasi-facts li{display:flex;flex-direction:column;gap:3px}
.lokasi-facts span{font-family:var(--mono);font-size:10px;letter-spacing:.1em;
  text-transform:uppercase;color:var(--dim)}
.lokasi-facts b{font-size:14px;font-weight:600;line-height:1.45}
.lokasi-facts a{color:var(--accent);text-decoration:underline;text-underline-offset:3px}
@media(min-width:768px){
  .lokasi-grid{grid-template-columns:1fr 1fr;gap:56px}
}

/* ---------- Tugas 9b: ketentuan unit di halaman detail ---------- */
.unit-terms{margin-top:36px;border:1px solid var(--line);border-radius:14px;
  padding:20px 22px;background:var(--panel-2)}
.unit-terms h4{font-size:11px;font-family:var(--mono);letter-spacing:.13em;
  color:var(--muted);margin-bottom:15px}
.unit-terms ul{list-style:none;display:flex;flex-direction:column;gap:11px}
.unit-terms li{display:flex;gap:11px;font-size:14px;line-height:1.5;color:#33363c}
.unit-terms li .dot{color:var(--accent);flex:none;font-weight:800}
.unit-terms b{color:var(--ink)}
.unit-terms a{color:var(--accent);font-weight:600;text-decoration:underline;text-underline-offset:3px}

/* ---------- Tugas 11: halaman kebijakan / FAQ ---------- */
.policy{padding:118px 0 90px}
.policy h1{font-size:clamp(30px,5vw,46px);font-weight:750;letter-spacing:-.025em;margin:14px 0 10px}
.policy .lead{color:var(--muted);max-width:560px;line-height:1.62;margin-bottom:30px}
.policy-item{border-top:1px solid var(--line)}
.policy-item:last-child{border-bottom:1px solid var(--line)}
.policy-item summary{cursor:pointer;list-style:none;padding:22px 2px;display:flex;
  justify-content:space-between;align-items:center;gap:16px;
  font-size:clamp(16px,2.3vw,20px);font-weight:700;letter-spacing:-.01em}
.policy-item summary::-webkit-details-marker{display:none}
.policy-item summary .pm{font-family:var(--mono);color:var(--muted);font-size:20px;
  transition:transform .25s;flex:none}
.policy-item[open] summary .pm{transform:rotate(45deg)}
.policy-body{padding:0 2px 26px;max-width:72ch}
.policy-body p{color:#33363c;line-height:1.74;font-size:15px}
.policy-body p + p{margin-top:14px}

/* ---------- Tugas 13b: reveal berselang-seling (teks & visual bertemu di tengah) ----------
   Kontainer .feature memakai komponen Reveal; alih-alih menggeser seluruh
   blok ke atas, di sini anak-anaknya (visual & teks) meluncur dari sisi
   BERLAWANAN lalu bertemu di tengah. Arahnya dibalik pada .flip. */
.feature.reveal{opacity:1;transform:none}
.feature .feature-media-slide,.feature .feature-copy{opacity:0;
  transition:opacity .7s ease,transform .8s cubic-bezier(.2,.7,.25,1)}
.feature .feature-media-slide{transform:translateX(-46px)}
.feature .feature-copy{transform:translateX(46px)}
.feature.flip .feature-media-slide{transform:translateX(46px)}
.feature.flip .feature-copy{transform:translateX(-46px)}
.feature.shown .feature-media-slide,.feature.shown .feature-copy{opacity:1;transform:none}

/* ---------- MotorCarousel: putar 360° dari foto asli unit ---------- */
/* touch-action:pan-y → seret horizontal memutar motor, geser vertikal tetap
   men-scroll halaman (carousel tidak lagi menyandera scroll). */
.mc{cursor:grab;touch-action:pan-y;overflow:hidden;outline:none}
.mc:active{cursor:grabbing}
.mc:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.mc-stage{position:absolute;inset:0}
.mc-img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;
  user-select:none;-webkit-user-drag:none}
.mc-part{position:absolute;transform:translate(-50%,-50%);z-index:10;
  pointer-events:none;max-width:20%;max-height:20%;object-fit:contain}
.mc-skeleton{position:absolute;inset:0;z-index:12;pointer-events:none;
  background:linear-gradient(100deg,var(--bg-2) 30%,var(--bg-3) 50%,var(--bg-2) 70%);
  background-size:220% 100%;animation:mc-shimmer 1.1s linear infinite}
@keyframes mc-shimmer{to{background-position:-220% 0}}
.mc-nophoto{position:absolute;left:0;right:0;bottom:16px;text-align:center;
  font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--dim)}
.mc-dots{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);z-index:13;
  display:flex;gap:6px;padding:6px 9px;border-radius:999px;
  background:rgba(255,255,255,.86);backdrop-filter:blur(6px);border:1px solid var(--line)}
.mc-dots button{width:7px;height:7px;border-radius:50%;background:var(--line-2);
  transition:background .2s,transform .2s}
.mc-dots button:hover{background:var(--dim)}
.mc-dots button.on{background:var(--accent);transform:scale(1.35)}
.mc-hint{position:absolute;left:50%;bottom:38px;transform:translateX(-50%);z-index:12;
  font-family:var(--mono);font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;
  color:var(--muted);white-space:nowrap;pointer-events:none;opacity:0;
  transition:opacity .25s}
.mc:hover .mc-hint,.mc:focus-visible .mc-hint{opacity:1}
.mc .g-arrow{opacity:0;transition:opacity .22s,border-color .2s,color .2s}
.mc:hover .g-arrow,.mc:focus-within .g-arrow{opacity:1}
/* di layar sentuh panah selalu terlihat — tidak ada hover di sana */
@media(pointer:coarse){
  .mc .g-arrow{opacity:1}
  .mc-hint{opacity:1}
}

/* ---------- Smart search: dropdown saran ---------- */
.ns-pop{position:absolute;top:calc(100% + 9px);left:0;right:0;z-index:80;
  background:var(--panel);border:1px solid var(--line);border-radius:14px;
  box-shadow:0 18px 50px rgba(17,17,20,.16);overflow:hidden}
.ns-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:11px 14px;border-bottom:1px solid var(--line);background:var(--panel-2)}
.ns-count{font-family:var(--mono);font-size:10.5px;letter-spacing:.08em;
  text-transform:uppercase;color:var(--muted)}
.ns-chips{display:flex;gap:6px;flex-wrap:wrap}
.ns-chip{font-family:var(--mono);font-size:10px;font-weight:600;letter-spacing:.05em;
  padding:4px 9px;border-radius:999px;border:1px solid var(--line-2);color:var(--accent);
  background:rgba(26,47,94,.06);white-space:nowrap}
.ns-list{max-height:min(58vh,380px);overflow-y:auto}
.ns-item{display:flex;align-items:center;gap:12px;width:100%;padding:11px 14px;
  text-align:left;border-bottom:1px solid var(--line);transition:background .15s}
.ns-item:last-child{border-bottom:none}
.ns-item:hover,.ns-item.cur{background:var(--panel-2)}
.ns-item img{width:52px;height:40px;border-radius:7px;object-fit:cover;flex:none;
  border:1px solid var(--line)}
.ns-thumb-empty{width:52px;height:40px;border-radius:7px;flex:none;background:var(--bg-3);
  border:1px solid var(--line)}
.ns-body{flex:1;min-width:0}
.ns-body b{display:block;font-size:13.5px;font-weight:660;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.ns-body span{font-family:var(--mono);font-size:10.5px;color:var(--dim)}
.ns-body mark{background:rgba(26,47,94,.16);color:var(--accent);border-radius:3px;padding:0 1px}
.ns-price{font-size:13px;font-weight:720;white-space:nowrap;flex:none}
.ns-all{width:100%;padding:12px;font-size:12.5px;font-weight:600;color:var(--accent);
  background:var(--panel-2);border-top:1px solid var(--line);transition:background .15s}
.ns-all:hover{background:var(--bg-3)}
.ns-none{padding:22px 14px;text-align:center;font-size:13.5px;color:var(--muted)}
/* chip filter cepat — sekali klik langsung mengisi query */
.ns-quick{display:flex;gap:6px;flex-wrap:wrap;padding:11px 14px;border-top:1px solid var(--line)}
.ns-quick button{font-family:var(--mono);font-size:10px;font-weight:600;letter-spacing:.05em;
  padding:6px 11px;border-radius:999px;border:1px solid var(--line-2);color:var(--muted);
  transition:border-color .18s,color .18s}
.ns-quick button:hover{border-color:var(--accent);color:var(--accent)}
/* tombol bersihkan (✕) di dalam input, muncul saat ada teks */
.nav-search .ns-clear{position:absolute;right:8px;top:50%;transform:translateY(-50%);
  width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:12px;color:var(--muted);transition:background .15s,color .15s}
.nav-search .ns-clear:hover{background:var(--bg-2);color:var(--ink)}
/* sembunyikan tombol clear bawaan WebKit supaya tidak dobel dengan ns-clear */
.nav-search input[type=search]::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none}
.nav-search input{padding-right:34px}
/* panel tips saat input fokus tapi kosong */
.ns-pop-tips{padding:0}
.ns-tip{padding:13px 14px;font-size:12.5px;line-height:1.5;color:var(--muted)}
.ns-tip b{color:var(--ink);font-weight:600}

/* kartu hasil pencarian disorot sebentar supaya mata langsung tertuju ke sana */
.card-wrap.match .card{border-color:var(--accent);
  box-shadow:0 0 0 1.5px var(--accent),var(--shadow)}

/* ---------- Part modifikasi: tab kategori di halaman detail ---------- */
.mp-tabs{display:flex;gap:2px;border-bottom:1px solid var(--line);overflow-x:auto;
  margin-bottom:14px}
.mp-tabs button{padding:9px 12px;font-size:12px;font-weight:600;color:var(--muted);
  position:relative;white-space:nowrap;flex:none;transition:color .2s;text-transform:uppercase;
  font-family:var(--mono);letter-spacing:.06em}
.mp-tabs button:hover{color:var(--ink)}
.mp-tabs button.on{color:var(--ink)}
.mp-tabs button.on::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;
  background:var(--accent)}
.mp-tabs .n{opacity:.55;margin-left:5px}
.w-opt img{width:34px;height:26px;border-radius:5px;object-fit:cover;flex:none;
  border:1px solid var(--line)}

/* ============================================================
   MOBILE-FIRST: basis di atas dirancang untuk 320–428px. Dari sini,
   progressive enhancement ke layar lebih besar via min-width — bukan
   sebaliknya. Urutan breakpoint SENGAJA menaik (381 → 681 → 768 →
   1021) supaya cascade menumpuk dengan benar.
   ============================================================ */
/* tablet kecil ke atas: sticky-cta & tap target kembali ke ukuran
   "normal" (dari basis extra-small di bawah 381px) */
@media(min-width:381px){
  .sticky-cta{gap:12px;padding-left:clamp(16px,5vw,24px);padding-right:clamp(16px,5vw,24px)}
  .sticky-cta-price b{font-size:15px}
  .sticky-cta .btn{font-size:14.5px;padding:12px 24px}
}
@media(min-width:681px){
  .grid{grid-template-columns:repeat(2,1fr)}
  .spec-rail{grid-template-columns:repeat(4,1fr)}
  .sec-head{flex-direction:row;align-items:flex-end}
  .f-grid{grid-template-columns:1fr 1fr}
  .specs{grid-template-columns:repeat(4,1fr)}
  .specs div:nth-child(2){border-right:1px solid var(--line)}
  .a-row{align-items:center}
}
/* dari tablet ke atas, panel harga di alur normal sudah cukup dekat —
   sticky bar & penambahan tap-target ala mobile tak diperlukan lagi */
@media(min-width:768px){
  .sticky-cta{display:none}
  .panel-cta.has-sticky-twin{display:block}
  .detail{padding-bottom:88px}
  .toast{bottom:24px}
  .m-close{width:34px;height:34px}
  .g-arrow{width:40px;height:40px}
  .lb-close{width:42px;height:42px}
  .photo-strip .rm{width:22px;height:22px;font-size:11px}
  .thumbs button{width:78px;height:60px}
  /* Filter kini tombol → drawer di SEMUA ukuran (dua galeri carousel tak cocok
     dengan sidebar). Drawer tetap aktif di desktop. */
  .rcard{width:172px}
}
@media(min-width:1021px){
  .grid{grid-template-columns:repeat(3,1fr)}
  .feature{grid-template-columns:1fr 1fr;gap:clamp(44px,6vw,88px)}
  .feature.flip .feature-media-slide{order:2}
  .detail-grid{grid-template-columns:7fr 5fr}
  .panel{position:sticky}
  .hero{min-height:92vh;min-height:92svh;min-height:92dvh;padding-top:140px}
  /* teks kiri, model 3D kanan; kolom model diberi porsi sedikit lebih besar.
     align-items:stretch → kolom model memanjang setinggi kolom teks, jadi
     bingkai model sepadan dengan tinggi section teks (heading → tombol). */
  .hero-main{grid-template-columns:1fr 1.2fr;gap:clamp(36px,4vw,56px);align-items:stretch}
  .hero-copy{max-width:560px;align-self:center}
  /* Bingkai model diperluas: ikut tinggi kolom teks TAPI dengan lantai lebih
     tinggi (520), plus kolom model lebih lebar (1.2fr). Bersama radius kamera
     100% (framing bola-batas penuh) → motor besar tapi TIDAK terpotong di sudut
     mana pun saat berputar, termasuk tampak samping yang paling panjang. */
  .hero-embed-frame{aspect-ratio:auto;min-height:520px}
  .spec-rail{max-width:100%}
}
/* layar sempit: sembunyikan label "MARKET" di logo supaya search bar & tombol
   Masuk tetap muat tanpa memicu horizontal scroll di HP kecil (≤560px) */
@media(max-width:560px){
  .logo small{display:none}
  .nav-search{margin:0 10px}
  /* Lokasi kini di dalam menu dropdown dengan label penuh — jadi TIDAK lagi
     dijadikan ikon saja seperti dulu (nav sudah lega berkat hamburger). */
}
@media(prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}
  *{animation-duration:.001s !important;transition-duration:.001s !important}
  .card-media::after{display:none}
}
`

// ---------- Model 3D hero (native <model-viewer>) ----------
// Dulu iframe Sketchfab; diganti karena UI chrome-nya (header, watermark,
// toolbar) tak bisa dibersihkan 100% di akun gratis. Sekarang file .glb lokal
// (public/models/) dirender <model-viewer> — web component resmi Google —
// dengan kendali penuh: tanpa UI apa pun, hanya motor yang berputar pelan.
//
// Perf: pustaka model-viewer (~ratusan KB) DAN file .glb (14 MB) tidak dimuat
// saat load awal. IntersectionObserver menunggu bingkai mendekati layar, baru
// meng-import pustaka secara dinamis (chunk terpisah) lalu memasang viewer.
// Placeholder spinner selama memuat; foto unit sebagai cadangan bila gagal.
//
// CATATAN camera-controls: snippet asli menulis camera-controls="false", tapi
// atribut ini berbasis KEHADIRAN — menyetel "false" pun tetap MENGAKTIFKAN
// kontrol (jadi motor bisa diseret). Untuk showcase murni tanpa interaksi,
// atribut itu justru DIHILANGKAN sepenuhnya.
//
// Atribusi lisensi (WAJIB, jangan dihapus) tetap di LUAR viewer: nama model,
// author "everhard", dan Sketchfab — masing-masing tertaut.
const MODEL_SRC = '/models/harley-davidson-flhrxs.glb'

function HeroModel({ fallbackPhoto }) {
  const frameRef = useRef(null)
  const mvRef = useRef(null)
  const [visible, setVisible] = useState(false)   // sudah dekat viewport?
  const [libReady, setLibReady] = useState(false) // pustaka model-viewer termuat?
  const [state, setState] = useState('loading')   // 'loading' | 'ready' | 'failed'

  // Lazy #1: tunda segalanya sampai bingkai mendekati viewport.
  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect() }
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Lazy #2: setelah terlihat, pastikan dulu file .glb benar-benar ada, BARU
  // import pustaka & pasang viewer — sekaligus menjaga bundel awal ramping.
  //
  // Kenapa di-probe fetch, bukan hanya andalkan event 'error' model-viewer:
  // untuk file yang 404 (lokal, balasannya instan) event error bisa keburu
  // memicu SEBELUM listener terpasang, jadi status tersangkut di "loading".
  // fetch same-origin dengan Range 0-0 (ambil 1 byte) memberi vonis pasti:
  // gagal → cadangan; ada → lanjut. Event 'error' viewer tetap dipertahankan
  // untuk kasus file ADA tapi rusak saat di-decode.
  useEffect(() => {
    if (!visible) return
    let alive = true
    fetch(MODEL_SRC, { headers: { Range: 'bytes=0-0' } })
      .then((res) => {
        res.body?.cancel?.()  // jangan lanjutkan unduhan bila server abaikan Range
        if (!alive) return
        if (!res.ok && res.status !== 206) { setState('failed'); return }
        return import('@google/model-viewer').then(() => { if (alive) setLibReady(true) })
      })
      .catch(() => { if (alive) setState('failed') })
    return () => { alive = false }
  }, [visible])

  // Event dari <model-viewer>: 'load' = model siap, 'error' = gagal (mis. .glb
  // 404 / rusak) → foto cadangan. Keduanya dipancarkan andal, jadi tak perlu
  // timeout tebakan seperti dulu pada iframe.
  useEffect(() => {
    const mv = mvRef.current
    if (!mv) return
    const onLoad = () => setState('ready')
    const onError = () => setState('failed')
    mv.addEventListener('load', onLoad)
    mv.addEventListener('error', onError)
    // Jaga-jaga kalau model sudah keburu selesai sebelum listener terpasang.
    if (mv.loaded) setState('ready')
    return () => { mv.removeEventListener('load', onLoad); mv.removeEventListener('error', onError) }
  }, [libReady])

  return (
    <div className="hero-embed">
      <div className="hero-embed-frame" ref={frameRef}>
        {state === 'failed' ? (
          fallbackPhoto
            ? <img className="hero-embed-fallback" src={fallbackPhoto}
                alt="Motor pilihan Motorell" />
            : <Blueprint />
        ) : (
          <>
            {visible && libReady && (
              <model-viewer
                ref={mvRef}
                src={MODEL_SRC}
                alt="Harley-Davidson FLHRXS Road King Special"
                camera-controls=""
                disable-zoom=""
                disable-pan=""
                interaction-prompt="none"
                auto-rotate=""
                auto-rotate-delay="3000"
                rotation-per-second="15deg"
                camera-orbit="270deg 82deg 100%"
                shadow-intensity="1"
                exposure="1"
                environment-image="neutral"
                style={{ opacity: state === 'ready' ? 1 : 0 }}>
                {/* slot kosong: buang progress-bar bawaan; loader branded kita
                    (spinner di bawah) yang dipakai supaya konsisten & tanpa UI
                    asing. */}
                <div slot="progress-bar" />
              </model-viewer>
            )}
            {state !== 'ready' && (
              <div className="hero-embed-ph" aria-hidden="true">
                <span className="hero-embed-spinner" />
                <span>Memuat model 3D…</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ---------- Modal login / daftar ----------
function AuthModal({ onClose, onDone, toast }) {
  const [mode, setMode] = useState('in')
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')

  async function submit(e) {
    e.preventDefault()
    setErr(''); setInfo(''); setBusy(true)
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pass })
        if (error) throw error
        toast('Berhasil masuk')
        onDone()
      } else {
        const { data, error } = await supabase.auth.signUp({
          email, password: pass, options: { data: { full_name: name || 'Pengguna' } },
        })
        if (error) throw error
        if (data.session) { toast('Akun dibuat, kamu sudah masuk'); onDone() }
        else setInfo('Akun dibuat. Cek email kamu untuk link konfirmasi, lalu masuk di sini.')
      }
    } catch (ex) {
      setErr(ex.message || 'Gagal memproses. Coba lagi.')
    } finally { setBusy(false) }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="m-head">
          <div><h3>{mode === 'in' ? 'Masuk' : 'Buat akun'}</h3>
            <span className="sub">Untuk booking DP unit</span></div>
          <button className="m-close" onClick={onClose} aria-label="Tutup">✕</button>
        </div>
        <div className="m-body">
          <div className="switcher">
            <button type="button" className={mode === 'in' ? 'on' : ''} onClick={() => setMode('in')}>Masuk</button>
            <button type="button" className={mode === 'up' ? 'on' : ''} onClick={() => setMode('up')}>Daftar</button>
          </div>
          <form onSubmit={submit}>
            <div className="f-grid">
              {mode === 'up' && (
                <div className="field full">
                  <label htmlFor="au-name">Nama</label>
                  <input id="au-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama lengkap" required />
                </div>
              )}
              <div className="field full">
                <label htmlFor="au-email">Email</label>
                <input id="au-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="kamu@email.com" required />
              </div>
              <div className="field full">
                <label htmlFor="au-pass">Password</label>
                <input id="au-pass" type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Minimal 6 karakter" minLength={6} required />
              </div>
            </div>
            {err && <p className="f-err">{err}</p>}
            {info && <p className="f-info">{info}</p>}
            <div className="m-actions">
              <button className="btn btn-accent btn-full" disabled={busy}>
                {busy ? 'Memproses…' : mode === 'in' ? 'Masuk' : 'Buat akun'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// ---------- Modal booking DP (QRIS) ----------
// ---------- Transisi "handoff" ke WhatsApp: loading → logo, blur-to-focus ----------
// (pola dari video referensi animasi: spinner memudar jadi logo brand dengan
// latar belakang blur, dipakai sebagai momen serah-terima ke WhatsApp CS)
function WaHandoff({ show }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div className="wa-handoff" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          exit={{ opacity: 0 }} transition={{ duration: 0.3 }} aria-hidden="true">
          <motion.span className="wa-handoff-spinner"
            initial={{ opacity: 1, scale: 1 }} animate={{ opacity: 0, scale: 0.7 }}
            transition={{ delay: 0.45, duration: 0.35 }} />
          <motion.div className="wa-handoff-logo"
            initial={{ opacity: 0, scale: 0.92, filter: 'blur(10px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            transition={{ delay: 0.5, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
            MOTORELL<i>●</i>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function BookingModal({ listing, warranty, onClose, toast }) {
  const [step, setStep] = useState('confirm') // confirm -> qr -> paid
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [pay, setPay] = useState(null)
  const [qrImg, setQrImg] = useState(null)
  const chanRef = useRef(null)
  const pollRef = useRef(null)
  const { left, text: timerText } = useCountdown(pay ? pay.expires_at : null)

  useEffect(() => () => cleanup(), [])
  function cleanup() {
    if (chanRef.current) { supabase.removeChannel(chanRef.current); chanRef.current = null }
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  function markPaid() {
    cleanup()
    setStep('paid')
    toast('DP diterima — unit terkunci untukmu')
  }

  async function createPayment() {
    setBusy(true); setErr('')
    try {
      const data = await invokeCreatePayment(listing.id, warranty.code)
      setPay(data)
      if (data.qr_string) {
        const url = await QRCode.toDataURL(data.qr_string, {
          width: 520, margin: 1, color: { dark: '#111114', light: '#ffffff' },
        })
        setQrImg(url)
      }
      setStep('qr')
      chanRef.current = supabase
        .channel('bk-' + data.booking_code)
        .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'bookings', filter: 'code=eq.' + data.booking_code },
          (payload) => { if (payload.new && payload.new.status === 'paid') markPaid() })
        .subscribe()
      pollRef.current = setInterval(async () => {
        const { data: b } = await supabase.from('bookings')
          .select('status').eq('code', data.booking_code).maybeSingle()
        if (b && b.status === 'paid') markPaid()
      }, 8000)
    } catch (ex) {
      setErr(ex.message)
    } finally { setBusy(false) }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="m-head">
          <div><h3>Booking DP</h3><span className="sub">{listing.title}</span></div>
          <button className="m-close" onClick={onClose} aria-label="Tutup">✕</button>
        </div>
        <div className="m-body">
          {step === 'confirm' && (
            <>
              <div className="rows">
                <div className="row"><span>Harga unit</span><b>{rupiah(listing.price)}</b></div>
                <div className="row"><span>{warranty.name}<small>dibayar saat pelunasan</small></span><b>{warranty.price ? rupiah(warranty.price) : 'Termasuk'}</b></div>
                <div className="row hl"><span>DP kunci unit<small>Book melalui Contact Kami</small></span><b>{rupiah(DP_FIXED)}</b></div>
              </div>
              <p className="fine">DP {rupiah(DP_FIXED)} mengunci unit selama 3 hari untuk pelunasan dan
                serah terima. DP direfund 100% apabila kondisi unit tidak sesuai deskripsi yang tercantum.</p>
              {err && <p className="f-err">{err}</p>}
              <div className="m-actions">
                <button className="btn btn-accent btn-full" onClick={createPayment} disabled={busy}>
                  {busy ? 'Membuat kode QRIS…' : 'Buat kode QRIS'}
                </button>
                <button className="btn btn-ghost btn-full" onClick={onClose}>Batal</button>
              </div>
            </>
          )}

          {step === 'qr' && pay && (
            <>
              <span className="tag-qris">● QRIS — kode booking {pay.booking_code}</span>
              <div className="qr-tile">
                {qrImg
                  ? <img src={qrImg} alt={'Kode QRIS untuk ' + rupiah(pay.dp_amount)} />
                  : pay.qr_url
                    ? <img src={pay.qr_url} alt="Kode QRIS" />
                    : <p style={{ color: '#111114', padding: 20 }}>QR tidak tersedia</p>}
              </div>
              <p className="qr-amount">{rupiah(pay.dp_amount)}</p>
              <p className="qr-timer">{left > 0
                ? <>Selesaikan dalam <b>{timerText}</b></>
                : <b>Kode kedaluwarsa — tutup dan ulangi</b>}</p>
              <div className="waiting"><span className="dotp" />Menunggu pembayaran… status berubah otomatis</div>
              <p className="m-note">Scan dengan GoPay, OVO, DANA, ShopeePay, atau m-banking apa pun yang mendukung QRIS.</p>
              <div className="m-actions">
                <button className="btn btn-ghost btn-full" onClick={onClose}>Tutup</button>
              </div>
            </>
          )}

          {step === 'paid' && pay && (
            <>
              <div className="ok-mark"><svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 7" /></svg></div>
              <h4 className="ok-title">DP diterima</h4>
              <p className="ok-sub">{listing.title} kini terkunci atas namamu.</p>
              <div className="rows">
                <div className="row"><span>Kode booking</span><b>{pay.booking_code}</b></div>
                <div className="row"><span>Jumlah DP</span><b>{rupiah(pay.dp_amount)}</b></div>
                <div className="row"><span>Perlindungan dipilih</span><b>{warranty.name}</b></div>
                <div className="row"><span>Status</span><b><span className="chip-ok">LUNAS DP</span></b></div>
              </div>
              <p className="m-note">Tim Motorell akan menghubungimu lewat WhatsApp untuk jadwal pelunasan
                dan serah terima. Simpan kode booking di atas.</p>
              <div className="m-actions">
                <button className="btn btn-accent btn-full" onClick={onClose}>Selesai</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------- Form tambah / edit unit (admin) ----------
// Nama field dalam bahasa manusia untuk pesan "gagal dideteksi".
const FIELD_LABEL = {
  brand: 'Merek', model: 'Model', year: 'Tahun',
  price: 'Harga', mileage_km: 'Odometer', description: 'Deskripsi',
}

function UnitForm({ initial, onClose, onSaved, toast }) {
  const editing = Boolean(initial && initial.id)
  const [f, setF] = useState({
    brand: initial?.brand || '', model: initial?.model || '',
    year: initial?.year || new Date().getFullYear(),
    mileage_km: initial?.mileage_km ?? 0, color: initial?.color || '',
    price: initial?.price || '', grade: initial?.grade || 'A',
    description: initial?.description || '', known_issues: initial?.known_issues || '',
    status: initial?.status || 'published',
  })
  const [photos, setPhotos] = useState(Array.isArray(initial?.photos) ? initial.photos : [])
  const [selectedModParts, setSelectedModParts] = useState([]);
  const [allModParts, setAllModParts] = useState([]);
  const [upMsg, setUpMsg] = useState('')
  const [prog, setProg] = useState(null)      // {done,total} saat mengunggah
  const [caption, setCaption] = useState('')
  const [autoKeys, setAutoKeys] = useState(new Set())   // field hasil auto-isi
  const [missKeys, setMissKeys] = useState(new Set())   // field yang gagal diparse
  const [nett, setNett] = useState(false)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef(null)
  const slugRef = useRef(initial?.slug ||
    (slugify((f.brand || 'unit') + ' ' + (f.model || '') + ' ' + f.year) + '-' + Math.random().toString(36).slice(2, 6)))

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))

  useEffect(() => {
    async function loadModPartsData() {
      const { data: allParts, error: allPartsError } = await supabase.from('mod_parts').select('*');
      if (allPartsError) {
        toast('Error loading modification parts: ' + allPartsError.message);
        return;
      }
      setAllModParts(allParts || []);

      if (editing && initial?.id) {
        const { data: motorParts, error: motorPartsError } = await supabase.from('motor_mod_parts').select('mod_part_id').eq('motor_id', initial.id);
        if (motorPartsError) {
          toast('Error loading motor modification parts: ' + motorPartsError.message);
          return;
        }
        setSelectedModParts(motorParts.map(mp => mp.mod_part_id));
      }
    }
    loadModPartsData();
  }, [editing, initial?.id, toast]);

  async function handleFiles(picked) {
    const all = Array.from(picked || [])
    if (!all.length) return
    setErr('')

    // Tiap file yang ditolak DILAPORKAN alasannya. Menyaring diam-diam bikin
    // admin mengira fotonya terunggah padahal tidak pernah sampai.
    const skipped = []
    const okType = all.filter((x) => {
      if (ALLOWED_PHOTO_TYPES.includes(x.type)) return true
      skipped.push(x.name + ' (format ' + (x.type || 'tidak dikenal') + ')')
      return false
    })
    const okSize = okType.filter((x) => {
      if (x.size <= MAX_PHOTO_MB * 1024 * 1024) return true
      skipped.push(x.name + ' (' + (x.size / 1048576).toFixed(1) + 'MB)')
      return false
    })

    const remaining = MAX_PHOTOS - photos.length
    if (remaining <= 0) {
      setErr('Maksimal ' + MAX_PHOTOS + ' foto per unit sudah tercapai. Hapus salah satu foto dulu untuk menambah yang baru.')
      return
    }
    const batch = okSize.slice(0, remaining)
    const notes = []
    if (skipped.length) notes.push('Dilewati — hanya JPG/PNG/WEBP maks ' + MAX_PHOTO_MB + 'MB: ' + skipped.join(', '))
    if (okSize.length > remaining) {
      notes.push('Maksimal ' + MAX_PHOTOS + ' foto per unit — hanya ' + remaining + ' foto pertama yang diunggah.')
    }
    if (notes.length) setErr(notes.join(' · '))
    if (!batch.length) return

    if (!editing) {
      slugRef.current = slugify((f.brand || 'unit') + ' ' + (f.model || '') + ' ' + f.year) + '-' + slugRef.current.slice(-4)
    }

    // Progres dihitung per FILE SELESAI, bukan per byte: supabase-js v2 tidak
    // memancarkan event progres untuk Storage, jadi bar per-byte hanya akan
    // jadi animasi bohongan. "foto ke-n dari m" itu jujur dan tetap berguna.
    console.info('[UPLOAD] Mulai —', batch.length, 'foto')
    setProg({ done: 0, total: batch.length })
    for (let i = 0; i < batch.length; i++) {
      setUpMsg('Mengunggah foto ' + (i + 1) + ' dari ' + batch.length + '…')
      try {
        const blob = await compressImage(batch[i])
        const path = slugRef.current + '/' + Date.now() + '-' + i + '.jpg'
        const { error } = await supabase.storage.from('unit-photos')
          .upload(path, blob, { contentType: 'image/jpeg' })
        if (error) throw error
        const { data } = supabase.storage.from('unit-photos').getPublicUrl(path)
        setPhotos((p) => [...p, data.publicUrl])
        setProg({ done: i + 1, total: batch.length })
      } catch (ex) {
        setErr('Gagal mengunggah foto: ' + (ex.message || 'coba lagi'))
        break
      }
    }
    console.info('[UPLOAD] Selesai')
    setUpMsg('')
    setProg(null)
  }

  // ---------- Parser caption ----------
  // Hasil parse TIDAK langsung disimpan — ia mengisi field form supaya admin
  // bisa memeriksa & mengoreksi dulu. Field yang berhasil terisi ditandai hijau,
  // yang gagal ditandai kuning selama masih kosong.
  function runParse() {
    const { fields, missing, nett } = parseCaption(caption)
    // `auto` DIHITUNG DI LUAR updater setF. Sempat dibangun di dalamnya dengan
    // auto.push() lalu dibaca di baris setAutoKeys berikutnya — dan selalu
    // kosong, karena React menjalankan updater-nya belakangan (di StrictMode
    // malah dua kali, jadi isinya dobel). Akibatnya penanda hijau tidak pernah
    // muncul walau field-nya benar-benar terisi.
    // Sisa caption → Deskripsi, BUKAN "Catatan kurasi": kolom itu khusus
    // minus/cacat, dan menaruh "kondisi istimewa" di sana jelas keliru.
    const keys = ['brand', 'model', 'year', 'price', 'mileage_km', 'description']
    const auto = keys.filter((k) => fields[k] !== null && fields[k] !== '')
    setF((p) => {
      const next = { ...p }
      for (const k of auto) next[k] = fields[k]
      return next
    })
    setAutoKeys(new Set(auto))
    setMissKeys(new Set(missing))
    setNett(nett)
    console.info('[PARSE] terisi:', auto.join(', ') || '(tidak ada)', '| gagal:', missing.join(', ') || '(tidak ada)')
  }

  // Kelas penanda: hijau = hasil auto-isi; kuning = gagal dideteksi DAN masih
  // kosong (jadi peringatannya hilang sendiri begitu admin mengetiknya).
  const mark = (k) => {
    if (missKeys.has(k) && !String(f[k] ?? '').trim()) return ' warn'
    if (autoKeys.has(k)) return ' ok'
    return ''
  }

  // urutan foto: index 0 = sampul etalase
  const dragFrom = useRef(null)
  const movePhoto = (from, to) => {
    if (from === null || from === undefined || from === to) return
    setPhotos((p) => {
      const n = [...p]
      const [m] = n.splice(from, 1)
      n.splice(to, 0, m)
      return n
    })
  }

  async function save(e) {
    e.preventDefault()
    setErr('')
    if (!f.brand || !f.model || !f.price) { setErr('Merek, model, dan harga wajib diisi.'); return }
    setBusy(true)
    let listingId = initial?.id;

    // payload dari state form. Blok ini sempat hilang saat logika mod-parts
    // ditambahkan ke save(), menyisakan referensi `payload` tanpa definisi →
    // "payload is not defined" saat simpan/edit unit. title diturunkan dari
    // brand + model + tahun; kolomnya cocok dengan tabel `listings`.
    const payload = {
      brand: f.brand.trim(), model: f.model.trim(),
      title: (f.brand + ' ' + f.model + ' ' + f.year).replace(/\s+/g, ' ').trim(),
      year: Number(f.year), mileage_km: Number(f.mileage_km) || 0,
      color: f.color.trim() || null, price: Number(f.price),
      grade: f.grade, description: f.description.trim() || null,
      known_issues: f.known_issues.trim() || null,
      photos, status: f.status,
    }

    // Save/Update main listing
    try {
      if (editing) {
        if (f.status === 'published' && !initial.published_at) payload.published_at = new Date().toISOString()
        const { error } = await supabase.from('listings').update(payload).eq('id', initial.id)
        if (error) throw error
        toast('Unit diperbarui')
      } else {
        payload.slug = slugRef.current
        if (f.status === 'published') payload.published_at = new Date().toISOString()
        const { data, error } = await supabase.from('listings').insert(payload).select('id').single()
        if (error) throw error
        listingId = data.id;
        toast(f.status === 'published' ? 'Unit tayang di etalase' : 'Unit disimpan sebagai draft')
      }
    } catch (ex) {
      setErr(ex.message || 'Gagal menyimpan unit');
      setBusy(false);
      return;
    }

    // Save modification parts
    try {
      // First, delete existing relationships
      await supabase.from('motor_mod_parts').delete().eq('motor_id', listingId);

      // Then, insert new relationships
      const modPartInserts = selectedModParts.map(partId => ({
        motor_id: listingId,
        mod_part_id: partId
      }));
      if (modPartInserts.length > 0) {
        const { error } = await supabase.from('motor_mod_parts').insert(modPartInserts);
        if (error) throw error;
      }
    } catch (ex) {
      setErr(ex.message || 'Gagal menyimpan part modifikasi motor');
      setBusy(false);
      return;
    }

    // slug dioper balik supaya AdminView bisa menautkan langsung ke unit yang
    // baru tayang — tanpa ini admin harus mencarinya sendiri di daftar.
    onSaved({ slug: editing ? initial.slug : slugRef.current, status: f.status, title: payload.title })
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 'min(1020px,100%)' }}>
        <div className="m-head">
          <div><h3>{editing ? 'Edit unit' : 'Tambah unit ke etalase'}</h3>
            <span className="sub">{editing ? initial.title : 'Data tampil publik — tanpa modal beli'}</span></div>
          <button className="m-close" onClick={onClose} aria-label="Tutup">✕</button>
        </div>
        <div className="m-body">
          <form onSubmit={save}>
            {/* Dua kolom di layar lebar: KIRI foto, KANAN caption + field.
                Di HP keduanya menumpuk dan foto tetap duluan — urutan DOM-nya
                memang sudah foto → form, jadi tidak perlu trik order CSS. */}
            <div className="uf-cols">
            <div className="uf-left">
              <div className="field full uf-photos">
                <label>Foto unit — {photos.length}/{MAX_PHOTOS} (otomatis dikompres sebelum diunggah)</label>
                <div className="photo-strip"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (e.dataTransfer.files && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files)
                  }}>
                  {photos.map((url, i) => (
                    <div className={'ph' + (i === 0 ? ' main' : '')} key={url} draggable
                      onDragStart={() => { dragFrom.current = i }}
                      onDragEnd={() => { dragFrom.current = null }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault(); e.stopPropagation()
                        movePhoto(dragFrom.current, i); dragFrom.current = null
                      }}>
                      <img src={url} alt={'Foto ' + (i + 1)} />
                      {i === 0 && <span className="ph-main-tag">FOTO UTAMA</span>}
                      <button type="button" className="rm" aria-label="Hapus foto"
                        onClick={() => setPhotos((p) => p.filter((u) => u !== url))}>✕</button>
                    </div>
                  ))}
                  {photos.length < MAX_PHOTOS && (
                    <button type="button" className="up-tile" aria-label="Tambah foto"
                      onClick={() => fileRef.current && fileRef.current.click()}>＋</button>
                  )}
                </div>
                <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                  multiple hidden
                  onChange={(e) => { const fl = Array.from(e.target.files || []); e.target.value = ''; handleFiles(fl) }} />
                {prog && (
                  <div className="up-prog">
                    <div className="up-bar"><span style={{ width: (prog.done / prog.total * 100) + '%' }} /></div>
                    <span className="mono">{prog.done}/{prog.total}</span>
                  </div>
                )}
                {upMsg && <p className="f-info">{upMsg}</p>}
                <p className="f-info">Foto pertama = sampul di etalase. Seret thumbnail untuk mengubah urutan,
                  atau jatuhkan file gambar langsung ke area ini. JPG/PNG/WEBP, maks {MAX_PHOTO_MB}MB per foto.</p>
              </div>
            </div>
            <div className="uf-right">
            <div className="cap">
              <label htmlFor="u-cap">Paste Caption Instagram di sini</label>
              <textarea id="u-cap" className="cap-ta" value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder={'YAMAHA XSR 155 2021\nKM 8.500\nHarga 27.800.000 NETT\nKondisi istimewa, pajak hidup, service record lengkap'} />
              <div className="cap-act">
                <button type="button" className="btn btn-ghost btn-sm" disabled={!caption.trim()}
                  onClick={runParse}>Isi otomatis dari caption</button>
                {(autoKeys.size > 0 || missKeys.size > 0) && (
                  <span className="cap-note">
                    {autoKeys.size > 0 && <b className="ok">{autoKeys.size} field terisi otomatis</b>}
                    {missKeys.size > 0 && (
                      <b className="warn">Tidak bisa deteksi otomatis, mohon isi manual: {[...missKeys].map((k) => FIELD_LABEL[k] || k).join(', ')}</b>
                    )}
                    {nett && <b className="ok">Harga terdeteksi NETT</b>}
                  </span>
                )}
              </div>
              <p className="f-info">Hasil deteksi hanya mengisi kolom di bawah — belum tersimpan.
                Periksa &amp; koreksi dulu sebelum menayangkan.</p>
            </div>
            <div className="f-grid">
              <div className={'field' + mark('brand')}><label htmlFor="u-brand">Merek</label>
                <input id="u-brand" value={f.brand} onChange={set('brand')} placeholder="Kawasaki" required /></div>
              <div className={'field' + mark('model')}><label htmlFor="u-model">Model</label>
                <input id="u-model" value={f.model} onChange={set('model')} placeholder="W175 SE" required /></div>
              <div className={'field' + mark('year')}><label htmlFor="u-year">Tahun</label>
                <input id="u-year" type="number" min="1980" max="2030" value={f.year} onChange={set('year')} required /></div>
              <div className={'field' + mark('mileage_km')}><label htmlFor="u-km">Odometer (km) — isi 0 jika belum dicek</label>
                <input id="u-km" type="number" min="0" value={f.mileage_km} onChange={set('mileage_km')} /></div>
              <div className="field"><label htmlFor="u-color">Warna</label>
                <input id="u-color" value={f.color} onChange={set('color')} placeholder="Hitam" /></div>
              <div className={'field' + mark('price')}><label htmlFor="u-price">Harga jual (Rp)</label>
                <input id="u-price" type="number" min="0" value={f.price} onChange={set('price')} placeholder="20800000" required /></div>
              <div className="field"><label htmlFor="u-grade">Grade kurasi</label>
                <select id="u-grade" value={f.grade} onChange={set('grade')}>
                  <option value="S">S — istimewa, seperti baru</option>
                  <option value="A">A — siap pakai</option>
                  <option value="B">B — minus ringan tercatat</option>
                </select></div>
              <div className="field"><label htmlFor="u-status">Status</label>
                <select id="u-status" value={f.status} onChange={set('status')}>
                  <option value="published">Tayang di etalase</option>
                  <option value="draft">Draft (belum tampil)</option>
                </select></div>
              <div className={'field full' + mark('description')}><label htmlFor="u-desc">Deskripsi</label>
                <textarea id="u-desc" value={f.description} onChange={set('description')}
                  placeholder="Kondisi mesin, riwayat servis, kelengkapan dokumen, plat…" /></div>
              <div className="field full"><label htmlFor="u-issues">Catatan kurasi / minus (jujur)</label>
                <textarea id="u-issues" value={f.known_issues} onChange={set('known_issues')}
                  placeholder="Contoh: baret halus di sayap kiri, ban belakang 70%…" /></div>
              <div className="field full">
                <label>Part Modifikasi</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px', marginBottom: '15px' }}>
                  {allModParts.map(part => (
                    <label key={part.id} style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={selectedModParts.includes(part.id)}
                        onChange={() => {
                          setSelectedModParts(prev =>
                            prev.includes(part.id)
                              ? prev.filter(id => id !== part.id)
                              : [...prev, part.id]
                          );
                        }}
                      />
                      {part.name} ({rupiah(part.price)})
                    </label>
                  ))}
                </div>
              </div>
            </div>
            </div>
            </div>
            {err && <p className="f-err">{err}</p>}

            {/* Pratinjau memakai komponen Card YANG SAMA dengan etalase — kalau
                pakai tiruan, yang dilihat admin bisa berbeda dari yang tayang.
                nav dimatikan supaya klik di pratinjau tidak melempar keluar form. */}
            {preview && (
              <div className="prev-wrap">
                <p className="f-info">Beginilah unit ini akan tampil di etalase:</p>
                <div className="prev-card">
                  <Card nav={() => {}} l={{
                    id: 'preview', slug: editing ? initial.slug : slugRef.current,
                    title: ((f.brand || '') + ' ' + (f.model || '') + ' ' + f.year).replace(/\s+/g, ' ').trim() || 'Unit baru',
                    year: f.year, mileage_km: Number(f.mileage_km) || 0,
                    color: f.color, price: Number(f.price) || 0, grade: f.grade,
                    photos, status: f.status, created_at: new Date().toISOString(),
                  }} />
                </div>
              </div>
            )}

            <div className="m-actions m-actions-2">
              <button type="button" className="btn btn-ghost" onClick={() => setPreview((v) => !v)}>
                {preview ? 'Tutup pratinjau' : 'Preview Etalase'}
              </button>
              <button className="btn btn-accent" disabled={busy || Boolean(upMsg)}>
                {busy ? 'Menyimpan…'
                  : editing ? 'Simpan perubahan'
                    : f.status === 'published' ? 'Publish ke Etalase' : 'Simpan draft'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// ---------- Kelola staf (khusus role admin) ----------
const ROLE_LABEL = { admin: 'Admin', kurator: 'Kurator', null: 'Tanpa akses' }

function StaffPanel({ profile, toast }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('profiles')
      .select('*').order('full_name', { ascending: true })
    if (error) { setErr(error.message); setRows([]); return }
    setErr(''); setRows(data || [])
  }, [])
  useEffect(() => { load() }, [load])

  async function setRole(p, role) {
    setBusyId(p.id)
    const { error } = await supabase.from('profiles').update({ role }).eq('id', p.id)
    setBusyId(null)
    if (error) { toast('Gagal ubah akses: ' + error.message); return }
    toast((p.full_name || 'Pengguna') + ' sekarang ' + (ROLE_LABEL[role] || role).toLowerCase())
    load()
  }

  return (
    <div>
      <p className="f-info" style={{ marginBottom: 18 }}>
        Orang baru harus <b>Daftar</b> lewat tombol Masuk di navbar dulu (email + password) sebelum
        namanya muncul di sini. Setelah itu, atur akses lewat daftar di bawah — tidak perlu SQL manual lagi.
      </p>

      {rows === null && !err && <p style={{ color: 'var(--muted)' }}>Memuat…</p>}
      {err && (
        <div className="empty" style={{ textAlign: 'left' }}>
          Tidak bisa memuat daftar pengguna: <span className="mono">{err}</span><br />
          Kemungkinan kebijakan RLS tabel <span className="mono">profiles</span> belum mengizinkan admin
          melihat/mengubah baris pengguna lain. Tanyakan ke asisten teknismu untuk menambahkan policy tersebut.
        </div>
      )}
      {rows && rows.length === 0 && !err && (
        <div className="empty">Belum ada pengguna terdaftar selain kamu.</div>
      )}
      {rows && rows.length > 0 && (
        <div className="a-list">
          {rows.map((p) => {
            const isSelf = p.id === profile.id
            return (
              <div className="a-row" key={p.id}>
                <div className="a-info">
                  <b>{p.full_name || 'Tanpa nama'}{isSelf ? ' (kamu)' : ''}</b>
                  {/* Tabel profiles tidak punya kolom email (dicek langsung ke DB),
                      jadi tampilkan potongan user id — bukan p.email yang selalu
                      undefined. Peran ditandai di tombol aksi di sebelah kanan. */}
                  <span className="mono" style={{ fontSize: 11.5 }}>{String(p.id).slice(0, 8)}… · {ROLE_LABEL[p.role] || p.role}</span>
                </div>
                <div className="a-actions">
                  {isSelf ? (
                    <span className="f-info" style={{ margin: 0 }}>
                      {ROLE_LABEL[p.role] || p.role} — minta admin lain untuk mengubah aksesmu sendiri</span>
                  ) : (
                    ['admin', 'kurator', null].map((r) => (
                      <button key={String(r)} type="button"
                        className={'btn btn-sm ' + (p.role === r ? 'btn-dark' : 'btn-ghost')}
                        disabled={busyId === p.id}
                        onClick={() => setRole(p, r)}>
                        {ROLE_LABEL[r]}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------- Review Titip Jual (khusus admin) ----------
const TITIP_FILTERS = [
  { code: 'pending', label: 'Perlu review' },
  { code: 'approved', label: 'Disetujui' },
  { code: 'rejected', label: 'Ditolak' },
]

function TitipReview({ profile, toast, nav }) {
  const [tab, setTab] = useState('pending')
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [openId, setOpenId] = useState(null)   // baris yang detail-nya dibuka

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('titip_jual_units')
      .select('*').order('created_at', { ascending: false })
    if (error) { setErr(error.message); setRows([]); return }
    setErr(''); setRows(data || [])
  }, [])
  useEffect(() => { load() }, [load])

  async function review(row, status) {
    let rejection_reason = null
    if (status === 'rejected') {
      rejection_reason = window.prompt('Alasan penolakan (wajib, akan terlihat penjual):', '')
      if (!rejection_reason || !rejection_reason.trim()) { toast('Reject dibatalkan — alasan wajib diisi'); return }
    }
    setBusyId(row.id)
    const { error } = await supabase.from('titip_jual_units').update({
      status, reviewed_by: profile.id, reviewed_at: new Date().toISOString(),
      rejection_reason,
    }).eq('id', row.id)
    setBusyId(null)
    if (error) { toast('Gagal: ' + error.message); return }
    toast(status === 'approved' ? 'Unit titip jual disetujui & tayang' : 'Submission ditolak')
    load()
  }

  const shown = (rows || []).filter((r) => r.status === tab)

  return (
    <div>
      <div className="a-tabs" style={{ marginTop: 4 }}>
        {TITIP_FILTERS.map((t) => {
          const n = (rows || []).filter((r) => r.status === t.code).length
          return (
            <button key={t.code} type="button" className={tab === t.code ? 'on' : ''}
              onClick={() => setTab(t.code)}>{t.label}{n ? ' (' + n + ')' : ''}</button>
          )
        })}
      </div>

      {rows === null && !err && <p style={{ color: 'var(--muted)' }}>Memuat…</p>}
      {err && (
        <div className="empty" style={{ textAlign: 'left' }}>
          Tidak bisa memuat titip jual: <span className="mono">{err}</span><br />
          Kemungkinan tabel <span className="mono">titip_jual_units</span> belum dibuat — jalankan
          migrasi <span className="mono">0003_titip_jual.sql</span>.
        </div>
      )}
      {rows && !err && shown.length === 0 && (
        <div className="empty">Tidak ada submission {TITIP_FILTERS.find((t) => t.code === tab).label.toLowerCase()}.</div>
      )}
      {shown.length > 0 && (
        <div className="a-list">
          {shown.map((r) => (
            <div key={r.id}>
              <div className="a-row">
                <div className="a-thumb">
                  {Array.isArray(r.photos) && r.photos[0]
                    ? <img src={r.photos[0]} alt="" />
                    : <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>NO FOTO</span>}
                </div>
                <div className="a-info">
                  <b>{[r.merek, r.model, r.tahun].filter(Boolean).join(' ')}</b>
                  <span>{rupiah(r.harga_diinginkan)} · {r.kondisi || '—'} · {(r.photos || []).length} foto · {r.seller_name} ({r.seller_phone})</span>
                </div>
                <div className="a-actions">
                  <button className="btn btn-ghost btn-sm"
                    onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                    {openId === r.id ? 'Tutup' : 'Detail'}</button>
                  {r.status === 'pending' && (
                    <>
                      <button className="btn btn-sm btn-dark" disabled={busyId === r.id}
                        onClick={() => review(r, 'approved')}>Approve</button>
                      <button className="btn btn-sm btn-ghost" disabled={busyId === r.id}
                        onClick={() => review(r, 'rejected')}>Reject</button>
                    </>
                  )}
                  {r.status === 'approved' && (
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => nav('#/unit/tj-' + String(r.id).slice(0, 8))}>Lihat →</button>
                  )}
                </div>
              </div>
              {openId === r.id && (
                <div className="titip-detail">
                  <div className="titip-detail-photos">
                    {(r.photos || []).map((u, i) => <img key={i} src={u} alt={'Foto ' + (i + 1)} />)}
                  </div>
                  <dl>
                    <div><dt>Penjual</dt><dd>{r.seller_name} · {r.seller_phone}{r.seller_email ? ' · ' + r.seller_email : ''}</dd></div>
                    <div><dt>Kendaraan</dt><dd>{[r.merek, r.model, r.tahun].join(' ')} · {r.odometer ? fmt(r.odometer) + ' km' : 'km —'} · {r.warna || '—'} · plat {r.plat_nomor || '—'}</dd></div>
                    <div><dt>Harga</dt><dd>{rupiah(r.harga_diinginkan)} · kondisi {r.kondisi || '—'}</dd></div>
                    {r.deskripsi && <div><dt>Deskripsi</dt><dd>{r.deskripsi}</dd></div>}
                    {r.kelengkapan && <div><dt>Kelengkapan</dt><dd>{r.kelengkapan}</dd></div>}
                    {r.rejection_reason && <div><dt>Alasan tolak</dt><dd>{r.rejection_reason}</dd></div>}
                  </dl>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- Panel admin ----------
function AdminPanel({ profile, toast, nav }) {
  const [view, setView] = useState('units') // units | staff
  const [rows, setRows] = useState(null)
  const [form, setForm] = useState(null) // null | {} (baru) | listing (edit)
  const [done, setDone] = useState(null) // {slug,status,title} unit yang barusan disimpan
  const [modPartForm, setModPartForm] = useState(null); // null | {} (baru) | mod_part (edit)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('listings')
      .select('*').order('created_at', { ascending: false })
    if (!error) setRows(data || [])
  }, [])
  useEffect(() => { load() }, [load])

  async function setStatus(l, status) {
    const payload = { status }
    if (status === 'published' && !l.published_at) payload.published_at = new Date().toISOString()
    if (status === 'sold') payload.sold_at = new Date().toISOString()
    const { error } = await supabase.from('listings').update(payload).eq('id', l.id)
    if (error) { toast('Gagal: ' + error.message); return }
    const msg = status === 'sold' ? 'Unit ditandai terjual — hilang dari etalase'
      : status === 'published' ? 'Unit dikembalikan ke etalase'
        : status === 'draft' ? 'Unit ditarik ke draft' : 'Status diperbarui'
    toast(msg); load()
  }

  const canManageStaff = profile.role === 'admin'

  return (
    <section className="admin">
      <div className="container">
        <div className="a-head">
          <div>
            <p className="kicker">Panel admin — {profile.full_name}</p>
            <h1>{view === 'staff' ? 'Kelola staf' : 'Kelola etalase'}</h1>
          </div>
          {view === 'units' && (
            <button className="btn btn-accent" onClick={() => setForm({})}>+ Tambah unit</button>)}
        </div>

        {canManageStaff && (
          <div className="a-tabs">
            <button type="button" className={view === 'units' ? 'on' : ''} onClick={() => setView('units')}>Etalase</button>
            <button type="button" className={view === 'staff' ? 'on' : ''} onClick={() => setView('staff')}>Staf</button>
            <button type="button" className={view === 'titip' ? 'on' : ''} onClick={() => setView('titip')}>Titip Jual</button>
            <button type="button" className={view === 'archive' ? 'on' : ''} onClick={() => setView('archive')}>Arsip</button>
            <button type="button" className={view === 'mod_parts' ? 'on' : ''} onClick={() => setView('mod_parts')}>Part Modifikasi</button>
          </div>
        )}

        {view === 'staff' && canManageStaff && <StaffPanel profile={profile} toast={toast} />}

        {view === 'titip' && canManageStaff && <TitipReview profile={profile} toast={toast} nav={nav} />}

        {view === 'archive' && <ArchiveTab />}

        {view === 'mod_parts' && canManageStaff && <ModPartPanel toast={toast} />}

        {view === 'units' && (
          <>
            {/* Konfirmasi + tautan langsung ke unit yang baru disimpan. Tanpa ini
                admin harus mencari sendiri unitnya di daftar untuk memastikan
                hasilnya benar. Unit draft tidak punya halaman publik, jadi
                tautannya hanya muncul untuk yang berstatus tayang. */}
            {done && (
              <div className="a-done">
                <span>
                  <b>{done.status === 'published' ? 'Tayang di etalase' : 'Tersimpan sebagai draft'}</b>
                  {' — ' + done.title}
                </span>
                <span className="a-done-act">
                  {done.status === 'published' && (
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => nav('#/unit/' + done.slug)}>Lihat halaman unit →</button>
                  )}
                  <button className="a-done-x" onClick={() => setDone(null)} aria-label="Tutup">✕</button>
                </span>
              </div>
            )}
            {rows === null && <p style={{ color: 'var(--muted)' }}>Memuat…</p>}
            {rows && rows.length === 0 && (
              <div className="empty">Belum ada unit. Klik "Tambah unit" untuk mengisi etalase pertamamu.</div>
            )}
            {rows && rows.length > 0 && (
              <div className="a-list">
                {rows.map((l) => (
                  <div className="a-row" key={l.id}>
                    <div className="a-thumb">
                      {Array.isArray(l.photos) && l.photos[0]
                        ? <img src={l.photos[0]} alt="" />
                        : <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>NO FOTO</span>}
                    </div>
                    <div className="a-info">
                      <b>{l.title}</b>
                      <span>{l.year} · {l.mileage_km ? fmt(l.mileage_km) + ' km' : 'km —'} · grade {l.grade} · {Array.isArray(l.photos) ? l.photos.length : 0} foto</span>
                    </div>
                    <span className="a-price">{rupiah(l.price)}</span>
                    <span className={'st ' + l.status}>{STATUS_LABEL[l.status] || l.status}</span>
                    <div className="a-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => setForm(l)}>Edit</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => nav('#/unit/' + l.slug)}>Lihat</button>
                      {l.status === 'draft' && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setStatus(l, 'published')}>Tayangkan</button>)}
                      {l.status === 'published' && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setStatus(l, 'draft')}>Tarik</button>)}
                      {(l.status === 'booked' || l.status === 'sold') && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setStatus(l, 'published')}>Kembalikan ke etalase</button>)}
                      {(l.status === 'published' || l.status === 'booked') && (
                        <button className="btn btn-ghost btn-sm"
                          onClick={() => { if (confirm('Tandai ' + l.title + ' sebagai TERJUAL? Unit akan hilang dari etalase.')) setStatus(l, 'sold') }}>
                          Tandai terjual</button>)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      {form !== null && (
        <UnitForm initial={form.id ? form : null} toast={toast}
          onClose={() => setForm(null)}
          onSaved={(r) => { setForm(null); load(); setDone(r || null) }} />
      )}
    </section>
  )
}

// ---------- Tilt 3D + parallax yang terikat posisi scroll (bukan cuma
// muncul sekali) — dipakai di foto feature block supaya transisi scroll
// terasa punya kedalaman/berkelas, bukan cuma fade datar. Kode asli
// (Framer Motion useScroll/useTransform), ringan karena murni transform
// CSS yang di-drive nilai scroll, tanpa re-render React tiap frame. ----
function TiltMedia({ children, className = '' }) {
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const rotateX = useTransform(scrollYProgress, [0, 0.5, 1], [7, 0, -7])
  const y = useTransform(scrollYProgress, [0, 1], [22, -22])
  if (prefersReduced()) return <div ref={ref} className={className}>{children}</div>
  return (
    <motion.div ref={ref} className={className}
      style={{ rotateX, y, transformPerspective: 1200 }}>
      {children}
    </motion.div>
  )
}

// ---------- Reveal: fade + slide-up halus saat elemen masuk viewport ----------
// `once` (default false): perilaku lama = memudar-masuk tiap kali elemen masuk
// viewport lagi (dipakai section fitur/lokasi yang memang ingin re-trigger).
// once=true = muncul SEKALI lalu tetap tampil selamanya — dipakai etalase, di
// mana kartu yang "hilang lalu muncul lagi" saat scroll naik-turun mengganggu.
function Reveal({ children, className = '', style, once = false }) {
  const ref = useRef(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (prefersReduced()) { setShown(true); return }
    const io = new IntersectionObserver(([entry]) => {
      if (once) {
        if (entry.isIntersecting) { setShown(true); io.disconnect() }
      } else {
        setShown(entry.isIntersecting)
      }
    }, { threshold: 0.16 })
    io.observe(el)
    return () => io.disconnect()
  }, [once])
  return (
    <div ref={ref} className={(className + ' reveal' + (shown ? ' shown' : '')).trim()} style={style}>
      {children}
    </div>
  )
}

// ---------- Fade-in bertahap saat masuk viewport (Framer Motion) ----------
// Reveal (di atas) memakai kelas CSS dan dipertahankan karena animasi .feature
// bergantung padanya. FadeIn di bawah ini untuk elemen yang perlu muncul
// BERURUTAN (heading → subjudul → daftar), yang lebih enak diatur lewat
// stagger Framer Motion ketimbang menghitung transition-delay manual.
// once:false — animasi diputar ULANG tiap kali elemen masuk viewport, bukan
// sekali seumur halaman. Saat elemen keluar layar ia kembali ke 'hidden',
// jadi menggulung naik-turun memutar animasinya lagi.
const fadeParent = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } },
}

// Arah masuk: 'up' (dari bawah), 'down', 'left' (meluncur dari kanan),
// 'right' (dari kiri).
const OFFSET = {
  up: { y: 24, x: 0 },
  down: { y: -24, x: 0 },
  left: { x: 32, y: 0 },
  right: { x: -32, y: 0 },
}

const childVariants = (dir) => ({
  hidden: { opacity: 0, ...(OFFSET[dir] || OFFSET.up) },
  shown: { opacity: 1, x: 0, y: 0, transition: { duration: 0.45, ease: [0.2, 0.7, 0.25, 1] } },
})

// Bungkus sekelompok elemen; anak-anaknya (FadeItem) muncul bergiliran, dan
// mengulang tiap kali blok ini masuk viewport lagi.
function FadeIn({ children, className = '', style, amount = 0.25 }) {
  const ref = useRef(null)
  // margin bawah negatif: animasi mulai sedikit SEBELUM elemen benar-benar
  // sampai, jadi tidak terlihat "telat" saat menggulung cepat.
  const inView = useInView(ref, { once: false, amount, margin: '0px 0px -80px 0px' })
  const reduced = prefersReduced()
  return (
    <motion.div
      ref={ref}
      className={className}
      style={style}
      variants={fadeParent}
      initial={reduced ? 'shown' : 'hidden'}
      animate={reduced || inView ? 'shown' : 'hidden'}>
      {children}
    </motion.div>
  )
}

// Satu langkah dalam antrean stagger induknya.
function FadeItem({ children, className = '', style, as = 'div', direction = 'up' }) {
  const M = motion[as] || motion.div
  return (
    <M className={className} style={style} variants={childVariants(direction)}>
      {children}
    </M>
  )
}

// ---------- Tab detail teknis unit (fade transition antar konten) ----------
const DETAIL_TABS = [
  { id: 'unit', label: 'Tentang unit' },
  { id: 'kurasi', label: 'Catatan kurasi' },
  { id: 'garansi', label: 'Perlindungan' },
]

function DetailTabs({ listing }) {
  const titip = isTitip(listing)
  // Titip jual bukan hasil kurasi Motorell → tanpa tab "Catatan kurasi" &
  // "Perlindungan"; sebagai gantinya tab "Kelengkapan" (dokumen dari penjual).
  const tabs = titip
    ? [{ id: 'unit', label: 'Tentang unit' }, { id: 'kelengkapan', label: 'Kelengkapan' }]
    : DETAIL_TABS
  const [tab, setTab] = useState('unit')
  return (
    <div className="dtabs-wrap">
      <div className="dtabs" role="tablist" aria-label="Detail unit">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
            className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {/* Ganti tab dulu memakai AnimatePresence mode="wait": panel lama keluar
          (dengan geser vertikal) SEBELUM panel baru masuk, jadi tingginya
          runtuh lalu melonjak lagi — itulah "goyang" di mobile.
          Sekarang KETIGA panel selalu dirender dan ditumpuk di sel grid yang
          sama (grid-area 1/1). Tinggi wrapper otomatis mengikuti panel
          TERTINGGI di antara ketiganya — jadi ganti tab tidak pernah mengubah
          tinggi kontainer, berapa pun panjang deskripsi unit ini (tidak perlu
          angka min-height tetap yang menebak-nebak). Panel non-aktif
          disembunyikan dengan visibility (tetap memesan ruang) dan pergantian
          jadi sekadar transisi opacity — nol reflow. */}
      <div className="dtab-body">
        <div className={'dtab-panel' + (tab === 'unit' ? ' on' : '')}
          role="tabpanel" aria-hidden={tab !== 'unit'}>
          <p>{listing.description || 'Deskripsi lengkap menyusul. Hubungi Motorell untuk detail unit ini.'}</p>
        </div>
        {titip ? (
          <div className={'dtab-panel' + (tab === 'kelengkapan' ? ' on' : '')}
            role="tabpanel" aria-hidden={tab !== 'kelengkapan'}>
            {listing.kelengkapan
              ? <p>{listing.kelengkapan}</p>
              : <p className="muted">Kelengkapan dokumen belum dicantumkan penjual — tanyakan langsung via WhatsApp.</p>}
          </div>
        ) : (
          <>
            <div className={'dtab-panel' + (tab === 'kurasi' ? ' on' : '')}
              role="tabpanel" aria-hidden={tab !== 'kurasi'}>
              {listing.known_issues
                ? <p>{listing.known_issues}</p>
                : <p className="muted">Tidak ada minus tercatat — unit ini lolos inspeksi tanpa catatan khusus.</p>}
            </div>
            <div className={'dtab-panel' + (tab === 'garansi' ? ' on' : '')}
              role="tabpanel" aria-hidden={tab !== 'garansi'}>
              <ul className="dtab-warranty">
                {warrantiesForGrade(listing.grade).map((w) => (
                  <li key={w.code}>
                    <b>{w.name}</b>
                    <span>{w.desc}</span>
                    <em>{w.price ? '+' + rupiah(w.price) : 'Termasuk'}</em>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ---------- Halaman detail unit ----------
function DetailView({ listing, nav, onBook }) {
  const [wcode, setWcode] = useState('standard')
  const [selectedModPartIds, setSelectedModPartIds] = useState([]);
  const photos = Array.isArray(listing.photos) ? listing.photos : []
  // listing.mod_parts adalah baris mod_parts itu sendiri (lihat loadListings),
  // jadi kuncinya `id` — BUKAN `mod_part_id` (kolom itu ada di tabel junction).
  // Versi sebelumnya memakai mod_part_id yang selalu undefined, sehingga semua
  // part berbagi kunci yang sama: mencentang satu part mencentang semuanya.
  const availableModParts = listing.mod_parts || [];
  const selectedModParts = availableModParts.filter((part) => selectedModPartIds.includes(part.id));

  // Kategori hanya ditampilkan yang benar-benar punya part, dengan urutan tetap.
  const catsPresent = MOD_CATEGORIES.filter((c) => availableModParts.some((p) => catOf(p) === c));
  const [mcat, setMcat] = useState(null);
  const activeCat = mcat && catsPresent.includes(mcat) ? mcat : catsPresent[0];
  const partsInCat = availableModParts.filter((p) => catOf(p) === activeCat);

  const toggleModPart = (id) =>
    setSelectedModPartIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  // Tugas 7: unit grade B hanya boleh paket Avantgard
  const avail = warrantiesForGrade(listing.grade)
  const warranty = avail.find((w) => w.code === wcode) || avail[0]
  const canBook = listing.status === 'published'
  // Titip jual: TANPA paket perlindungan / DP / booking (eksklusif unit resmi).
  // Panel kanan & CTA-nya diganti total (kontak langsung ke penjual).
  const titip = isTitip(listing)

  const totalModPartsPrice = selectedModParts.reduce((sum, part) => sum + Number(part.price), 0);
  const totalPrice = Number(listing.price) + totalModPartsPrice;

  return (
    <section className="detail">
      <div className="container">
        <a className="back" href="#/" onClick={(e) => { e.preventDefault(); nav('#/') }}>← Kembali ke etalase</a>
        <div className="detail-grid">
          <div>
            <MotorCarousel photos={photos} title={listing.title} selectedModParts={selectedModParts} />
            <DetailTabs listing={listing} />
            {/* Ketentuan DP/hold/refund hanya berlaku untuk unit resmi Motorell. */}
            {!titip && (
              <div className="unit-terms">
                <h4>Ketentuan unit ini</h4>
                <ul>
                  <li><span className="dot">•</span><span>DP flat <b>{rupiah(DP_FIXED)}</b> untuk mengunci unit — bukan persentase harga.</span></li>
                  <li><span className="dot">•</span><span>Masa hold <b>3 hari</b> untuk pelunasan dan serah terima; lewat itu unit bisa ditawarkan kembali.</span></li>
                  <li><span className="dot">•</span><span>DP <b>direfund 100%</b> bila kondisi unit tidak sesuai deskripsi yang tercantum.</span></li>
                  <li><span className="dot">•</span><span>Selengkapnya di <a href="#/kebijakan" onClick={(e) => { e.preventDefault(); nav('#/kebijakan') }}>halaman kebijakan</a>.</span></li>
                </ul>
              </div>
            )}
          </div>

          {titip ? (
          <aside className="panel">
            <p className="stnote titip-note">
              <b>Unit Titip Jual dari Masyarakat.</b> Unit ini dititipkan penjual perorangan,
              belum melalui kurasi & garansi resmi Motorell. Cek kondisi langsung sebelum
              bertransaksi. Motorell hanya menjembatani.
            </p>
            <h1>{listing.title}</h1>
            <p className="price">{rupiah(listing.price)}</p>
            <div className="specs">
              <div><small>Tahun</small><b>{listing.year}</b></div>
              <div><small>Odometer</small><b>{listing.mileage_km ? fmt(listing.mileage_km) + ' km' : '—'}</b></div>
              <div><small>Kondisi</small><b>{listing.kondisi || '—'}</b></div>
              <div><small>Warna</small><b>{listing.color || '—'}</b></div>
            </div>
            <div className="rows">
              <div className="row"><span>Penjual</span><b>{listing.seller_name || '—'}</b></div>
              {listing.plat_nomor && <div className="row"><span>Plat</span><b>{listing.plat_nomor}</b></div>}
            </div>
            <div className="panel-cta has-sticky-twin">
              <a className="btn btn-accent btn-full" href={sellerWaLink(listing)}
                target="_blank" rel="noopener noreferrer">Chat penjual via WhatsApp</a>
              <p className="fine">Kamu akan terhubung langsung ke nomor WhatsApp penjual untuk
                tanya kondisi, nego harga, dan atur COD. Transaksi di luar tanggung jawab Motorell —
                selalu cek fisik & dokumen unit sebelum membayar.</p>
            </div>
          </aside>
          ) : (
          <aside className="panel">
            {listing.status === 'booked' && (
              <p className="stnote warn">Unit sedang di-booking pembeli lain. Bila DP-nya batal, unit tayang kembali otomatis.</p>)}
            {listing.status === 'sold' && (
              <p className="stnote dim">Unit ini sudah terjual.</p>)}
            {listing.status === 'draft' && (
              <p className="stnote dim">Draft — hanya terlihat oleh staf.</p>)}
            <h1>{listing.title}</h1>
            <p className="price">{rupiah(listing.price)}</p>
            <div className="specs">
              <div><small>Tahun</small><b>{listing.year}</b></div>
              <div><small>Odometer</small><b>{listing.mileage_km ? fmt(listing.mileage_km) + ' km' : '—'}</b></div>
              <div><small>Grade</small><b>{listing.grade}</b></div>
              <div><small>Warna</small><b>{listing.color || '—'}</b></div>
            </div>

            <p className="w-title">Pilih paket perlindungan</p>
            <div className="w-opts" role="radiogroup" aria-label="Paket perlindungan">
              {avail.map((w) => (
                <button key={w.code} type="button" role="radio" aria-checked={wcode === w.code}
                  className={'w-opt' + (wcode === w.code ? ' on' : '')}
                  onClick={() => setWcode(w.code)}>
                  <span className="w-dot" />
                  <span className="w-body"><b>{w.name}</b><span>{w.desc}</span></span>
                  <span className="w-price">{w.price ? '+' + rupiah(w.price) : 'Termasuk'}</span>
                </button>
              ))}
            </div>

            {availableModParts.length > 0 && (
              <>
                <p className="w-title" style={{ marginTop: '20px' }}>
                  Pilih part modifikasi
                  {selectedModParts.length > 0 && ' · ' + selectedModParts.length + ' dipilih'}
                </p>

                {/* Tab kategori hanya muncul kalau part-nya memang lebih dari
                    satu kategori — untuk satu kategori, tab cuma jadi hiasan. */}
                {catsPresent.length > 1 && (
                  <div className="mp-tabs" role="tablist" aria-label="Kategori part">
                    {catsPresent.map((c) => {
                      const n = availableModParts.filter((p) => catOf(p) === c).length
                      const sel = availableModParts
                        .filter((p) => catOf(p) === c && selectedModPartIds.includes(p.id)).length
                      return (
                        <button key={c} type="button" role="tab" aria-selected={activeCat === c}
                          className={activeCat === c ? 'on' : ''} onClick={() => setMcat(c)}>
                          {c}<span className="n">{sel ? sel + '/' + n : n}</span>
                        </button>
                      )
                    })}
                  </div>
                )}

                <div className="w-opts">
                  {partsInCat.map((part) => (
                    <label key={part.id}
                      className={'w-opt' + (selectedModPartIds.includes(part.id) ? ' on' : '')}>
                      <input
                        type="checkbox"
                        checked={selectedModPartIds.includes(part.id)}
                        onChange={() => toggleModPart(part.id)}
                        style={{ display: 'none' }}
                      />
                      <span className="w-dot" />
                      {part.image_url && <img src={part.image_url} alt="" loading="lazy" />}
                      <span className="w-body"><b>{part.name}</b></span>
                      <span className="w-price">+{rupiah(part.price)}</span>
                    </label>
                  ))}
                </div>
              </>
            )}

            <div className="rows">
              <div className="row"><span>Harga unit</span><b>{rupiah(listing.price)}</b></div>
              <div className="row"><span>{warranty.name}<small>dibayar saat pelunasan</small></span><b>{warranty.price ? rupiah(warranty.price) : 'Termasuk'}</b></div>
              {selectedModParts.map(part => (
                <div className="row" key={part.id}>
                  <span>{part.name}<small>{catOf(part)} · part modifikasi</small></span>
                  <b>+{rupiah(part.price)}</b>
                </div>
              ))}
              <div className="row hl"><span>Total Harga</span><b>{rupiah(totalPrice)}</b></div>
              <div className="row hl"><span>DP kunci unit<small>Book melalui Contact Kami</small></span><b>{rupiah(DP_FIXED)}</b></div>
            </div>

            <div className={'panel-cta' + (canBook ? ' has-sticky-twin' : '')}>
              <button className="btn btn-accent btn-full" disabled={!canBook}
                onClick={() => onBook(listing, warranty)}>
                {canBook
                  ? (PAYMENT_MODE === 'whatsapp' ? 'Hubungi CS via WhatsApp' : 'Booking DP via QRIS')
                  : listing.status === 'booked' ? 'Sudah di-booking' : listing.status === 'sold' ? 'Terjual' : 'Belum tersedia'}
              </button>
              <p className="fine">{PAYMENT_MODE === 'whatsapp'
                ? 'Tim Motorell akan membalas chat WhatsApp-mu untuk konfirmasi ketersediaan dan proses DP ' +
                  rupiah(DP_FIXED) + ' yang mengunci unit selama 3 hari. DP direfund 100% apabila kondisi ' +
                  'unit tidak sesuai deskripsi yang tercantum.'
                : 'DP ' + rupiah(DP_FIXED) + ' mengunci unit 3 hari. Sisa pembayaran + paket perlindungan ' +
                  'dibayar saat serah terima di Motorell. DP direfund 100% apabila kondisi unit tidak sesuai ' +
                  'deskripsi yang tercantum.'}</p>
            </div>
          </aside>
          )}
        </div>
        {titip ? (
          <div className="sticky-cta">
            <div className="sticky-cta-price">
              <span>Harga penjual</span>
              <b>{rupiah(listing.price)}</b>
            </div>
            <a className="btn btn-accent" href={sellerWaLink(listing)}
              target="_blank" rel="noopener noreferrer">Chat penjual</a>
          </div>
        ) : canBook && (
          <div className="sticky-cta">
            <div className="sticky-cta-price">
              <span>Harga unit</span>
              <b>{rupiah(listing.price)}</b>
            </div>
            <button className="btn btn-accent" onClick={() => onBook(listing, warranty)}>
              {PAYMENT_MODE === 'whatsapp' ? 'Hubungi CS via WhatsApp' : 'Booking DP via QRIS'}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

// ---------- Kartu & beranda ----------
// Ikon WhatsApp resmi (glyph tunggal) — dipakai di tombol chat per unit.
const WaIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.65-2.05-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.47 0 1.46 1.06 2.87 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.75-.72 2-1.41.25-.69.25-1.28.17-1.41-.07-.13-.27-.2-.57-.35zM12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.87 9.87 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.18 8.18 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.2 8.2 0 0 1 8.24 8.24c0 4.54-3.7 8.23-8.24 8.23z" />
  </svg>
)

function CardBase({ l, nav, index = 0, highlight = false }) {
  const photos = Array.isArray(l.photos) ? l.photos : []
  const badge = statusBadge(l)
  const wrapRef = useRef(null)
  const cardRef = useRef(null)
  const [shown, setShown] = useState(false)
  const reduced = useRef(false)

  // Muncul SEKALI saat kartu pertama masuk layar, lalu TETAP tampil (Tugas 2).
  // Dulu shown mengikuti isIntersecting sehingga kartu memudar-hilang saat
  // digulung keluar dan muncul lagi saat balik — mengganggu di etalase.
  useEffect(() => {
    reduced.current = prefersReduced()
    const el = wrapRef.current
    if (!el) return
    if (reduced.current) { setShown(true); return }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((en) => en.isIntersecting)) { setShown(true); io.disconnect() }
    }, { threshold: 0.15 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // kemiringan 3D halus mengikuti posisi kursor
  const onMove = (e) => {
    if (reduced.current) return
    const el = cardRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width - 0.5
    const py = (e.clientY - r.top) / r.height - 0.5
    el.style.setProperty('--ry', (px * 7).toFixed(2) + 'deg')
    el.style.setProperty('--rx', (py * -5).toFixed(2) + 'deg')
  }
  const onLeave = () => {
    const el = cardRef.current
    if (!el) return
    el.style.setProperty('--ry', '0deg')
    el.style.setProperty('--rx', '0deg')
  }

  return (
    <div ref={wrapRef}
      className={'card-wrap' + (shown ? ' shown' : '') + (highlight ? ' match' : '')}
      style={{ transitionDelay: shown ? (index % 3) * 70 + 'ms' : '0ms' }}>
      {/* <div>, bukan <button>: tombol WhatsApp di bawah tidak boleh bersarang
          di dalam tombol lain. .card-hit yang merentang penuh menggantikannya
          sebagai area klik, dan tetap bisa di-Tab/Enter seperti tombol biasa. */}
      <div ref={cardRef} className="card"
        onPointerMove={onMove} onPointerLeave={onLeave}>
        <button className="card-hit" onClick={() => nav('#/unit/' + l.slug)}
          aria-label={'Lihat detail ' + l.title} />
        <div className="card-media">
          {photos[0] ? <FadeImg src={photos[0]} alt={l.title} loading="lazy" /> : <Blueprint />}
          {badge && <span className={'card-status ' + badge.cls}>{badge.label}</span>}
          {/* Unit titip jual: badge "TITIP JUAL" (transparansi ke pembeli), TANPA
              badge grade emas/perak — grade menandakan kurasi resmi Motorell yang
              titip jual belum lalui. Unit resmi: badge grade seperti biasa. */}
          {isTitip(l)
            ? <span className="badge badge-titip">TITIP JUAL</span>
            : <span className={'badge g-' + String(l.grade || '').toLowerCase()}>GRADE {l.grade}</span>}
          {/* Chat cepat. Titip jual → langsung ke penjual; resmi → CS Motorell. */}
          <a className="card-wa" href={isTitip(l) ? sellerWaLink(l) : unitWaLink(l)}
            target="_blank" rel="noopener noreferrer"
            aria-label={'Chat WhatsApp tentang ' + l.title}
            onClick={() => console.info('[WA] Chat unit →', l.title, isTitip(l) ? '(penjual)' : '(CS)')}>
            <WaIcon /><span>Chat Sekarang</span>
          </a>
        </div>
        <div className="card-body">
          <h3>{l.title}</h3>
          <span className="card-meta">{l.year} · {l.mileage_km ? fmt(l.mileage_km) + ' KM' : 'KM —'}{l.color ? ' · ' + l.color.toUpperCase() : ''}</span>
          <span className="card-price">{rupiah(l.price)}</span>
        </div>
        <span className="card-go"><span>Lihat detail</span><span className="aro">→</span></span>
      </div>
    </div>
  )
}

// Etalase bisa berisi puluhan kartu, dan TIAP ketukan huruf di search bar
// me-render ulang HomeView. Tanpa memo semua kartu ikut render ulang — termasuk
// IntersectionObserver & tilt handler-nya — padahal props-nya sama persis.
// `nav` sudah dibungkus useCallback di App, jadi memo-nya benar-benar menggigit.
const Card = memo(CardBase)

// ---------- Skeleton ----------
// Meniru struktur Card 1:1 (media persegi → judul → meta → harga → kaki) supaya
// grid tidak melompat begitu data asli masuk.
function SkeletonCard() {
  return (
    <div className="sk" aria-hidden="true">
      <div className="sk-media" />
      <div className="sk-body">
        <div className="sk-line" style={{ width: '82%', height: 13 }} />
        <div className="sk-line" style={{ width: '54%' }} />
        <div className="sk-line" style={{ width: '42%', height: 15, marginTop: 5 }} />
      </div>
      <div className="sk-foot"><div className="sk-line" style={{ width: '38%' }} /></div>
    </div>
  )
}

const SKELETON_COUNT = 6

// ---------- Panel filter ----------
function FilterPanel({ facets, panel, setPanel, onReset }) {
  const { brands, years, grades, priceLo, priceHi } = facets
  // Slider tak bernilai → pakai batas data sebagai posisi awal, sehingga thumb
  // tidak menggantung di 0 saat filter harga belum disentuh.
  const lo = panel.priceMin ?? priceLo
  const hi = panel.priceMax ?? priceHi
  const span = Math.max(1, priceHi - priceLo)
  const step = Math.max(100_000, Math.round(span / 100))

  const toggle = (key, val) => setPanel((p) => {
    const has = p[key].includes(val)
    const next = has ? p[key].filter((x) => x !== val) : [...p[key], val]
    console.info('[FILTER] ' + key + ' →', next)
    return { ...p, [key]: next }
  })

  // Kedua thumb tidak boleh saling menyilang — min dijepit di bawah max, dan
  // sebaliknya. Tanpa ini, menyeret min melewati max membuat rentangnya terbalik
  // dan hasilnya selalu nol unit.
  const setMin = (v) => setPanel((p) => ({ ...p, priceMin: Math.min(Number(v), hi) }))
  const setMax = (v) => setPanel((p) => ({ ...p, priceMax: Math.max(Number(v), lo) }))

  const pct = (v) => ((v - priceLo) / span) * 100

  return (
    <div className="fp">
      <div className="fp-head">
        <h4>Filter</h4>
        <button className="fp-reset" onClick={onReset} disabled={!panelActive(panel)}>
          Reset Filter
        </button>
      </div>

      <div className="fp-grp">
        <label>Range Harga</label>
        <div className="fp-price-val">{rupiah(lo)} – {rupiah(hi)}</div>
        <div className="fp-range">
          <span className="track" />
          <span className="fill" style={{ left: pct(lo) + '%', right: (100 - pct(hi)) + '%' }} />
          <input type="range" min={priceLo} max={priceHi} step={step} value={lo}
            aria-label="Harga minimum" onChange={(e) => setMin(e.target.value)} />
          <input type="range" min={priceLo} max={priceHi} step={step} value={hi}
            aria-label="Harga maksimum" onChange={(e) => setMax(e.target.value)} />
        </div>
      </div>

      {brands.length > 0 && (
        <div className="fp-grp">
          <label>Merek</label>
          <div className="fp-opts">
            {brands.map((b) => (
              <label className="fp-opt" key={b}>
                <input type="checkbox" checked={panel.brands.includes(b)}
                  onChange={() => toggle('brands', b)} />
                {b}
              </label>
            ))}
          </div>
        </div>
      )}

      {years.length > 0 && (
        <div className="fp-grp">
          <label>Tahun</label>
          {/* Tahun diambil dari unit yang BENAR-BENAR ada di etalase, bukan
              rentang tetap — daftar tahun mati akan basi tiap ganti stok. */}
          <select className="fp-sel" value={panel.year ?? ''}
            onChange={(e) => setPanel((p) => ({ ...p, year: e.target.value ? Number(e.target.value) : null }))}>
            <option value="">Semua tahun</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      )}

      {grades.length > 0 && (
        <div className="fp-grp">
          <label>Kondisi</label>
          {/* "Kondisi" = kolom grade. Labelnya bahasa manusia, nilainya S/A/B. */}
          <div className="fp-opts">
            {grades.map((g) => (
              <label className="fp-opt" key={g}>
                <input type="checkbox" checked={panel.grades.includes(g)}
                  onChange={() => toggle('grades', g)} />
                {GRADE_COND_LABEL[g] || 'Grade ' + g} <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>(Grade {g})</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Toggle sumber: default tampilkan semua; matikan untuk HANYA unit resmi. */}
      <div className="fp-grp">
        <label>Sumber unit</label>
        <label className="fp-opt">
          <input type="checkbox" checked={panel.showTitip !== false}
            onChange={(e) => setPanel((p) => ({ ...p, showTitip: e.target.checked }))} />
          Tampilkan unit Titip Jual
        </label>
      </div>
    </div>
  )
}

// ---------- Terakhir dilihat ----------
function RecentlyViewed({ listings, recent, nav, onClear }) {
  // Riwayat menyimpan ID, bukan salinan unit — harga/status bisa berubah, dan
  // unit yang sudah terjual hilang dari `listings` sehingga otomatis rontok di
  // sini. Urutan mengikuti riwayat (terbaru dulu), bukan urutan etalase.
  const items = useMemo(
    () => recent.map((id) => listings.find((l) => String(l.id) === String(id))).filter(Boolean),
    [recent, listings])

  if (items.length === 0) return null

  return (
    <div className="recent">
      <div className="recent-head">
        <h3>🕐 Terakhir Dilihat</h3>
        <button className="recent-clear" onClick={onClear}>Hapus riwayat</button>
      </div>
      <div className="recent-rail">
        {items.map((l) => (
          <button className="rcard" key={l.id} onClick={() => nav('#/unit/' + l.slug)}>
            <div className="rcard-media">
              {l.photos?.[0] ? <FadeImg src={l.photos[0]} alt={l.title} loading="lazy" /> : <Blueprint />}
            </div>
            <div className="rcard-body">
              <b>{l.title}</b>
              <span>{rupiah(l.price)}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------- Galeri carousel (geser horizontal, ~6 tampil) ----------
// Dipakai IDENTIK untuk Galeri Motorell & Galeri Titip Jual (Tugas 4). Semua
// unit dirender; hanya ~6 yang terlihat sekaligus, sisanya lewat geser/scroll.
// Bukan membatasi query — pembatasan murni tampilan (lebar kartu + overflow-x).
function Gallery({ title, subtitle, units, nav, searchActive, loading = false }) {
  const railRef = useRef(null)
  const [edges, setEdges] = useState({ l: false, r: false })
  // Update penanda tepi (untuk fade & mengaktifkan panah) saat scroll/resize.
  const sync = useCallback(() => {
    const el = railRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setEdges({ l: el.scrollLeft > 4, r: el.scrollLeft < max - 4 })
  }, [])
  useEffect(() => {
    const el = railRef.current
    if (!el) return
    sync()
    el.addEventListener('scroll', sync, { passive: true })
    window.addEventListener('resize', sync)
    return () => { el.removeEventListener('scroll', sync); window.removeEventListener('resize', sync) }
  }, [sync, units.length, loading])
  const nudge = (dir) => {
    const el = railRef.current
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' })
  }

  return (
    <div className="gal">
      <div className="gal-head">
        <div>
          <h3 className="gal-title">{title}</h3>
          <p className="gal-sub">{subtitle}{!loading && units.length > 0 ? ' · ' + units.length + ' unit' : ''}</p>
        </div>
        {!loading && units.length > 0 && (
          <div className="gal-arrows">
            <button type="button" aria-label="Geser kiri" disabled={!edges.l} onClick={() => nudge(-1)}>←</button>
            <button type="button" aria-label="Geser kanan" disabled={!edges.r} onClick={() => nudge(1)}>→</button>
          </div>
        )}
      </div>
      <div className={'gal-wrap' + (edges.r ? ' more' : '')}>
        <div className="gal-rail" ref={railRef}>
          {loading
            ? Array.from({ length: SKELETON_COUNT }, (_, i) => (
                <div className="gal-item" key={i}><SkeletonCard /></div>))
            : units.map((l, i) => (
                <div className="gal-item" key={l.id}>
                  <Card l={l} nav={nav} index={i} highlight={searchActive} />
                </div>))}
        </div>
      </div>
    </div>
  )
}

// Intro hero diputar SEKALI per page-load. Flag skala-modul (bukan state) supaya
// tidak terulang saat HomeView di-mount ulang oleh navigasi SPA (buka unit lalu
// kembali) — hanya reset saat halaman benar-benar di-refresh (modul dimuat lagi).
let heroIntroSeen = false

function HomeView({ listings, nav, query = '', filters = null, searchActive = false,
  loading = false, error = '', panel, setPanel, sort, setSort, resetPanel,
  recent = [], clearRecent }) {
  // listings berisi status 'published' + 'booked' (unit ter-DP tetap tampil
  // sebagai pemicu urgensi, tapi tidak bisa di-booking — lihat canBook di
  // UnitView). Unit 'sold' tidak pernah sampai ke sini.
  //
  // Dua lapis filter yang DI-AND:
  //   1. searchActive/filters — hasil urai teks bebas dari search bar navbar
  //   2. panel               — kontrol eksplisit di sidebar/drawer
  // Jadi "di bawah 30 juta" + centang Honda menyaring keduanya sekaligus.
  // Section fitur & foto intro tetap pakai `listings` penuh, bukan `shown`.
  const facets = useMemo(() => facetsOf(listings), [listings])
  // Etalase kini DUA galeri terpisah (resmi & titip jual). Filter (search +
  // panel) + sort berlaku SAMA ke keduanya; tak ada lagi urutan prioritas
  // gabungan — masing-masing galeri diurut sendiri di dalam section-nya.
  const { officialShown, titipShown } = useMemo(() => {
    const match = (l) => (!searchActive || matchListing(l, filters)) && matchPanel(l, panel)
    const off = sortListings(listings.filter((l) => !isTitip(l) && match(l)), sort)
    const tj = sortListings(listings.filter((l) => isTitip(l) && match(l)), sort)
    console.info('[ETALASE] resmi ' + off.length + ' · titip jual ' + tj.length + ' — urut: ' + sort)
    return { officialShown: off, titipShown: tj }
  }, [listings, searchActive, filters, panel, sort])
  const officialAll = useMemo(() => listings.filter((l) => !isTitip(l)), [listings])

  const [drawer, setDrawer] = useState(false)
  const nFilter = (panel.brands.length + panel.grades.length +
    (panel.year ? 1 : 0) + (panel.priceMin || panel.priceMax ? 1 : 0))
  // Tidak ada unit = tidak ada yang bisa disaring/diurutkan.
  const showTools = !loading && !error && listings.length > 0

  // Intro hero: teks meluncur kanan→kiri, LALU model 3D fade-in setelah teks
  // selesai. initial/animate (bukan whileInView) → jalan sekali saat mount, tidak
  // terpicu ulang saat scroll. Dilewati untuk prefers-reduced-motion & untuk
  // mount berikutnya di page-load yang sama (heroIntroSeen).
  const [playIntro] = useState(() => !heroIntroSeen && !prefersReduced())
  useEffect(() => { heroIntroSeen = true }, [])
  // Total durasi ~1.8s (teks 1.1s → model mulai 1.2s, selesai 1.8s) — di bawah 2s.
  const heroTextAnim = playIntro
    ? { initial: { x: '100%', opacity: 0 }, animate: { x: 0, opacity: 1 },
        transition: { duration: 1.1, ease: 'easeOut' } }
    : {}
  // Fade-in model lebih elegan: opacity + sedikit scale (0.92→1) + naik halus
  // (y 20→0), pakai ease-out-expo [0.16,1,0.3,1] (cepat lalu melambat lembut).
  // Transform saja → tanpa layout shift. Total intro jadi ~2.3s (delay 1.2 +
  // durasi 1.1) — sengaja sedikit lebih panjang demi kesan premium.
  const heroModelAnim = playIntro
    ? { initial: { opacity: 0, scale: 0.92, y: 20 }, animate: { opacity: 1, scale: 1, y: 0 },
        transition: { duration: 1.1, delay: 1.2, ease: [0.16, 1, 0.3, 1] } }
    : {}

  // Drawer mobile mengunci scroll body selama terbuka, dan Esc menutupnya —
  // tanpa ini halaman di belakang ikut menggulung saat user menyapu panel.
  useEffect(() => {
    if (!drawer) return
    const onKey = (e) => { if (e.key === 'Escape') setDrawer(false) }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [drawer])
  // Unit asli terbaik (grade tertinggi yang punya foto) — dipakai sebagai foto
  // fallback kalau WebGL gagal render (bukan lagi bagian animasi pembuka).
  const introUnit =
    listings.find((l) => l.grade === 'S' && l.photos?.[0]) ||
    listings.find((l) => l.grade === 'A' && l.photos?.[0]) ||
    listings.find((l) => l.photos?.[0]) || null
  // Foto unit terbaik dipakai sebagai cadangan kalau embed Sketchfab gagal muat.
  const introPhoto = introUnit?.photos?.[0] || null

  // Transisi "portal" saat pindah dari hero ke etalase — cincin cahaya
  // membesar & memudar sambil halaman scroll, terinspirasi portal-frame
  // reveal di video referensi desain.
  const [portal, setPortal] = useState(false)
  const goEtalase = useCallback((e) => {
    e.preventDefault()
    const target = document.getElementById('etalase')
    if (prefersReduced()) { target?.scrollIntoView(); return }
    setPortal(true)
    setTimeout(() => target?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 140)
    setTimeout(() => setPortal(false), 900)
  }, [])

  return (
    <>
      <AnimatePresence>
        {portal && (
          <motion.div className="portal-reveal" aria-hidden="true"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}>
            <motion.span className="portal-reveal-glow"
              initial={{ scale: 0.3, opacity: 0 }}
              animate={{ scale: [0.3, 1, 2.6], opacity: [0, 0.85, 0] }}
              transition={{ duration: 0.9, ease: 'easeOut', times: [0, 0.35, 1] }} />
          </motion.div>
        )}
      </AnimatePresence>
      <section className="hero">
        <div className="hero-grid-lines" aria-hidden="true" />
        <div className="container hero-inner">
          <div className="hero-main">
            <motion.div className="hero-copy" {...heroTextAnim}>
              <p className="kicker">Motorell Market — Showroom motor terkurasi</p>
              <h1>Lebih dari motor bekas.<br />Kualitas <em>anti was-was.</em></h1>
              <p>Setiap motor telah dikurasi dan siap
                mengukir cerita perjalanan Anda.</p>
              <div className="hero-cta">
                <a className="btn btn-dark" href="#etalase" onClick={goEtalase}>Lihat semua unit</a>
                <a className="btn btn-ghost" href="#kurasi">Standar kurasi</a>
              </div>
            </motion.div>
            <motion.div className="hero-model-slot" {...heroModelAnim}>
              <HeroModel fallbackPhoto={introPhoto} />
            </motion.div>
          </div>
          <div className="spec-rail">
            <span>titik inspeksi<b>50+</b></span>
            <span>Garansi mesin s.d.<b>37 hari</b></span>
            <span>Kunci unit<b>{rupiah(DP_FIXED)}</b></span>
            <span>Unit Terjual<b>100+</b></span>
          </div>
        </div>
      </section>

      <Reveal once> {/* etalase: fade-in SEKALI, tak reverse saat scroll */}
        <section className="section" id="etalase">
          <div className="container">
            <div className="sec-head">
              <div>
                <p className="kicker">Etalase</p>
                <h2>Etalase Motorell Market.</h2>
              </div>
              <p className="aside">Klik unit untuk foto & detail lengkap. Geser tiap galeri
                untuk melihat lebih banyak unit.</p>
            </div>
            {!loading && !error && (
              <RecentlyViewed listings={listings} recent={recent} nav={nav} onClear={clearRecent} />
            )}

            {/* Filter + sort — berlaku ke KEDUA galeri di bawah. */}
            {showTools && (
              <div className="et-bar et-bar-top">
                <div className="et-tools">
                  <button className="et-filter-btn always" onClick={() => setDrawer(true)}>
                    Filter{nFilter > 0 && <span className="n">{nFilter}</span>}
                  </button>
                  <select className="et-sort" value={sort} aria-label="Urutkan unit"
                    onChange={(e) => setSort(e.target.value)}>
                    {SORT_OPTIONS.map((o) => (
                      <option key={o.code} value={o.code}>{o.label}</option>))}
                  </select>
                </div>
              </div>
            )}

            {/* ---- Galeri Motorell (unit resmi) ---- */}
            {error ? (
              <div className="empty">
                Gagal memuat etalase — {error}.<br />
                <button className="btn btn-ghost btn-sm" style={{ marginTop: 14 }}
                  onClick={() => window.location.reload()}>Coba lagi</button>
              </div>
            ) : loading ? (
              <Gallery title="Galeri Motorell" subtitle="Unit resmi hasil kurasi tim Motorell"
                units={[]} nav={nav} loading />
            ) : officialAll.length === 0 ? (
              <div className="empty">Etalase sedang kosong, unit baru sedang dalam proses kurasi.</div>
            ) : officialShown.length === 0 ? (
              <div className="gal">
                <div className="gal-head"><div>
                  <h3 className="gal-title">Galeri Motorell</h3>
                  <p className="gal-sub">Unit resmi hasil kurasi tim Motorell</p>
                </div></div>
                <div className="empty">
                  {searchActive
                    ? <>Tidak ada unit resmi yang cocok dengan pencarian "{query.trim()}".</>
                    : <>Tidak ada unit resmi yang cocok dengan filter ini.</>}
                  {panelActive(panel) && (
                    <><br /><button className="btn btn-ghost btn-sm" style={{ marginTop: 14 }}
                      onClick={resetPanel}>Reset filter</button></>)}
                </div>
              </div>
            ) : (
              <Gallery title="Galeri Motorell" subtitle="Unit resmi hasil kurasi tim Motorell"
                units={officialShown} nav={nav} searchActive={searchActive} />
            )}

            {/* ---- CTA di ANTARA kedua galeri ---- */}
            <div className="gal-cta">
              <div>
                <h3>Punya Motor yang Ingin Dijual?</h3>
                <p>Titip motor Anda di Motorell Market dan jangkau lebih banyak pembeli.</p>
              </div>
              <a className="btn btn-accent" href="#/titip-jual"
                onClick={(e) => { e.preventDefault(); nav('#/titip-jual') }}>Titip Jual Sekarang</a>
            </div>

            {/* ---- Galeri Titip Jual (approved & lolos filter) ---- */}
            {!loading && !error && titipShown.length > 0 && (
              <Gallery title="Galeri Titip Jual" subtitle="Unit titipan dari masyarakat"
                units={titipShown} nav={nav} searchActive={searchActive} />
            )}

            <AnimatePresence>
              {drawer && (
                <>
                  <motion.div className="fp-backdrop" onClick={() => setDrawer(false)}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }} />
                  <motion.div className="fp-drawer" role="dialog" aria-label="Filter unit"
                    initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
                    transition={{ type: 'tween', duration: 0.26, ease: [0.2, 0.7, 0.25, 1] }}>
                    <div className="fp-close">
                      <button onClick={() => setDrawer(false)} aria-label="Tutup filter">×</button>
                    </div>
                    <FilterPanel facets={facets} panel={panel} setPanel={setPanel} onReset={resetPanel} />
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="section grey lokasi" id="lokasi">
          <div className="container">
            <div className="sec-head">
              <div>
                <p className="kicker">Kunjungi kami</p>
                <h2>Temukan Motorell.</h2>
              </div>
              <p className="aside">Mampir langsung ke showroom untuk lihat dan cek kondisi motor
                pilihanmu sendiri. Klik peta untuk buka rute di Google Maps.</p>
            </div>
            <div className="lokasi-grid">
              {/* Peta ASLI Google Maps, dibingkai lingkaran. iframe dibuat
                  non-interaktif (pointer-events:none) supaya gulir di atasnya
                  tetap men-scroll halaman; seluruh lingkaran jadi satu tautan
                  ke Maps penuh. */}
              <a className="lokasi-map" href={MAPS_LINK} target="_blank" rel="noopener noreferrer"
                aria-label="Buka lokasi Motorell Garage di Google Maps">
                <iframe src={MAPS_EMBED} title="Peta lokasi Motorell Garage"
                  loading="lazy" tabIndex={-1} referrerPolicy="no-referrer-when-downgrade" />
                <span className="lokasi-map-ring" aria-hidden="true" />
              </a>
              <div className="lokasi-info">
                <h3>Mampir ke showroom kami</h3>
                <p>Koleksi motor terkurasi Motorell bisa kamu lihat dan cek langsung di tempat.</p>
                <ul className="lokasi-facts">
                  <li><span>Alamat</span><b>{MAPS_ADDRESS}</b></li>
                  <li><span>Jam buka</span><b>Senin–Minggu · 09.00–18.00 WIB</b></li>
                  <li><span>Kontak</span><b>
                    <a href={'https://wa.me/' + CS_WHATSAPP_NUMBER} target="_blank" rel="noopener noreferrer">WhatsApp kami</a>
                  </b></li>
                </ul>
                <a className="btn btn-accent" href={MAPS_LINK}
                  target="_blank" rel="noopener noreferrer">Buka di Google Maps</a>
              </div>
            </div>
          </div>
        </section>
      </Reveal>

      <Reveal> {/* Wrapped the #kurasi section */}
        <section className="section" id="kurasi">
          <div className="container">
            {/* judul → subjudul muncul berurutan, bukan serempak */}
            <FadeIn className="sec-head" style={{ marginBottom: 'clamp(48px,7vw,84px)' }}>
              <FadeItem>
                <p className="kicker">Kenapa Motorell</p>
                <h2>Beli motor,<br />anti was-was.</h2>
              </FadeItem>
              <FadeItem as="p" className="aside" direction="left">
                Kami saring dulu, baru tayang. Yang sampai ke etalase hanya unit yang
                lolos pemeriksaan dan layak kamu bawa pulang.
              </FadeItem>
            </FadeIn>
            {FEATURE_SECTIONS.map((f, i) => (
              <Reveal key={f.kicker} className={'feature' + (i % 2 ? ' flip' : '')}>
                <div className="feature-media-slide">
                  <TiltMedia className="feature-media">
                    <FeatureMedia src={f.photoUrl} alt={f.title} />
                  </TiltMedia>
                </div>
                <div className="feature-copy">
                  <p className="kicker">{f.kicker}</p>
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </div>
              </Reveal>
            ))}

            {/* Tugas 8: kartu penjelasan grade */}
            <FadeIn className="grade-head">
              <FadeItem as="p" className="kicker">Sistem grade</FadeItem>
              <FadeItem as="h3">Tiga grade, satu standar jujur.</FadeItem>
            </FadeIn>
            <FadeIn className="grade-cards">
              {GRADE_DEF.map((gd) => (
                <FadeItem key={gd.g} className="grade-card">
                  <span className={'badge g-' + gd.g.toLowerCase()}>GRADE {gd.g}</span>
                  <p>{gd.text}</p>
                </FadeItem>
              ))}
            </FadeIn>
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="section about" id="tentang">
          <div className="container">
            <FadeIn className="about-inner">
              <FadeItem as="p" className="kicker">Cerita kami</FadeItem>
              <FadeItem as="h2">Sejarah Motorell.</FadeItem>
              <div className="about-story">
                {ABOUT_STORY.map((para, i) => (
                  <FadeItem key={i} as="p" direction="up">{para}</FadeItem>
                ))}
              </div>
            </FadeIn>
          </div>
        </section>
      </Reveal>

    </>
  )
}

// ---------- Search bar navigasi dengan placeholder mengetik sendiri ----------
const SEARCH_HINTS = [
  'Cari Kawasaki W175…',
  'Cari motor retro…',
  'Cari motor di bawah 20 juta…',
]
// Filter cepat sekali-klik — mengisi search bar dengan kalimat yang memang
// dimengerti parser-nya, jadi chip dan ketikan manual jalannya sama persis.
const QUICK_FILTERS = ['Grade S', 'Grade A', 'Di bawah 20 juta', 'Di bawah 30 juta']

// Search bar navbar: mengetik langsung menyaring etalase (lihat App), dan
// dropdown ini menawarkan lompatan LANGSUNG ke unit — tidak perlu scroll dan
// mencari sendiri di grid.
function NavSearch({ value, onChange, onSubmit, results = [], total = 0, filters = [],
  words = [], onPick, onQuick }) {
  const [ph, setPh] = useState(() => (prefersReduced() ? SEARCH_HINTS[0] : ''))
  const [open, setOpen] = useState(false)
  const [cur, setCur] = useState(-1)
  const boxRef = useRef(null)

  // placeholder animasi typewriter: mengetik lalu menghapus, bergilir.
  // prefers-reduced-motion → tampilkan satu placeholder statis (tanpa animasi).
  useEffect(() => {
    if (prefersReduced()) return
    let hintI = 0, chI = 0, deleting = false, timer
    const tick = () => {
      const full = SEARCH_HINTS[hintI]
      if (!deleting) {
        chI++
        setPh(full.slice(0, chI))
        if (chI >= full.length) { deleting = true; timer = setTimeout(tick, 1500); return }
        timer = setTimeout(tick, 55)
      } else {
        chI--
        setPh(full.slice(0, chI))
        if (chI <= 0) { deleting = false; hintI = (hintI + 1) % SEARCH_HINTS.length; timer = setTimeout(tick, 260); return }
        timer = setTimeout(tick, 28)
      }
    }
    timer = setTimeout(tick, 650)
    return () => clearTimeout(timer)
  }, [])

  // klik di luar menutup dropdown
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  // hasil berubah → reset sorotan keyboard supaya tidak menunjuk baris basi
  useEffect(() => { setCur(-1) }, [value])

  const hasValue = value.trim().length > 0
  const showResults = open && hasValue
  const showTips = open && !hasValue // fokus tapi kosong → tampilkan tips + filter cepat

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); return }
    if (!showResults) return
    if (e.key === 'ArrowDown') {
      e.preventDefault(); setCur((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); setCur((i) => Math.max(i - 1, -1))
    } else if (e.key === 'Enter' && cur >= 0 && results[cur]) {
      // Enter di atas saran = buka unitnya langsung
      e.preventDefault()
      setOpen(false)
      onPick(results[cur])
    }
  }

  return (
    <div className="nav-search" ref={boxRef}>
      <form onSubmit={(e) => { setOpen(false); onSubmit(e) }} role="search">
        <svg className="si" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
        </svg>
        <input type="search" value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={ph || 'Cari unit…'}
          aria-label="Cari unit di etalase"
          aria-expanded={showResults}
          aria-controls="ns-pop" />
        {hasValue && (
          <button type="button" className="ns-clear" aria-label="Bersihkan pencarian"
            onClick={() => { onChange(''); setCur(-1) }}>✕</button>
        )}
      </form>

      {showTips && (
        <div className="ns-pop ns-pop-tips">
          <p className="ns-tip">Cari pakai brand, model, harga, tahun, atau grade — misalnya
            <b> “benelli di bawah 20 juta”</b> atau <b>“w175 2019”</b>.</p>
          <div className="ns-quick">
            {QUICK_FILTERS.map((qf) => (
              <button type="button" key={qf} onClick={() => onQuick(qf)}>{qf}</button>
            ))}
          </div>
        </div>
      )}

      {showResults && (
        <div className="ns-pop" id="ns-pop" role="listbox">
          <div className="ns-meta">
            <span className="ns-count">{total} unit cocok</span>
            {filters.length > 0 && (
              <span className="ns-chips">
                {filters.map((c) => <span className="ns-chip" key={c}>{c}</span>)}
              </span>
            )}
          </div>

          {results.length === 0 ? (
            <p className="ns-none">Tidak ada unit yang cocok. Coba kata kunci lain.</p>
          ) : (
            <div className="ns-list">
              {results.map((l, i) => (
                <button type="button" key={l.id} role="option" aria-selected={i === cur}
                  className={'ns-item' + (i === cur ? ' cur' : '')}
                  onMouseEnter={() => setCur(i)}
                  onClick={() => { setOpen(false); onPick(l) }}>
                  {l.photos?.[0]
                    ? <img src={l.photos[0]} alt="" loading="lazy" />
                    : <span className="ns-thumb-empty" />}
                  <span className="ns-body">
                    <b>
                      {highlight(l.title, words).map((p, k) =>
                        p.on ? <mark key={k}>{p.t}</mark> : <span key={k}>{p.t}</span>)}
                    </b>
                    <span>{l.year} · GRADE {l.grade}{l.color ? ' · ' + l.color.toUpperCase() : ''}</span>
                  </span>
                  <span className="ns-price">{rupiah(l.price)}</span>
                </button>
              ))}
            </div>
          )}

          {total > results.length && (
            <button type="button" className="ns-all"
              onClick={(e) => { setOpen(false); onSubmit(e) }}>
              Lihat semua {total} hasil →
            </button>
          )}

          <div className="ns-quick">
            {QUICK_FILTERS.map((qf) => (
              <button type="button" key={qf} onClick={() => { onQuick(qf); setOpen(true) }}>{qf}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- Root ----------
// Hash membawa query pencarian juga: "#/?q=xsr%20di%20bawah%2030%20juta".
// Dengan begitu hasil pencarian bisa di-share/di-bookmark, dan tombol
// back/forward browser mengembalikan pencarian sebelumnya.
//
// Filter panel & urutan ikut menumpang query string yang sama
// ("#/?q=xsr&brand=Honda,Yamaha&max=30000000&sort=price_asc") — satu link
// membawa SELURUH keadaan etalase, bukan cuma teks pencariannya.
function panelFromParams(sp) {
  const num = (k) => {
    const n = Number(sp.get(k))
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const list = (k) => (sp.get(k) || '').split(',').map((s) => s.trim()).filter(Boolean)
  return {
    priceMin: num('min'), priceMax: num('max'),
    brands: list('brand'), year: num('year'),
    grades: list('grade').map((g) => g.toUpperCase()),
    showTitip: sp.get('titip') !== '0',   // ?titip=0 → sembunyikan titip jual
  }
}

function sortFromParams(sp) {
  const s = sp.get('sort')
  // Nilai asing dari URL yang diedit tangan jangan sampai membuat <select>
  // jadi uncontrolled — jatuh balik ke default.
  return SORT_OPTIONS.some((o) => o.code === s) ? s : 'newest'
}

// Hanya nilai yang benar-benar aktif yang ditulis — URL bersih saat filter
// kosong, dan '#/' polos tetap '#/' (bukan '#/?sort=newest&brand=').
function stateToQuery(q, panel, sort) {
  const sp = new URLSearchParams()
  if (q) sp.set('q', q)
  if (panel.priceMin) sp.set('min', String(panel.priceMin))
  if (panel.priceMax) sp.set('max', String(panel.priceMax))
  if (panel.brands.length) sp.set('brand', panel.brands.join(','))
  if (panel.year) sp.set('year', String(panel.year))
  if (panel.grades.length) sp.set('grade', panel.grades.join(','))
  if (panel.showTitip === false) sp.set('titip', '0')
  if (sort !== 'newest') sp.set('sort', sort)
  return sp.toString()
}

function parseHash() {
  const raw = window.location.hash || '#/'
  const qIdx = raw.indexOf('?')
  const path = qIdx === -1 ? raw : raw.slice(0, qIdx)
  const sp = new URLSearchParams(qIdx === -1 ? '' : raw.slice(qIdx + 1))
  const q = sp.get('q') || ''
  const panel = panelFromParams(sp)
  const sort = sortFromParams(sp)
  const unit = path.match(/^#\/unit\/(.+)$/)
  if (unit) return { name: 'unit', slug: decodeURIComponent(unit[1]), q, panel, sort }
  if (path === '#/admin') return { name: 'admin', q, panel, sort }
  if (path === '#/kebijakan') return { name: 'kebijakan', q, panel, sort }
  if (path === '#/titip-jual') return { name: 'titip', q, panel, sort }
  return { name: 'home', q, panel, sort }
}

// ---------- Halaman kebijakan / FAQ (route #/kebijakan) ----------
const POLICY = [
  {
    q: 'DP & Booking',
    body: [
      'DP Rp500.000 mengunci motor selama 3 hari. Waktu ini buat pelunasan dan serah terima. Kalau lewat 3 hari tanpa konfirmasi dari kami, motor bisa ditawarkan lagi ke pembeli lain.',
      'DP balik 100% kalau kondisi motor ternyata tidak sesuai deskripsi saat kamu terima. Tinggal ajukan lewat WhatsApp maksimal 24 jam setelah serah terima.',
    ],
  },
  {
    q: 'Syarat & Ketentuan',
    body: [
      'Harga di halaman unit adalah harga motor apa adanya sesuai deskripsi. Belum termasuk balik nama, pajak tahunan yang belum dibayar, dan ongkir ke luar area yang disepakati.',
      'Paket perlindungan (Avantgard, Spectre, Cullinan) mulai berlaku sejak serah terima, sesuai cakupan tiap paket.',
    ],
  },
  {
    q: 'Kebijakan Privasi',
    body: [
      'Data kamu (nama, nomor HP, email) cuma kami pakai buat proses transaksi, konfirmasi booking, dan ngobrol soal motor yang kamu minati.',
      'Sesekali kami kirim info motor baru atau promo lewat email atau WhatsApp. Kami jaga biar tetap relevan dan tidak spam, dan kamu bisa berhenti kapan saja tinggal bilang ke tim kami.',
      'Data kamu tidak kami bagikan ke pihak ketiga, kecuali memang diwajibkan hukum.',
    ],
  },
]

function KebijakanView({ nav }) {
  return (
    <section className="policy">
      <div className="container">
        <a className="back" href="#/" onClick={(e) => { e.preventDefault(); nav('#/') }}>← Kembali ke etalase</a>
        <p className="kicker">Kebijakan &amp; ketentuan</p>
        <h1>Transparan, hitam di atas putih.</h1>
        <p className="lead">Semua aturan main soal DP, transaksi, dan data pribadimu kami tulis terbuka
          di sini. Ada pertanyaan lain? Hubungi tim Motorell lewat WhatsApp.</p>
        {POLICY.map((s, i) => (
          <details className="policy-item" key={s.q} open={i === 0}>
            <summary>{s.q}<span className="pm">+</span></summary>
            <div className="policy-body">
              {s.body.map((p, j) => <p key={j}>{p}</p>)}
            </div>
          </details>
        ))}
      </div>
    </section>
  )
}

// ---------- Halaman Titip Jual (route #/titip-jual) — form publik ----------
const TITIP_MIN_PHOTOS = 3
const TITIP_MAX_MB = 5      // batas per foto (mentah) — lebih ketat dari admin
const TITIP_STATUS_LABEL = {
  pending: 'Menunggu review', approved: 'Tayang di etalase',
  rejected: 'Ditolak', sold: 'Terjual',
}
// Label angle untuk panduan foto (dipetakan ke foto-foto contoh unit resmi).
const PHOTO_GUIDE_LABELS = [
  'Tampak depan', 'Samping kiri', 'Samping kanan',
  'Tampak belakang', 'Odometer / KM', 'Kondisi mesin',
]

function TitipJualView({ session, nav, toast, onLoginClick }) {
  const empty = {
    seller_name: '', seller_phone: '', seller_email: '',
    merek: '', model: '', tahun: new Date().getFullYear(), odometer: '',
    warna: '', plat_nomor: '', kondisi: 'Bagus', harga_diinginkan: '',
    deskripsi: '', kelengkapan: '',
  }
  const [f, setF] = useState(empty)
  const [photos, setPhotos] = useState([])      // URL hasil upload
  const [prog, setProg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const [mine, setMine] = useState(null)        // submission milik user
  const [guide, setGuide] = useState([])        // foto contoh dari unit resmi
  const fileRef = useRef(null)
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))

  // Prefill nama dari profil bila ada; muat submission milik sendiri.
  useEffect(() => {
    if (!session) { setMine(null); return }
    setF((p) => ({ ...p, seller_email: p.seller_email || session.user.email || '' }))
    supabase.from('titip_jual_units')
      .select('*').eq('seller_id', session.user.id).order('created_at', { ascending: false })
      .then(({ data }) => setMine(data || []))
  }, [session, done])

  // Foto contoh untuk panduan: ambil dari unit resmi yang fotonya PALING lengkap
  // di etalase. Read-only, murni referensi angle — tidak ikut ter-submit.
  useEffect(() => {
    supabase.from('listings').select('photos').eq('status', 'published')
      .then(({ data }) => {
        const best = (data || []).map((r) => r.photos).filter((p) => Array.isArray(p) && p.length)
          .sort((a, b) => b.length - a.length)[0] || []
        setGuide(best.slice(0, 6))
      })
  }, [])

  async function handleFiles(picked) {
    const all = Array.from(picked || [])
    if (!all.length) return
    setErr('')
    const skipped = []
    const ok = all.filter((x) => {
      if (!ALLOWED_PHOTO_TYPES.includes(x.type)) { skipped.push(x.name + ' (format)'); return false }
      if (x.size > TITIP_MAX_MB * 1024 * 1024) { skipped.push(x.name + ' (' + (x.size / 1048576).toFixed(1) + 'MB)'); return false }
      return true
    })
    const remaining = MAX_PHOTOS - photos.length
    const batch = ok.slice(0, remaining)
    if (skipped.length) setErr('Dilewati (hanya JPG/PNG/WEBP maks ' + TITIP_MAX_MB + 'MB): ' + skipped.join(', '))
    if (!batch.length) return
    setProg({ done: 0, total: batch.length })
    for (let i = 0; i < batch.length; i++) {
      try {
        const blob = await compressImage(batch[i])
        const path = session.user.id + '/' + Date.now() + '-' + i + '.jpg'
        const { error } = await supabase.storage.from('titip-jual-photos')
          .upload(path, blob, { contentType: 'image/jpeg' })
        if (error) throw error
        const { data } = supabase.storage.from('titip-jual-photos').getPublicUrl(path)
        setPhotos((p) => [...p, data.publicUrl])
        setProg({ done: i + 1, total: batch.length })
      } catch (ex) {
        setErr('Gagal mengunggah foto: ' + (ex.message || 'coba lagi')); break
      }
    }
    setProg(null)
  }

  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (!f.seller_name.trim() || !f.seller_phone.trim()) { setErr('Nama dan No. HP penjual wajib diisi.'); return }
    if (!f.merek.trim() || !f.model.trim() || !f.harga_diinginkan) { setErr('Merek, model, dan harga wajib diisi.'); return }
    if (photos.length < TITIP_MIN_PHOTOS) { setErr('Unggah minimal ' + TITIP_MIN_PHOTOS + ' foto motor.'); return }
    setBusy(true)
    const payload = {
      seller_id: session.user.id,
      seller_name: f.seller_name.trim(), seller_phone: f.seller_phone.trim(),
      seller_email: f.seller_email.trim() || null,
      merek: f.merek.trim(), model: f.model.trim(), tahun: Number(f.tahun),
      odometer: Number(f.odometer) || null, warna: f.warna.trim() || null,
      plat_nomor: f.plat_nomor.trim() || null, kondisi: f.kondisi,
      harga_diinginkan: Number(f.harga_diinginkan), deskripsi: f.deskripsi.trim() || null,
      kelengkapan: f.kelengkapan.trim() || null, photos, status: 'pending',
    }
    const { error } = await supabase.from('titip_jual_units').insert(payload)
    setBusy(false)
    if (error) { setErr('Gagal mengirim: ' + error.message); return }
    console.info('[TITIP] Submission terkirim — status pending')
    setF(empty); setPhotos([]); setDone(true)
    window.scrollTo(0, 0)
  }

  return (
    <section className="titip">
      <div className="container">
        <a className="back" href="#/" onClick={(e) => { e.preventDefault(); nav('#/') }}>← Kembali ke etalase</a>
        <p className="kicker">Titip Jual</p>
        <h1 className="titip-h1">Titip Jual Motor Anda</h1>
        <p className="titip-lead">Punya motor yang ingin dijual? Titipkan ke Motorell Market.
          Tim kami review dulu (1–2 hari kerja) sebelum unitmu tayang di etalase. Setelah tayang,
          calon pembeli menghubungimu langsung lewat WhatsApp.</p>

        {done && (
          <div className="titip-ok">
            <b>Terima kasih! Motor Anda akan direview oleh tim Motorell dalam 1–2 hari kerja.</b>
            <p>Kami akan menghubungi Anda melalui WhatsApp/telepon yang didaftarkan. Status bisa kamu
              cek di bagian "Submission saya" di bawah.</p>
            <button className="btn btn-ghost btn-sm" onClick={() => setDone(false)}>Titip motor lain</button>
          </div>
        )}

        {!session ? (
          <div className="titip-gate">
            <p>Masuk atau daftar dulu untuk menitipkan motor — supaya kamu bisa memantau status
              submission-mu.</p>
            <button className="btn btn-accent" onClick={onLoginClick}>Masuk / Daftar</button>
          </div>
        ) : !done && (
          <form className="titip-form" onSubmit={submit}>
            <h3 className="titip-sec">Data penjual</h3>
            <div className="f-grid">
              <div className="field"><label htmlFor="t-name">Nama penjual *</label>
                <input id="t-name" value={f.seller_name} onChange={set('seller_name')} required /></div>
              <div className="field"><label htmlFor="t-phone">No. HP / WhatsApp *</label>
                <input id="t-phone" value={f.seller_phone} onChange={set('seller_phone')} placeholder="08xxxxxxxxxx" required /></div>
              <div className="field full"><label htmlFor="t-email">Email (opsional)</label>
                <input id="t-email" type="email" value={f.seller_email} onChange={set('seller_email')} /></div>
            </div>

            <h3 className="titip-sec">Data kendaraan</h3>
            <div className="f-grid">
              <div className="field"><label htmlFor="t-merek">Merek *</label>
                <input id="t-merek" value={f.merek} onChange={set('merek')} placeholder="Honda" required /></div>
              <div className="field"><label htmlFor="t-model">Model *</label>
                <input id="t-model" value={f.model} onChange={set('model')} placeholder="Vario 160" required /></div>
              <div className="field"><label htmlFor="t-tahun">Tahun *</label>
                <input id="t-tahun" type="number" min="1980" max="2030" value={f.tahun} onChange={set('tahun')} required /></div>
              <div className="field"><label htmlFor="t-odo">Odometer (km)</label>
                <input id="t-odo" type="number" min="0" value={f.odometer} onChange={set('odometer')} /></div>
              <div className="field"><label htmlFor="t-warna">Warna</label>
                <input id="t-warna" value={f.warna} onChange={set('warna')} /></div>
              <div className="field"><label htmlFor="t-plat">Plat nomor</label>
                <input id="t-plat" value={f.plat_nomor} onChange={set('plat_nomor')} placeholder="B 1234 XYZ" /></div>
              <div className="field"><label htmlFor="t-kondisi">Kondisi</label>
                <select id="t-kondisi" value={f.kondisi} onChange={set('kondisi')}>
                  {KONDISI_OPTS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select></div>
              <div className="field"><label htmlFor="t-harga">Harga diinginkan (Rp) *</label>
                <input id="t-harga" type="number" min="0" value={f.harga_diinginkan} onChange={set('harga_diinginkan')} placeholder="18000000" required /></div>
              <div className="field full"><label htmlFor="t-desc">Deskripsi tambahan</label>
                <textarea id="t-desc" value={f.deskripsi} onChange={set('deskripsi')}
                  placeholder="Riwayat servis, alasan jual, kondisi mesin…" /></div>
              <div className="field full"><label htmlFor="t-keleng">Kelengkapan dokumen</label>
                <textarea id="t-keleng" value={f.kelengkapan} onChange={set('kelengkapan')}
                  placeholder="STNK hidup, BPKB ada, faktur, kunci serep…" /></div>
            </div>

            {/* Panduan foto — contoh dari unit resmi (read-only). Membantu
                penjual mengambil angle yang konsisten dengan standar etalase. */}
            {guide.length > 0 && (
              <div className="titip-guide">
                <h3 className="titip-sec" style={{ marginBottom: 6 }}>Panduan foto — contoh yang baik</h3>
                <p className="f-info" style={{ marginTop: 0 }}>Ambil foto motormu dengan angle serupa
                  contoh di bawah (foto dari unit etalase Motorell) untuk hasil terbaik.</p>
                <div className="titip-guide-grid">
                  {guide.map((url, i) => (
                    <figure key={i} className="titip-guide-item">
                      <img src={url} alt={'Contoh ' + (PHOTO_GUIDE_LABELS[i] || 'foto')} loading="lazy"
                        draggable={false} />
                      <figcaption>Contoh: {PHOTO_GUIDE_LABELS[i] || 'Foto ' + (i + 1)}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            )}

            <h3 className="titip-sec">Foto motor — {photos.length}/{MAX_PHOTOS} (min {TITIP_MIN_PHOTOS})</h3>
            <div className="photo-strip">
              {photos.map((url, i) => (
                <div className="ph" key={url}>
                  <img src={url} alt={'Foto ' + (i + 1)} />
                  <button type="button" className="rm" aria-label="Hapus foto"
                    onClick={() => setPhotos((p) => p.filter((u) => u !== url))}>✕</button>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <button type="button" className="up-tile" aria-label="Tambah foto"
                  onClick={() => fileRef.current && fileRef.current.click()}>＋</button>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
              multiple hidden
              onChange={(e) => { const fl = Array.from(e.target.files || []); e.target.value = ''; handleFiles(fl) }} />
            {prog && (
              <div className="up-prog">
                <div className="up-bar"><span style={{ width: (prog.done / prog.total * 100) + '%' }} /></div>
                <span className="mono">{prog.done}/{prog.total}</span>
              </div>
            )}
            <p className="f-info">Foto jelas dari beberapa sudut membantu unitmu cepat laku. JPG/PNG/WEBP, maks {TITIP_MAX_MB}MB per foto.</p>

            {err && <p className="f-err">{err}</p>}
            <div className="m-actions">
              <button className="btn btn-accent btn-full" disabled={busy || Boolean(prog)}>
                {busy ? 'Mengirim…' : 'Kirim untuk direview'}
              </button>
            </div>
          </form>
        )}

        {session && Array.isArray(mine) && mine.length > 0 && (
          <div className="titip-mine">
            <h3 className="titip-sec">Submission saya</h3>
            <div className="a-list">
              {mine.map((m) => (
                <div className="a-row" key={m.id}>
                  <div className="a-thumb">
                    {Array.isArray(m.photos) && m.photos[0]
                      ? <img src={m.photos[0]} alt="" />
                      : <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>NO FOTO</span>}
                  </div>
                  <div className="a-info">
                    <b>{[m.merek, m.model, m.tahun].filter(Boolean).join(' ')}</b>
                    <span>{rupiah(m.harga_diinginkan)}{m.status === 'rejected' && m.rejection_reason ? ' · Alasan: ' + m.rejection_reason : ''}</span>
                  </div>
                  <span className={'st ' + m.status}>{TITIP_STATUS_LABEL[m.status] || m.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

export default function App() {
  const [route, setRoute] = useState(parseHash)
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [profileErr, setProfileErr] = useState('')
  // false selama baris profiles masih diambil. Diagnostik "belum diakui staf"
  // hanya boleh muncul SETELAH ini true — kalau tidak, admin sah pun sempat
  // melihat kedipan "kamu bukan staf" sebelum role-nya termuat.
  const [profileReady, setProfileReady] = useState(false)
  const [listings, setListings] = useState([])       // unit resmi (tabel listings)
  const [titipUnits, setTitipUnits] = useState([])   // titip jual 'approved', dinormalkan
  const [deepUnit, setDeepUnit] = useState(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [booking, setBooking] = useState(null) // {listing, warranty}
  const [pending, setPending] = useState(null) // {slug, wcode} nunggu login
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)  // menu hamburger mobile
  const [toastMsg, setToastMsg] = useState('')
  const toastRef = useRef(null)
  const [waHandoff, setWaHandoff] = useState(false)
  const [query, setQuery] = useState('')
  // Filter panel & urutan lahir dari URL, jadi link hasil filter yang dibuka
  // orang lain langsung menampilkan etalase yang sama persis.
  const [panel, setPanel] = useState(() => parseHash().panel)
  const [sort, setSort] = useState(() => parseHash().sort)
  const [recent, setRecent] = useState(readRecent)
  // Etalase punya tiga keadaan berbeda yang dulu terlihat sama (grid kosong):
  // sedang memuat, gagal memuat, dan benar-benar kosong.
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')

  const resetPanel = useCallback(() => {
    console.info('[FILTER] Reset')
    setPanel(EMPTY_PANEL)
  }, [])

  const clearRecent = useCallback(() => {
    try { localStorage.removeItem(RECENT_KEY) } catch { /* mode privat */ }
    setRecent([])
  }, [])

  const toast = useCallback((msg) => {
    setToastMsg(msg)
    clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setToastMsg(''), 3400)
  }, [])

  const nav = useCallback((hash) => { window.location.hash = hash }, [])

  const scrollToEtalase = useCallback(() => {
    const target = document.getElementById('etalase')
    if (!target) return
    target.scrollIntoView(prefersReduced() ? undefined : { behavior: 'smooth', block: 'start' })
  }, [])

  // Submit dari search bar di navbar: bawa ke etalase dan gulirkan ke sana.
  // Hero punya versi sendiri (dengan animasi portal) — yang ini sengaja polos
  // karena dipanggil dari navbar yang bisa aktif di halaman mana pun.
  const goEtalase = useCallback((e) => {
    e?.preventDefault()
    if (route.name !== 'home') nav('#/')
    // kalau rute baru berpindah, #etalase belum ada di DOM pada tick ini
    setTimeout(scrollToEtalase, route.name === 'home' ? 0 : 80)
  }, [route.name, nav, scrollToEtalase])

  // Pintasan navbar ke section lokasi (peta showroom).
  const goLokasi = useCallback((e) => {
    e?.preventDefault()
    if (route.name !== 'home') nav('#/')
    setTimeout(() => {
      document.getElementById('lokasi')
        ?.scrollIntoView(prefersReduced() ? undefined : { behavior: 'smooth', block: 'start' })
    }, route.name === 'home' ? 0 : 80)
  }, [route.name, nav])

  // ---- Smart search ----
  // query = apa yang sedang diketik (responsif), dQuery = versi yang sudah
  // diam 300ms — hanya yang terakhir ini dipakai untuk memfilter, menulis URL,
  // dan auto-scroll, supaya tidak ada kerja berat per ketukan tombol.
  const dQuery = useDebounced(query, 300)
  // Gabungan yang ditampilkan di etalase: resmi + titip jual ('approved').
  // sortListings menjamin resmi selalu di atas. Dipakai untuk grid, pencarian,
  // dan lookup detail supaya semuanya konsisten dari satu sumber.
  const units = useMemo(() => [...listings, ...titipUnits], [listings, titipUnits])

  const filters = useMemo(() => parseQuery(dQuery), [dQuery])
  const active = hasFilter(filters)
  const results = useMemo(
    () => (active ? units.filter((l) => matchListing(l, filters)) : []),
    [active, units, filters])

  // Hash diperbarui tanpa menambah entri history per ketukan (replaceState tidak
  // memicu hashchange) — link tetap bisa di-share, tapi tombol back tidak
  // terjebak melangkahi 20 huruf yang barusan diketik.
  useEffect(() => {
    if (route.name !== 'home') return
    const qs = stateToQuery(dQuery.trim(), panel, sort)
    const want = qs ? '#/?' + qs : '#/'
    if (window.location.hash !== want && (window.location.hash || '#/') !== want) {
      window.history.replaceState(null, '', want)
    }
  }, [dQuery, panel, sort, route.name])

  // Pencarian dari URL (link yang di-share / tombol back) masuk balik ke input.
  useEffect(() => {
    setQuery((prev) => (route.q !== prev ? route.q : prev))
  }, [route.q])

  // "Search bukan pajangan": begitu ada hasil, halaman langsung meluncur ke
  // etalase. Hanya dipicu saat pencarian BARU dimulai (kosong → ada isi), bukan
  // tiap huruf — kalau tidak, halaman akan menyentak terus sambil user mengetik.
  const searching = useRef(false)
  useEffect(() => {
    if (route.name !== 'home') return
    if (active && results.length > 0 && !searching.current) {
      searching.current = true
      scrollToEtalase()
    } else if (!active) {
      searching.current = false
    }
  }, [active, results.length, route.name, scrollToEtalase])

  useEffect(() => {
    const onHash = () => { setRoute(parseHash()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Menu hamburger mobile: tutup saat pindah route atau tekan Escape.
  useEffect(() => { setMenuOpen(false) }, [route])
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Tugas 13a: suara klik "berat" untuk tombol utama. Delegasi satu listener
  // di document — memutar thunk saat tombol primer (accent/dark) diklik. Karena
  // hanya dipicu klik (user gesture), autoplay policy aman tanpa toggle wajib.
  useEffect(() => {
    const onClick = (e) => {
      const btn = e.target.closest('.btn-accent, .btn-dark')
      if (btn && !btn.disabled) playThunk()
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  // Muat baris profiles milik user yang login. Dulu error-nya DITELAN
  // (.then(({data}) => setProfile(data))): kalau RLS menolak atau barisnya tidak
  // ada, data jadi null dan hasilnya identik dengan "bukan admin" — tanpa jejak
  // apa pun. Itulah kenapa admin baru yang gagal akses tidak memberi petunjuk.
  // Sekarang error & "baris tidak ada" dibedakan, dicatat, dan disimpan ke
  // state supaya layar admin bisa menjelaskan penyebab persisnya.
  const loadProfile = useCallback(async () => {
    if (!supabase || !session) { setProfile(null); setProfileErr(''); setProfileReady(false); return }
    setProfileReady(false)
    const { data, error } = await supabase.from('profiles')
      .select('*').eq('id', session.user.id).maybeSingle()
    if (error) {
      console.error('[PROFILE] Gagal memuat baris profiles:', error.message)
      setProfile(null); setProfileErr(error.message); setProfileReady(true)
      return
    }
    if (!data) {
      console.warn('[PROFILE] Tidak ada baris profiles untuk user', session.user.id,
        '— role tak bisa ditentukan (trigger signup / backfill belum jalan?)')
    }
    setProfile(data); setProfileErr(''); setProfileReady(true)
  }, [session])

  useEffect(() => { loadProfile() }, [loadProfile])

  const isStaff = Boolean(profile && ['admin', 'kurator'].includes(profile.role))

  // Etalase publik: unit 'published' + 'booked'. Unit ter-DP sengaja TETAP
  // tampil — dengan badge "Hampir Terjual" — sebagai pemicu urgensi; tombol
  // booking-nya mati sendiri karena canBook menuntut status 'published'.
  // Unit 'sold' tetap TIDAK diambil: etalase jangan berisi barang mati.
  // Kalau booking batal, trigger DB mengembalikannya ke 'published'.
  // Catatan: statusBadge() bergantung pada daftar status ini — kalau 'sold'
  // nanti ikut ditampilkan, tambahkan juga cabang badge-nya di sana.
  const loadListings = useCallback(async () => {
    if (!supabase) return
    // Saat jaringan mati, klien Supabase mencoba ulang request tanpa henti dan
    // promise-nya TIDAK PERNAH settle — try/catch saja tidak menolong, etalase
    // akan terkunci di "memuat" selamanya. abortSignal memberi batas waktu tegas.
    const ctrl = new AbortController()
    const killer = setTimeout(() => ctrl.abort(), 12000)
    try {
      const { data, error } = await supabase.from('listings')
        .select('*, mod_parts_relation:motor_mod_parts(mod_part_id, mod_parts(*))')
        .in('status', ['published', 'booked'])
        .order('published_at', { ascending: false })
        .abortSignal(ctrl.signal)
      // Dulu error di sini ditelan diam-diam sehingga etalase gagal-muat
      // tampak persis seperti etalase kosong.
      if (error) throw new Error(error.message)
      setListings((data || []).map((l) => ({
        ...l,
        source: 'official',
        mod_parts: (l.mod_parts_relation || []).map((mpr) => mpr.mod_parts).filter(Boolean),
      })))
      setListError('')
    } catch (e) {
      // Jaringan mati membuat fetch REJECT (bukan mengembalikan {error}), jadi
      // tanpa catch di sini promise-nya menggantung dan etalase terkunci di
      // status "memuat" selamanya.
      // Kegagalan jaringan datang sebagai "TypeError: Failed to fetch" — tidak
      // ada artinya buat pembeli motor, jadi diterjemahkan ke bahasa manusia.
      const raw = e.message || ''
      const offline = ctrl.signal.aborted || /failed to fetch|networkerror|load failed/i.test(raw)
      console.error('[SUPABASE] Gagal memuat listings:', raw || '(tanpa pesan)')
      setListError(offline ? 'koneksi ke server bermasalah' : raw)
    } finally {
      // finally: apa pun hasilnya, spinner harus berhenti.
      clearTimeout(killer)
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!supabase) return
    loadListings()
    const ch = supabase.channel('public-listings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'listings' }, loadListings)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [loadListings])

  // Titip jual yang sudah 'approved' → dinormalkan & digabung ke etalase (di
  // bawah unit resmi, lihat sortListings). Kegagalannya SENGAJA tidak
  // memblok etalase resmi: kalau tabelnya belum ada (migrasi 0003 belum jalan)
  // atau error, titip jual kosong tapi etalase resmi tetap tampil.
  const loadTitipJual = useCallback(async () => {
    if (!supabase) return
    const { data, error } = await supabase.from('titip_jual_units')
      .select('*').eq('status', 'approved').order('reviewed_at', { ascending: false })
    if (error) {
      console.warn('[TITIP] Gagal memuat titip jual (etalase resmi tetap jalan):', error.message)
      setTitipUnits([])
      return
    }
    setTitipUnits((data || []).map(normalizeTitip))
  }, [])

  useEffect(() => {
    if (!supabase) return
    loadTitipJual()
    const ch = supabase.channel('public-titip')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'titip_jual_units' }, loadTitipJual)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [loadTitipJual])

  // deep link ke unit yang tidak ada di etalase publik (booked/sold/draft)
  useEffect(() => {
    if (route.name !== 'unit' || !supabase) { setDeepUnit(null); return }
    const found = units.find((l) => l.slug === route.slug)
    if (found) { setDeepUnit(null); return }
    // Slug titip jual ('tj-...') yang tak ada di units berarti belum approved →
    // tidak boleh dibuka publik; jangan query tabel listings untuknya.
    if (String(route.slug).startsWith('tj-')) { setDeepUnit(null); return }
    supabase.from('listings').select('*').eq('slug', route.slug).maybeSingle()
      .then(({ data }) => setDeepUnit(data ? { ...data, source: 'official' } : null))
  }, [route, units])

  // lanjutkan booking otomatis setelah login
  useEffect(() => {
    if (!session || !pending) return
    const l = listings.find((x) => x.slug === pending.slug)
    const w = WARRANTIES.find((x) => x.code === pending.wcode) || WARRANTIES[0]
    if (l && l.status === 'published') setBooking({ listing: l, warranty: w })
    setPending(null)
  }, [session, pending, listings])

  const requestBooking = useCallback((listing, warranty) => {
    if (PAYMENT_MODE === 'whatsapp') {
      // window.open harus tetap sinkron di dalam gesture klik (supaya tidak
      // diblokir popup blocker) — overlay handoff cuma lapisan visual di
      // atasnya, tidak menunda pembukaan tab WhatsApp yang sesungguhnya.
      openWhatsAppCS(listing, toast, warranty)
      setWaHandoff(true)
      setTimeout(() => setWaHandoff(false), 1100)
      return
    }
    if (!session) {
      setPending({ slug: listing.slug, wcode: warranty.code })
      setAuthOpen(true)
      toast('Masuk dulu untuk booking DP')
      return
    }
    setBooking({ listing, warranty })
  }, [session, toast])

  // Riwayat dicatat saat halaman unit BENAR-BENAR terbuka & unitnya ketemu —
  // bukan saat kartunya diklik. Slug ngawur atau unit yang sudah hilang tidak
  // ikut mengotori riwayat. Ditaruh sebelum early-return konfigurasi di bawah
  // karena hook tidak boleh dipanggil setelah return bersyarat.
  useEffect(() => {
    if (route.name !== 'unit') return
    const l = listings.find((x) => x.slug === route.slug) ||
      (deepUnit && deepUnit.slug === route.slug ? deepUnit : null)
    if (l && l.id) setRecent(pushRecent(l.id))
  }, [route.name, route.slug, listings, deepUnit])

  if (!supabase) {
    return (
      <div className="cfg">
        <style>{CSS}</style>
        <div>
          <b>Konfigurasi belum lengkap.</b><br /><br />
          Isi environment variable <code>VITE_SUPABASE_URL</code> dan{' '}
          <code>VITE_SUPABASE_ANON_KEY</code> (lihat <code>.env.example</code>),
          lalu deploy ulang. Di Vercel: Settings → Environment Variables.
        </div>
      </div>
    )
  }

  const current = route.name === 'unit'
    ? (units.find((l) => l.slug === route.slug) || deepUnit)
    : null

  return (
    <>
      <style>{CSS}</style>

      <header className={'nav' + (scrolled ? ' scrolled' : '')}>
        <div className="container nav-in">
          <a className="logo" href="#/" onClick={(e) => { e.preventDefault(); nav('#/') }}>
            MOTORELL<i>●</i><small>MARKET</small>
          </a>
          <NavSearch
            value={query}
            onChange={(v) => {
              setQuery(v)
              // kalau mengetik dari halaman lain, bawa ke etalase supaya hasil terlihat
              if (v && route.name !== 'home') nav('#/')
            }}
            onSubmit={goEtalase}
            results={results.slice(0, 5)}
            total={results.length}
            filters={filterChips(filters)}
            words={filters.text ? filters.text.split(' ') : []}
            onPick={(l) => { setQuery(''); nav('#/unit/' + l.slug) }}
            onQuick={(text) => { setQuery(text); if (route.name !== 'home') nav('#/') }} />
          <div className="nav-actions">
            {/* Di mobile deretan tombol ini dilipat ke menu dropdown (buka lewat
                hamburger) supaya tak meluber/terpotong. Di desktop tetap inline. */}
            <div className={'nav-links' + (menuOpen ? ' open' : '')}>
              {isStaff && route.name !== 'admin' && (
                <button className="btn btn-quiet btn-sm" onClick={() => { nav('#/admin'); setMenuOpen(false) }}>Panel admin</button>)}
              {route.name !== 'titip' && (
                <button className="btn btn-ghost btn-sm" onClick={() => { nav('#/titip-jual'); setMenuOpen(false) }}
                  title="Titip jual motor Anda di Motorell">Titip Jual</button>)}
              <button className="btn btn-ghost btn-sm nav-loc" onClick={() => { setMenuOpen(false); goLokasi() }} title="Lokasi showroom Motorell">
                <svg className="nav-loc-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" />
                  <circle cx="12" cy="11" r="2.2" />
                </svg>
                <span className="nav-loc-label">Lokasi</span>
              </button>
              {session ? (
                <button className="btn btn-ghost btn-sm"
                  onClick={async () => { setMenuOpen(false); await supabase.auth.signOut(); toast('Kamu sudah keluar'); if (route.name === 'admin') nav('#/') }}>
                  Keluar{profile ? ' · ' + (profile.full_name || '').split(' ')[0] : ''}
                </button>
              ) : (
                <button className="btn btn-dark btn-sm" onClick={() => { setMenuOpen(false); setAuthOpen(true) }}>Masuk</button>
              )}
            </div>
            <button className="nav-burger" aria-label={menuOpen ? 'Tutup menu' : 'Buka menu'}
              aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" aria-hidden="true">
                {menuOpen
                  ? <><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>
                  : <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>}
              </svg>
            </button>
          </div>
        </div>
        {menuOpen && <div className="nav-menu-backdrop" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
      </header>

      <main>
        {route.name === 'home' && (
          <HomeView listings={units} nav={nav}
            query={dQuery} filters={filters} searchActive={active}
            loading={listLoading} error={listError}
            panel={panel} setPanel={setPanel} resetPanel={resetPanel}
            sort={sort} setSort={setSort}
            recent={recent} clearRecent={clearRecent} />)}

        {route.name === 'kebijakan' && <KebijakanView nav={nav} />}

        {route.name === 'titip' && (
          <TitipJualView session={session} nav={nav} toast={toast}
            onLoginClick={() => setAuthOpen(true)} />)}

        {route.name === 'unit' && (current
          ? <DetailView listing={current} nav={nav} onBook={requestBooking} />
          : <section className="detail"><div className="container">
              <a className="back" href="#/" onClick={(e) => { e.preventDefault(); nav('#/') }}>← Kembali ke etalase</a>
              <p style={{ color: 'var(--muted)' }}>Unit tidak ditemukan atau sudah tidak tayang.</p>
            </div></section>)}

        {route.name === 'admin' && (isStaff
          ? <AdminPanel profile={profile} toast={toast} nav={nav} />
          : <section className="admin"><div className="container">
              <p className="kicker">Panel admin</p>
              <h1 style={{ margin: '14px 0 12px', fontWeight: 750, letterSpacing: '-.02em' }}>Khusus staf Motorell</h1>
              <p style={{ color: 'var(--muted)', maxWidth: 460, lineHeight: 1.6 }}>
                Masuk dengan akun yang berperan admin atau kurator untuk mengelola etalase.</p>
              {!session && <div style={{ marginTop: 20 }}>
                <button className="btn btn-accent" onClick={() => setAuthOpen(true)}>Masuk</button></div>}
              {/* Selagi role masih diambil, jangan tuduh apa-apa dulu. */}
              {session && !profileReady && (
                <p className="f-info" style={{ marginTop: 18 }}>Memeriksa akses…</p>)}
              {/* Diagnostik: saat SUDAH login, role SUDAH selesai dibaca, tapi
                  belum diakui staf — tampilkan penyebab persisnya. Ini yang
                  mengubah "tombol tidak muncul, entah kenapa" jadi jawaban
                  langsung: bedakan role kurang, baris profiles tidak ada, atau
                  RLS menolak. Hanya menampilkan data milik user itu sendiri. */}
              {session && profileReady && (
                <div className="admin-diag">
                  <b>Kamu sudah login, tapi akun ini belum diakui sebagai staf.</b>
                  <dl>
                    <div><dt>User ID</dt><dd className="mono">{session.user.id}</dd></div>
                    <div><dt>Baris profiles</dt><dd>{profileErr ? 'gagal dibaca' : profile ? 'ada' : 'TIDAK ADA'}</dd></div>
                    <div><dt>Role terbaca</dt><dd className="mono">{profile ? String(profile.role) : '—'}</dd></div>
                    {profileErr && <div><dt>Error</dt><dd className="mono">{profileErr}</dd></div>}
                  </dl>
                  <p className="admin-diag-hint">
                    {profileErr
                      ? 'Baris profiles-mu tidak bisa dibaca — kemungkinan kebijakan RLS. Lihat supabase/migrations/0002_profiles_admin_role.sql.'
                      : !profile
                        ? 'Belum ada baris profiles untuk akun ini, jadi role tidak bisa disetel. Jalankan migrasi 0002 (membuat trigger + mengisi baris yang hilang), lalu minta admin menyetel role-mu.'
                        : 'Baris profiles ada tapi role-nya belum admin/kurator. Minta admin lain menyetelnya di Panel admin → Staf. Kalau baru saja diubah, klik Muat ulang atau keluar-masuk lagi.'}
                  </p>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
                    <button className="btn btn-ghost btn-sm" onClick={loadProfile}>Muat ulang peran</button>
                    <button className="btn btn-ghost btn-sm"
                      onClick={async () => { await supabase.auth.signOut(); toast('Kamu sudah keluar — masuk lagi untuk menyegarkan peran'); }}>
                      Keluar &amp; masuk lagi</button>
                  </div>
                </div>
              )}
            </div></section>)}
      </main>

      <footer>
        <div className="container">
          <div className="foot">
            <div className="foot-logo">
              <span className="logo">MOTORELL<i>●</i></span>
              <span className="foot-est">Est. 2023</span>
            </div>
            <div className="foot-links">
              <a href="#etalase" onClick={() => nav('#/')}>Etalase</a>
              <a href="#kurasi" onClick={() => nav('#/')}>Standar kurasi</a>
              <a href="#/kebijakan" onClick={(e) => { e.preventDefault(); nav('#/kebijakan') }}>Kebijakan refund DP</a>
              <a href="#/kebijakan" onClick={(e) => { e.preventDefault(); nav('#/kebijakan') }}>Syarat &amp; ketentuan</a>
              <a href="#/kebijakan" onClick={(e) => { e.preventDefault(); nav('#/kebijakan') }}>Kebijakan privasi</a>
            </div>
          </div>
          <div className="foot-socials">
            <span className="foot-socials-label">Ikuti kami</span>
            <div className="social-links">
              <button type="button" className="social-link" onClick={() => openSocialApp('instagram')}
                title="Follow Motorell di Instagram">
                <svg className="social-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="2" y="2" width="20" height="20" rx="5.5" />
                  <circle cx="12" cy="12" r="4.2" />
                  <circle cx="17.6" cy="6.4" r="1.1" fill="currentColor" stroke="none" />
                </svg>
                <span className="social-label">Instagram</span>
              </button>
              <button type="button" className="social-link" onClick={() => openSocialApp('youtube')}
                title="Tonton Motorell di YouTube">
                <svg className="social-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M23.5 6.9a3 3 0 0 0-2.1-2.1C19.5 4.3 12 4.3 12 4.3s-7.5 0-9.4.5A3 3 0 0 0 .5 6.9 31.4 31.4 0 0 0 0 12a31.4 31.4 0 0 0 .5 5.1 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.4 31.4 0 0 0 24 12a31.4 31.4 0 0 0-.5-5.1zM9.6 15.6V8.4l6.2 3.6z" />
                </svg>
                <span className="social-label">YouTube</span>
              </button>
              <button type="button" className="social-link" onClick={() => openSocialApp('tiktok')}
                title="Follow Motorell di TikTok">
                <svg className="social-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M16.7 2h-3.02v13.02a2.42 2.42 0 1 1-2.08-2.4V9.5a5.53 5.53 0 1 0 5.09 5.5V8.5a6.94 6.94 0 0 0 4.06 1.3V6.76a3.9 3.9 0 0 1-2.72-1.1A3.9 3.9 0 0 1 16.7 2z" />
                </svg>
                <span className="social-label">TikTok</span>
              </button>
            </div>
          </div>
          <div className="foot-base">
            <span>© {new Date().getFullYear()} MOTORELL — INDONESIA</span>
            <span className="foot-brand">
              JUAL BELI MOTOR TERKURASI
              <small>Powered by <b>Motorell Garage</b></small>
            </span>
          </div>
          {/* Kredit model 3D hero — wajib demi lisensi Creative Commons Sketchfab. */}
          <p className="foot-credit">
            Model 3D:{' '}
            <a href="https://sketchfab.com/3d-models/harley-davidson-flhrxs-road-king-special-881433de7df245b3bc435360bb5006a9"
              target="_blank" rel="nofollow noopener noreferrer">Harley-Davidson FLHRXS Road King Special</a>
            {' by '}
            <a href="https://sketchfab.com/everhard"
              target="_blank" rel="nofollow noopener noreferrer">everhard</a>
            {' on '}
            <a href="https://sketchfab.com"
              target="_blank" rel="nofollow noopener noreferrer">Sketchfab</a>
          </p>
        </div>
      </footer>

      {authOpen && <AuthModal toast={toast} onClose={() => setAuthOpen(false)} onDone={() => setAuthOpen(false)} />}
      {booking && <BookingModal listing={booking.listing} warranty={booking.warranty}
        toast={toast} onClose={() => setBooking(null)} />}
      <WaHandoff show={waHandoff} />

      <div className={'toast' + (toastMsg ? ' show' : '')} role="status">{toastMsg}</div>
    </>
  )
}