// ============================================================
// MOTORELL MARKET — src/App.jsx (single-file SPA)
// Tema: showroom terang ala Porsche (putih, lapang, bersih)
// Stack: React + Vite + Supabase (auth, DB, storage, realtime)
// Pembayaran: Edge Function create-dp-payment -> Midtrans QRIS
// ============================================================

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence, animate, useScroll, useTransform, useInView } from 'framer-motion'
import { createClient } from '@supabase/supabase-js'
import QRCode from 'qrcode'
import * as THREE from 'three'
import ArchiveTab from './ArchiveTab';
import ModPartPanel from './ModPartPanel';
import MotorCarousel from './MotorCarousel';
import Blueprint from './Blueprint';
import { MOD_CATEGORIES, catOf } from './modParts';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

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

const rupiah = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(Number(n) || 0))
const fmt = (n) => new Intl.NumberFormat('id-ID').format(Number(n) || 0)
const slugify = (s) =>
  String(s).toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const STATUS_LABEL = {
  draft: 'Draft', published: 'Tayang', booked: 'Di-booking', sold: 'Terjual', delisted: 'Arsip',
}

const GRADE_DESC = {
  S: 'Istimewa, seperti baru — minus nyaris tidak ada.',
  A: 'Siap pakai, kondisi terawat sesuai umur.',
  B: 'Minus ringan tercatat jujur di halaman detail.',
}

// Definisi grade lengkap — tampil sebagai kartu penjelasan di section kurasi.
const GRADE_DEF = [
  { g: 'S', text: 'Tidak berpatokan pada kilometer rendah, tapi meliputi seluruh kelayakan mesin, tampilan, dan suku cadang dalam kondisi prima — nyaris tidak ada minus.' },
  { g: 'A', text: 'Unit siap pakai, terawat sesuai umur, tanpa masalah yang berarti.' },
  { g: 'B', text: 'Minus ringan tercatat jujur dan tetap layak untuk digunakan sehari-hari.' },
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

function buildWaMessage(listing) {
  return 'Halo Motorell, saya mau tanya soal ' + listing.title + ' (' + rupiah(listing.price) + '). ' +
    'Apakah masih tersedia?'
}

function openWhatsAppCS(listing, toast) {
  toast('Kamu akan diarahkan ke WhatsApp CS kami untuk melanjutkan pembayaran')
  const url = 'https://wa.me/' + CS_WHATSAPP_NUMBER + '?text=' + encodeURIComponent(buildWaMessage(listing))
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
.nav-in{display:flex;align-items:center;justify-content:space-between;
  padding-block:calc(16px + env(safe-area-inset-top)) 16px}
.logo{font-weight:800;font-size:19px;letter-spacing:.01em;display:flex;
  align-items:center;gap:8px}
.logo i{font-style:normal;color:var(--accent);font-size:15px}
.logo small{font-family:var(--mono);font-weight:500;font-size:10px;
  letter-spacing:.22em;color:var(--dim)}
.nav-actions{display:flex;align-items:center;gap:10px}
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
.hero{position:relative;min-height:0;display:flex;align-items:flex-end;
  padding:128px 0 56px;border-bottom:1px solid var(--line);overflow:hidden;
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
.hero-3d{position:absolute;inset:0;z-index:1;opacity:.5}
/* touch-action:none — drag vertikal DI ATAS motor mengontrol tilt kamera,
   scroll halaman tetap jalan lewat area teks/CTA (pointer-events:auto) */
.bike3d{position:absolute;inset:0;cursor:grab;touch-action:none}
.bike3d:active{cursor:grabbing}
.bike3d canvas{display:block;width:100% !important;height:100% !important}
/* petunjuk gesture — di dalam flow (bawah CTA) supaya tidak pernah
   menimpa teks lain di ukuran layar mana pun */
.bike3d-hint{display:inline-flex;align-items:center;gap:8px;pointer-events:none;
  margin-top:22px;font-family:var(--mono);font-size:10.5px;font-weight:600;
  letter-spacing:.1em;text-transform:uppercase;color:var(--muted);
  background:rgba(255,255,255,.88);backdrop-filter:blur(8px);
  border:1px solid var(--line);padding:8px 14px;border-radius:999px;
  white-space:nowrap;animation:hint-bob 2.2s ease-in-out infinite}
.bike3d-hint svg{width:16px;height:16px;color:var(--accent)}
@keyframes hint-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
.bike3d-fallback-photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero-fade{position:absolute;inset:0;z-index:2;pointer-events:none;
  background:linear-gradient(0deg, rgba(255,255,255,.97) 0%, rgba(255,255,255,.55) 46%, rgba(255,255,255,.1) 100%)}
/* pointer-events:none supaya drag di atas motor tembus ke canvas 3D di bawah;
   hanya ELEMEN teks/tombol yang menangkap pointer — bukan kotak containernya,
   supaya ruang kosong di sekitar teks tetap bisa dipakai gesture 3D dan
   scroll via sentuhan pada teks tetap normal */
.hero-inner{position:relative;z-index:3;width:100%;pointer-events:none}
.hero-copy{pointer-events:none}
.hero-copy h1,.hero-copy p,.spec-rail{pointer-events:auto}
.hero-cta{pointer-events:none}
.hero-cta .btn{pointer-events:auto}
.hero-copy{max-width:100%}
.hero-copy h1{font-size:clamp(46px,6.4vw,86px);font-weight:750;line-height:.97;
  letter-spacing:-.03em;margin:22px 0 22px}
.hero-copy h1 em{font-style:normal;color:var(--accent)}
.hero-copy p{font-size:16.5px;line-height:1.62;color:var(--muted);max-width:440px;margin-bottom:26px}
.hero-copy .from{font-family:var(--mono);font-size:13px;color:var(--ink);margin-bottom:28px}
.hero-copy .from b{color:var(--accent)}
.hero-cta{display:flex;gap:12px;flex-wrap:wrap}
/* strip spesifikasi tipis ala lembar spek — label mono kecil di atas,
   angka besar di bawah, dipisah whitespace (bukan kotak-kotak card) */
.spec-rail{display:grid;grid-template-columns:1fr;gap:22px;
  margin-top:32px;padding-top:24px;border-top:1px solid var(--line-2);max-width:100%}
.spec-rail span{display:flex;flex-direction:column;gap:9px;font-family:var(--mono);
  font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.spec-rail b{color:var(--ink);font-size:clamp(19px,5vw,29px);font-weight:750;
  letter-spacing:-.02em;line-height:1;font-family:var(--font);white-space:nowrap}

/* ---------- section ---------- */
/* overflow-x:clip — menahan elemen reveal yang meluncur dari sisi (translateX)
   agar tidak memicu horizontal scroll di HP, tanpa membuat scroll-container
   vertikal (overflow-y tetap visible) */
.section{padding:clamp(76px,11vw,132px) 0;overflow-x:clip}
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
.card{width:100%;height:100%;background:var(--panel);border:1px solid var(--line);
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
.card-reveal{position:absolute;inset:auto 0 0 0;z-index:2;
  padding:16px 14px 13px;font-size:12.5px;line-height:1.45;font-weight:500;
  color:#fff;background:linear-gradient(0deg,rgba(10,10,12,.82) 0%,rgba(10,10,12,0) 100%);
  clip-path:inset(100% 0 0 0);transition:clip-path .45s cubic-bezier(.2,.8,.25,1)}
.card:hover .card-reveal{clip-path:inset(0 0 0 0)}
.badge{position:absolute;bottom:13px;left:13px;z-index:2;font-family:var(--mono);font-size:10.5px;
  font-weight:600;letter-spacing:.08em;padding:6px 11px;border-radius:999px;
  background:rgba(255,255,255,.92);backdrop-filter:blur(6px);border:1px solid var(--line-2);
  color:var(--ink);transition:transform .25s ease;overflow:hidden}
.card:hover .badge{transform:translateY(-48px)}
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
.gallery-main{aspect-ratio:4/3;border-radius:14px;overflow:hidden;position:relative;
  background:radial-gradient(120% 120% at 50% 25%, #fbfbfa, var(--bg-3) 82%);
  border:1px solid var(--line)}
.gallery-main img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.gallery-main.has-photo img{cursor:zoom-in;touch-action:pan-y;user-select:none}
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
  width:auto;height:auto;object-fit:contain;cursor:grab;touch-action:pan-y;user-select:none}
.lightbox img:active{cursor:grabbing}
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
.dtabs{display:flex;gap:2px;border-bottom:1px solid var(--line);overflow-x:auto}
.dtabs button{padding:13px 16px;font-size:14px;font-weight:600;color:var(--muted);
  position:relative;white-space:nowrap;flex:none;transition:color .2s}
.dtabs button:hover{color:var(--ink)}
.dtabs button.on{color:var(--ink)}
.dtabs button.on::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;
  background:var(--accent)}
.dtab-body{padding-top:22px;font-size:15.5px;line-height:1.72;color:#33363c;
  max-width:60ch;white-space:pre-line;min-height:96px}
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
.a-head{display:flex;justify-content:space-between;align-items:center;gap:16px;
  flex-wrap:wrap;margin-bottom:28px}
.a-head h1{font-size:clamp(27px,3.4vw,40px);font-weight:750;letter-spacing:-.025em}
.a-tabs{display:flex;gap:6px;background:var(--bg-2);border:1px solid var(--line);
  border-radius:999px;padding:4px;width:fit-content;margin-bottom:24px}
.a-tabs button{padding:9px 18px;border-radius:999px;font-size:13.5px;font-weight:600;color:var(--muted)}
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
.st.published{color:var(--ok);border-color:rgba(31,157,85,.32);background:rgba(31,157,85,.06)}
.st.booked{color:var(--warn);border-color:rgba(184,121,27,.32);background:rgba(184,121,27,.06)}
.st.sold{color:var(--dim)}
.st.draft{color:var(--muted)}
.a-actions{display:flex;gap:7px;flex-wrap:wrap}
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
.foot .logo{font-size:24px}
.foot-links{display:flex;gap:24px;flex-wrap:wrap;font-size:13px;color:var(--muted)}
.foot-links a:hover{color:var(--accent)}
.foot-base{margin-top:28px;font-family:var(--mono);font-size:11px;color:var(--dim);
  display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
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
.mc{cursor:grab;touch-action:none;overflow:hidden;outline:none}
.mc:active{cursor:grabbing}
.mc.zoomed{cursor:move}
.mc:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.mc-stage{position:absolute;inset:0;will-change:transform}
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
.mc-angle{position:absolute;top:12px;left:12px;z-index:13;font-family:var(--mono);
  font-size:11px;font-weight:600;letter-spacing:.06em;color:var(--ink);
  background:rgba(255,255,255,.9);border:1px solid var(--line);padding:4px 10px;
  border-radius:999px;pointer-events:none}
.mc-reset{position:absolute;top:12px;right:12px;z-index:13;font-family:var(--mono);
  font-size:10.5px;font-weight:600;letter-spacing:.05em;color:var(--accent);
  background:rgba(255,255,255,.92);border:1px solid var(--line-2);padding:5px 11px;
  border-radius:999px}
.mc-reset:hover{border-color:var(--accent)}
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
  .spec-rail{grid-template-columns:repeat(3,1fr)}
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
}
@media(min-width:1021px){
  .grid{grid-template-columns:repeat(3,1fr)}
  .feature{grid-template-columns:1fr 1fr;gap:clamp(44px,6vw,88px)}
  .feature.flip .feature-media-slide{order:2}
  .detail-grid{grid-template-columns:7fr 5fr}
  .panel{position:sticky}
  .hero{min-height:94vh;min-height:94svh;min-height:94dvh;padding-top:148px}
  .hero-fade{background:
    linear-gradient(90deg, rgba(255,255,255,.99) 0%, rgba(255,255,255,.82) 30%, rgba(255,255,255,0) 56%),
    linear-gradient(0deg, rgba(255,255,255,.92) 0%, rgba(255,255,255,0) 24%)}
  .hero-3d{opacity:1}
  .hero-copy{max-width:580px}
  .spec-rail{max-width:900px}
}
/* layar sempit: sembunyikan label "MARKET" di logo supaya search bar & tombol
   Masuk tetap muat tanpa memicu horizontal scroll di HP kecil (≤560px) */
@media(max-width:560px){
  .logo small{display:none}
  .nav-search{margin:0 10px}
}
@media(prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}
  *{animation-duration:.001s !important;transition-duration:.001s !important}
  .card-media::after{display:none}
}
`

// ---------- Motor 3D interaktif (hero) ----------
// Dibuka dengan foto asli salah satu unit di etalase, lalu "menyingkap"
// jadi render 3D yang bisa diputar — bukan langsung tampil sebagai kartun.
function Bike3D({ introPhoto, onInteract }) {
  const mountRef = useRef(null)
  const [failed, setFailed] = useState(false)
  // ref supaya closure event handler di dalam effect selalu memanggil
  // callback terbaru tanpa perlu re-mount scene
  const interactRef = useRef(onInteract)
  interactRef.current = onInteract

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      setFailed(true)
      return
    }
    // Layar sempit (HP) dapat cap lebih rendah — hemat GPU tanpa kelihatan buram
    // karena render area-nya juga lebih kecil.
    const dprCap = window.innerWidth <= 480 ? 1.5 : 2
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.08
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    // environment map studio lembut — sumber pantulan realistis di bodi
    // krom/tangki, biar tidak flat seperti render kartun.
    const pmrem = new THREE.PMREMGenerator(renderer)
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = envTex
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50)
    // Framing kamera responsif terhadap aspect ratio kontainer, di antara dua
    // titik yang sudah ditentukan:
    // - WIDE  (aspect ≥ 1.7, hero desktop full-bleed): kamera "melihat" ke titik
    //   di kiri motor, bukan ke motornya langsung — mendorong motor ke sisi
    //   kanan, menyisakan ruang kosong di kiri untuk teks headline. Ini persis
    //   nilai lama, supaya tampilan desktop tidak berubah sama sekali.
    // - NARROW (aspect ≤ 0.62, hero mobile potret): kamera mundur & motor
    //   diposisikan di tengah, supaya seluruh bodi (roda depan-belakang,
    //   tangki, setang) tetap masuk frame — tidak lagi terpotong seperti
    //   sebelumnya saat frame sempit memakai framing versi wide.
    // Di antara dua titik itu, posisi & target di-interpolasi linear.
    const FRAME_WIDE = { pos: new THREE.Vector3(3.6, 1.55, 5.0), look: new THREE.Vector3(-1.6, 0.75, 0) }
    const FRAME_NARROW = { pos: new THREE.Vector3(1.9, 2.15, 9.4), look: new THREE.Vector3(0.05, 0.85, 0) }
    const ASPECT_WIDE = 1.7
    const ASPECT_NARROW = 0.62
    // Di atas base frame itu, user bisa menambah offset sendiri:
    // - elev  : tilt kamera naik/turun (drag vertikal), clamp -20°..35°
    // - zoom  : faktor jarak kamera (pinch dua jari), clamp 0.6..1.6
    // Keduanya di-lerp tiap frame supaya halus, dan double-tap mengembalikan
    // semuanya ke default dengan animasi (bukan snap).
    const ELEV_MIN = -20 * Math.PI / 180, ELEV_MAX = 35 * Math.PI / 180
    const ZOOM_MIN = 0.6, ZOOM_MAX = 1.6
    let elev = 0, targetElev = 0, zoom = 1, targetZoom = 1
    let curAspect = 1
    const _pos = new THREE.Vector3(), _look = new THREE.Vector3(), _sph = new THREE.Spherical()
    const updateCamera = () => {
      const t = THREE.MathUtils.clamp((curAspect - ASPECT_NARROW) / (ASPECT_WIDE - ASPECT_NARROW), 0, 1)
      _pos.lerpVectors(FRAME_NARROW.pos, FRAME_WIDE.pos, t)
      _look.lerpVectors(FRAME_NARROW.look, FRAME_WIDE.look, t)
      _sph.setFromVector3(_pos.sub(_look))
      // elev positif = kamera naik = phi mengecil; jaga phi tetap aman dari kutub
      _sph.phi = THREE.MathUtils.clamp(_sph.phi - elev, 0.18, Math.PI / 2 + 0.25)
      _sph.radius *= zoom
      camera.position.setFromSpherical(_sph).add(_look)
      camera.lookAt(_look)
    }
    updateCamera()

    scene.add(new THREE.HemisphereLight(0xffffff, 0xdfdfdb, 1.05))
    const key = new THREE.DirectionalLight(0xffffff, 2.7)
    key.position.set(3.4, 5.6, 3.2)
    key.castShadow = true
    // shadow map lebih kecil di layar HP — beda visualnya tak terlihat pada
    // render area kecil, tapi jauh lebih ringan untuk GPU kelas menengah
    const shadowRes = window.innerWidth < 768 ? 1024 : 2048
    key.shadow.mapSize.set(shadowRes, shadowRes)
    // frustum bayangan dirapatkan ke motor supaya resolusi bayangan terpakai
    // penuh (bayangan tajam mengikuti bentuk motor, bukan lingkaran samar)
    key.shadow.camera.near = 0.5
    key.shadow.camera.far = 22
    key.shadow.camera.left = -3
    key.shadow.camera.right = 3
    key.shadow.camera.top = 3
    key.shadow.camera.bottom = -3
    key.shadow.bias = -0.0004
    key.shadow.radius = 3
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xffe8d6, 0.5)
    fill.position.set(-4, 2, -3)
    scene.add(fill)
    const rim = new THREE.DirectionalLight(0xdfe9ff, 0.9)
    rim.position.set(-2.4, 3.2, -4.4)
    scene.add(rim)

    // lantai penangkap bayangan — opacity dinaikkan supaya bayangan motor
    // terlihat kontras & realistis mengikuti bentuk bodi, bukan noda samar
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(3, 64),
      new THREE.ShadowMaterial({ opacity: 0.34 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)

    // ---- rakit motor dari bentuk dasar (siluet neo-retro ala Yamaha XSR) ----
    // TODO(upgrade): geometri primitif Three.js tidak akan pernah fotorealistik
    // seperti render CGI/foto XSR asli. Untuk hasil "seperti foto", ganti blok
    // perakitan di bawah ini dengan IMPORT MODEL .glb (GLTFLoader) dari sumber
    // berlisensi (mis. Sketchfab berbayar) — muat model, pasang castShadow di
    // tiap mesh, lalu buang perakitan primitif ini. Yang di bawah adalah quick
    // win untuk mendekatkan siluet ke XSR, bukan pengganti model asli.
    const bike = new THREE.Group()
    const mat = (color, o = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3, envMapIntensity: 1, ...o })
    const physical = (color, o = {}) =>
      new THREE.MeshPhysicalMaterial({ color, roughness: 0.4, metalness: 0.5, envMapIntensity: 1.15, ...o })
    const M = {
      tire: mat('#17171b', { roughness: 0.93, metalness: 0.04, envMapIntensity: 0.3 }),
      rim: physical('#c9c9cf', { metalness: 0.95, roughness: 0.1, clearcoat: 0.6, clearcoatRoughness: 0.1 }),
      frame: mat('#1b1b21', { metalness: 0.55, roughness: 0.4 }),
      chrome: physical('#e4e4e8', { metalness: 0.97, roughness: 0.05, clearcoat: 0.9, clearcoatRoughness: 0.05, envMapIntensity: 1.5 }),
      tank: physical('#1a2f5e', { metalness: 0.55, roughness: 0.18, clearcoat: 1.0, clearcoatRoughness: 0.08, envMapIntensity: 1.5 }),
      dark: mat('#101014', { roughness: 0.85, metalness: 0.1, envMapIntensity: 0.5 }),
      engine: mat('#2d2d34', { metalness: 0.75, roughness: 0.32 }),
    }
    const shadowed = (m) => { m.castShadow = true; return m }
    const V = (x, y, z = 0) => new THREE.Vector3(x, y, z)
    const tube = (a, b, r, material) => {
      const dir = new THREE.Vector3().subVectors(b, a)
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, dir.length(), 14), material)
      mesh.position.copy(a).add(b).multiplyScalar(0.5)
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
      return shadowed(mesh)
    }

    // Proporsi mengacu gaya neo-retro Yamaha XSR: wheelbase ±2.1 unit,
    // roda jari-jari, garpu teleskopik menyudut, tangki teardrop, jok flat.
    const REAR = V(-1.02, 0.52), FRONT = V(1.08, 0.52)

    // ---- roda jari-jari (spoke wheel) ----
    const wheels = []
    const makeWheel = (x, front) => {
      const g = new THREE.Group()
      // ban lebih gambot (tube tebal) untuk kesan dual-purpose XSR; radius luar
      // dijaga ~0.52 supaya kontak ke lantai (bayangan) tetap pas
      g.add(shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.375, 0.145, 22, 52), M.tire)))
      g.add(shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 12, 40), M.rim)))
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.16, 18), M.engine)
      hub.rotation.x = Math.PI / 2
      g.add(shadowed(hub))
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2
        const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.28, 6), M.chrome)
        sp.position.set(Math.cos(a) * 0.19, Math.sin(a) * 0.19, i % 2 ? 0.035 : -0.035)
        sp.rotation.z = a - Math.PI / 2
        g.add(sp)
      }
      if (front) {
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.185, 0.185, 0.015, 30), M.chrome)
        disc.rotation.x = Math.PI / 2
        disc.position.z = 0.095
        g.add(disc)
      }
      g.position.set(x, 0.52, 0)
      bike.add(g)
      wheels.push(g)
    }
    makeWheel(REAR.x, false)
    makeWheel(FRONT.x, true)

    // ---- rangka (backbone + downtube + cradle + seat rail) ----
    bike.add(tube(V(0.55, 1.18), V(0.63, 1.34), 0.055, M.frame))       // steering head
    bike.add(tube(V(0.6, 1.3), V(-0.3, 1.06), 0.05, M.frame))          // backbone
    bike.add(tube(V(-0.3, 1.06), V(-0.92, 0.98), 0.038, M.frame))      // seat rail
    bike.add(tube(V(0.57, 1.22), V(0.38, 0.6), 0.045, M.frame))        // downtube
    bike.add(tube(V(0.38, 0.56), V(-0.3, 0.56), 0.04, M.frame))        // cradle bawah
    bike.add(tube(V(-0.3, 1.06), V(-0.32, 0.6), 0.045, M.frame))       // tiang belakang
    // swingarm (lengan ayun dua sisi)
    bike.add(tube(V(-0.32, 0.64, 0.1), V(REAR.x, REAR.y, 0.1), 0.032, M.frame))
    bike.add(tube(V(-0.32, 0.64, -0.1), V(REAR.x, REAR.y, -0.1), 0.032, M.frame))

    // ---- garpu depan teleskopik (menyudut/rake, dua tabung per sisi) ----
    for (const zs of [0.085, -0.085]) {
      bike.add(tube(V(0.66, 1.38, zs), V(0.88, 0.94, zs), 0.03, M.chrome))   // tabung atas
      bike.add(tube(V(0.88, 0.94, zs), V(FRONT.x, FRONT.y, zs), 0.042, M.dark)) // slider bawah
    }
    // segitiga penjepit (triple clamp)
    const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.26), M.engine)
    clamp.position.set(0.655, 1.36, 0)
    bike.add(shadowed(clamp))

    // ---- setang flat rendah (lebih sporty/rata dari sebelumnya) + grip ----
    bike.add(tube(V(0.64, 1.38), V(0.61, 1.44), 0.028, M.chrome))      // riser pendek
    bike.add(tube(V(0.61, 1.44, -0.34), V(0.61, 1.44, 0.34), 0.024, M.dark))  // bar flat
    for (const zs of [0.38, -0.38]) {
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.15, 12), M.dark)
      grip.rotation.x = Math.PI / 2
      grip.position.set(0.61, 1.44, zs)
      bike.add(shadowed(grip))
    }

    // ---- lampu depan bulat klasik ----
    const lampHouse = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.14, 24), M.engine)
    lampHouse.rotation.z = Math.PI / 2
    lampHouse.position.set(0.76, 1.2, 0)
    bike.add(shadowed(lampHouse))
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.125, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5),
      mat('#fff4dd', { emissive: 0xffe3b0, emissiveIntensity: 0.9, roughness: 0.25 }))
    lens.rotation.z = -Math.PI / 2
    lens.position.set(0.82, 1.2, 0)
    bike.add(lens)

    // ---- tangki teardrop besar & bulat (ciri khas XSR) + tutup bensin ----
    const tank = new THREE.Mesh(new THREE.SphereGeometry(0.5, 36, 28), M.tank)
    tank.scale.set(1.5, 0.66, 0.92)
    tank.position.set(0.12, 1.2, 0)
    tank.rotation.z = 0.06
    bike.add(shadowed(tank))
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.03, 14), M.chrome)
    cap.position.set(0.22, 1.5, 0)
    bike.add(cap)

    // ---- jok single flat, pendek & rata + buntut (seat cowl) ----
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.3), M.dark)
    seat.position.set(-0.5, 1.06, 0)
    bike.add(shadowed(seat))
    // single seat cowl belakang — sedikit meninggi menyerupai buntut XSR
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.26), M.dark)
    tail.position.set(-0.86, 1.1, 0)
    tail.rotation.z = 0.16
    bike.add(shadowed(tail))
    const tailLamp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.12),
      mat('#d02010', { emissive: 0xa01008, emissiveIntensity: 0.6 }))
    tailLamp.position.set(-0.97, 1.05, 0)
    bike.add(tailLamp)

    // ---- mesin: crankcase + silinder bersirip + tutup samping ----
    const crank = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.3, 0.32), M.engine)
    crank.position.set(0.02, 0.62, 0)
    bike.add(shadowed(crank))
    const cyl = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.28), M.engine)
    cyl.position.set(0.1, 0.9, 0)
    cyl.rotation.z = -0.15
    bike.add(shadowed(cyl))
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.018, 0.34), M.rim)
      fin.position.set(0.1 + (i - 1.5) * 0.0105, 0.9 + (i - 1.5) * 0.07, 0)
      fin.rotation.z = -0.15
      bike.add(fin)
    }
    const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 22), M.rim)
    cover.rotation.x = Math.PI / 2
    cover.position.set(-0.06, 0.6, 0.17)
    bike.add(cover)

    // ---- knalpot: header melengkung + muffler ----
    const exCurve = new THREE.CatmullRomCurve3([
      V(0.16, 0.8, 0.17), V(0.36, 0.6, 0.2), V(0.3, 0.44, 0.2),
      V(-0.2, 0.42, 0.21), V(-0.72, 0.5, 0.22),
    ])
    bike.add(shadowed(new THREE.Mesh(new THREE.TubeGeometry(exCurve, 32, 0.042, 12), M.chrome)))
    const mufDir = new THREE.Vector3().subVectors(V(-1.18, 0.56, 0.22), V(-0.72, 0.5, 0.22))
    const muffler = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, mufDir.length(), 18), M.chrome)
    muffler.position.set(-0.95, 0.53, 0.22)
    muffler.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), mufDir.normalize())
    bike.add(shadowed(muffler))

    // ---- twin shock belakang (per aksen oranye) ----
    for (const zs of [0.155, -0.155]) {
      bike.add(tube(V(-0.6, 1.0, zs), V(-0.92, 0.56, zs), 0.024, M.chrome))
      const springDir = new THREE.Vector3().subVectors(V(-0.84, 0.67, zs), V(-0.68, 0.89, zs))
      const spring = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, springDir.length(), 12), M.tank)
      spring.position.set(-0.76, 0.78, zs)
      spring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), springDir.normalize())
      bike.add(spring)
    }

    // ---- spatbor pendek depan & belakang ----
    const fenderF = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.035, 10, 26, Math.PI * 0.42), M.frame)
    fenderF.position.set(FRONT.x, FRONT.y, 0)
    fenderF.rotation.z = Math.PI * 0.32
    bike.add(shadowed(fenderF))
    const fenderR = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.04, 10, 26, Math.PI * 0.4), M.frame)
    fenderR.position.set(REAR.x, REAR.y, 0)
    fenderR.rotation.z = Math.PI * 0.38
    bike.add(shadowed(fenderR))

    bike.position.y = 0.02
    scene.add(bike)

    // ---- interaksi: 1 jari = putar (X) + tilt (Y), 2 jari = pinch zoom,
    //      double-tap = reset kamera. Dilepas → momentum, lalu auto-spin. ----
    const ROT_DEFAULT = -0.6
    // sudut awal intro sengaja lebih dramatis (3/4 lebih menyamping) daripada
    // ROT_DEFAULT murni, yang kalau dilihat dari diam saja cenderung tampak
    // hampir dari depan lurus — ketahuan pas foto pembuka lama dihapus
    const INTRO_HOLD_ROT = ROT_DEFAULT + 0.55
    let rotY = INTRO_HOLD_ROT, targetY = INTRO_HOLD_ROT, lastX = 0, lastY = 0
    let velY = 0 // kecepatan sudut terakhir, dipakai sebagai inertia saat dilepas
    let lastTapAt = 0, lastPinchDist = 0
    const pointers = new Map()
    const dragging = () => pointers.size > 0
    const autoSpin = !reduced

    // New state for suspension effect
    let suspensionOffset = 0;
    let targetSuspensionOffset = 0;

    const pinchDist = () => {
      const [a, b] = [...pointers.values()]
      return Math.hypot(a.x - b.x, a.y - b.y) || 1
    }
    const onDown = (e) => {
      introControls?.stop()
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      try { mount.setPointerCapture(e.pointerId) } catch { /* pointer sudah lepas */ }
      if (pointers.size === 1) {
        lastX = e.clientX; lastY = e.clientY; velY = 0
        // double-tap → kembalikan kamera & rotasi ke default (lerp di loop
        // yang membuat transisinya halus, bukan snap)
        const now = performance.now()
        if (now - lastTapAt < 320) {
          targetY = ROT_DEFAULT; targetElev = 0; targetZoom = 1;
          targetSuspensionOffset = 0; // Reset suspension
          lastTapAt = 0
        } else {
          lastTapAt = now
          targetSuspensionOffset = -0.01; // Apply suspension compression on first touch
        }
      } else if (pointers.size === 2) {
        lastPinchDist = pinchDist()
      }
      if (interactRef.current) interactRef.current()
    }
    const onMove = (e) => {
      if (!pointers.has(e.pointerId)) return
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size === 1) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY
        targetY += dx * 0.012
        velY = dx * 0.012
        targetElev = THREE.MathUtils.clamp(targetElev + dy * 0.006, ELEV_MIN, ELEV_MAX)
        lastX = e.clientX; lastY = e.clientY
      } else if (pointers.size === 2) {
        const d = pinchDist()
        // jari melebar (d naik) = zoom in = kamera mendekat (faktor < 1)
        targetZoom = THREE.MathUtils.clamp(targetZoom * (lastPinchDist / d), ZOOM_MIN, ZOOM_MAX)
        lastPinchDist = d
      }
    }
    const onUp = (e) => {
      pointers.delete(e.pointerId)
      if (pointers.size === 1) {
        const p = [...pointers.values()][0]
        lastX = p.x; lastY = p.y
      }
      targetSuspensionOffset = 0; // Release suspension
    }
    mount.addEventListener('pointerdown', onDown)
    mount.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)

    // ---- intro sinematik: hold sejenak di framing hero, lalu kamera
    //      menyapu (arc) sambil mendekat (push-in) dengan percepatan
    //      progresif — meniru pola referensi (hold → ease-in, TANPA
    //      ease-out, seolah "dipotong" saat masih bergerak cepat).
    //      Begitu selesai, sisa kecepatan diserahkan ke sistem momentum
    //      yang sudah ada supaya nyambung mulus ke auto-spin, bukan
    //      berhenti mendadak. Kode asli (bukan video), jadi tetap ringan
    //      dan interaktif — drag/pinch user langsung menghentikan intro. ----
    let introControls = null
    let introRaf1 = 0, introRaf2 = 0
    if (!reduced) {
      const INTRO_ZOOM = 0.78 // seberapa dekat kamera mendorong masuk
      // Setup scene (PMREM, puluhan mesh) + overhead awal halaman bisa
      // menyita waktu nyata sebelum browser sempat render frame pertama.
      // animate() mengukur progres dari WAKTU ASLI, bukan jumlah frame —
      // kalau jamnya mulai sebelum browser sempat "bernapas", separuh
      // durasi sudah "kebobolan" begitu render pertama tampil, dan intro
      // kelihatan langsung selesai/snap. Tunda mulainya 2 frame supaya
      // jamnya baru jalan setelah render benar-benar berjalan mulus.
      introRaf1 = requestAnimationFrame(() => {
        introRaf2 = requestAnimationFrame(() => {
          introControls = animate(0, 1, {
            duration: 2.3,
            ease: 'circIn', // datar di awal (hold), lalu berakselerasi tajam
            onUpdate: (p) => {
              // dari sudut hold dramatis → mendarat pas di ROT_DEFAULT (baseline
              // yang framing kameranya sudah di-tuning untuk komposisi hero)
              targetY = INTRO_HOLD_ROT + (ROT_DEFAULT - INTRO_HOLD_ROT) * p
              targetZoom = 1 + (INTRO_ZOOM - 1) * p
            },
            onComplete: () => {
              // motor masih "bergerak" saat intro berakhir — momentum meluruh
              // alami lewat loop render, bukan snap balik ke posisi awal
              velY = -0.012
              targetZoom = 1
            },
          })
        })
      })
    }

    // ---- ukuran mengikuti kontainer ----
    const resize = () => {
      const w = mount.clientWidth || 1, h = mount.clientHeight || 1
      renderer.setSize(w, h)
      camera.aspect = w / h
      curAspect = camera.aspect
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(mount)

    // ---- loop render ----
    let raf, t = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      t += 0.016
      if (!dragging()) {
        // momentum: sisa kecepatan drag meluruh halus, lalu auto-spin pelan
        targetY += velY
        velY *= 0.94
        if (autoSpin) targetY += 0.0038
      }
      rotY += (targetY - rotY) * 0.08
      elev += (targetElev - elev) * 0.1
      zoom += (targetZoom - zoom) * 0.1
      suspensionOffset += (targetSuspensionOffset - suspensionOffset) * 0.1; // Smooth suspension change

      bike.rotation.y = rotY;
      // Dynamically adjust key light position based on bike rotation for shadow
      const lightRotateAmount = (rotY - ROT_DEFAULT) * 0.1; // Small adjustment
      key.position.set(3.4 * Math.cos(lightRotateAmount) + 3.2 * Math.sin(lightRotateAmount), 5.6, 3.2 * Math.cos(lightRotateAmount) - 3.4 * Math.sin(lightRotateAmount));


      updateCamera()
      if (!reduced) {
        bike.position.y = 0.02 + Math.sin(t * 1.3) * 0.018 + suspensionOffset; // Apply suspension offset
        for (const w of wheels) w.rotation.z -= 0.045
      }
      renderer.render(scene, camera)
    }
    loop()

    return () => {
      cancelAnimationFrame(raf)
      cancelAnimationFrame(introRaf1)
      cancelAnimationFrame(introRaf2)
      introControls?.stop()
      ro.disconnect()
      mount.removeEventListener('pointerdown', onDown)
      mount.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose()
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose())
          else o.material.dispose()
        }
      })
      renderer.dispose()
      envTex.dispose()
      pmrem.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
    }
  }, [])

  if (failed) {
    return introPhoto
      ? <img className="bike3d-fallback-photo" src={introPhoto} alt="" />
      : <Blueprint />
  }
  return (
    <div ref={mountRef} className="bike3d" role="img"
      aria-label="Model 3D motor Motorell — seret untuk memutar, cubit untuk zoom" />
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
    const files = Array.from(picked || []).filter((x) => x.type.startsWith('image/'))
    if (!files.length) return
    setErr('')
    const remaining = MAX_PHOTOS - photos.length
    if (remaining <= 0) {
      setErr('Maksimal ' + MAX_PHOTOS + ' foto per unit sudah tercapai. Hapus salah satu foto dulu untuk menambah yang baru.')
      return
    }
    if (files.length > remaining) {
      setErr('Maksimal ' + MAX_PHOTOS + ' foto per unit — hanya ' + remaining + ' foto pertama dari pilihanmu yang diunggah.')
    }
    const batch = files.slice(0, remaining)
    if (!editing) {
      slugRef.current = slugify((f.brand || 'unit') + ' ' + (f.model || '') + ' ' + f.year) + '-' + slugRef.current.slice(-4)
    }
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
      } catch (ex) {
        setErr('Gagal mengunggah foto: ' + (ex.message || 'coba lagi'))
        break
      }
    }
    setUpMsg('')
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

    onSaved();
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 'min(620px,100%)' }}>
        <div className="m-head">
          <div><h3>{editing ? 'Edit unit' : 'Tambah unit ke etalase'}</h3>
            <span className="sub">{editing ? initial.title : 'Data tampil publik — tanpa modal beli'}</span></div>
          <button className="m-close" onClick={onClose} aria-label="Tutup">✕</button>
        </div>
        <div className="m-body">
          <form onSubmit={save}>
            <div className="f-grid">
              <div className="field"><label htmlFor="u-brand">Merek</label>
                <input id="u-brand" value={f.brand} onChange={set('brand')} placeholder="Kawasaki" required /></div>
              <div className="field"><label htmlFor="u-model">Model</label>
                <input id="u-model" value={f.model} onChange={set('model')} placeholder="W175 SE" required /></div>
              <div className="field"><label htmlFor="u-year">Tahun</label>
                <input id="u-year" type="number" min="1980" max="2030" value={f.year} onChange={set('year')} required /></div>
              <div className="field"><label htmlFor="u-km">Odometer (km) — isi 0 jika belum dicek</label>
                <input id="u-km" type="number" min="0" value={f.mileage_km} onChange={set('mileage_km')} /></div>
              <div className="field"><label htmlFor="u-color">Warna</label>
                <input id="u-color" value={f.color} onChange={set('color')} placeholder="Hitam" /></div>
              <div className="field"><label htmlFor="u-price">Harga jual (Rp)</label>
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
              <div className="field full"><label htmlFor="u-desc">Deskripsi</label>
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
              <div className="field full">
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
                <input ref={fileRef} type="file" accept="image/*" multiple hidden
                  onChange={(e) => { const fl = Array.from(e.target.files || []); e.target.value = ''; handleFiles(fl) }} />
                {upMsg && <p className="f-info">{upMsg}</p>}
                <p className="f-info">Foto pertama = sampul di etalase. Seret thumbnail untuk mengubah urutan,
                  atau jatuhkan file gambar langsung ke area ini.</p>
              </div>
            </div>
            {err && <p className="f-err">{err}</p>}
            <div className="m-actions">
              <button className="btn btn-accent btn-full" disabled={busy || Boolean(upMsg)}>
                {busy ? 'Menyimpan…' : editing ? 'Simpan perubahan' : 'Simpan unit'}
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
                  <span>{p.email || p.id}</span>
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

// ---------- Panel admin ----------
function AdminPanel({ profile, toast, nav }) {
  const [view, setView] = useState('units') // units | staff
  const [rows, setRows] = useState(null)
  const [form, setForm] = useState(null) // null | {} (baru) | listing (edit)
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
            <button type="button" className={view === 'archive' ? 'on' : ''} onClick={() => setView('archive')}>Arsip</button>
            <button type="button" className={view === 'mod_parts' ? 'on' : ''} onClick={() => setView('mod_parts')}>Part Modifikasi</button>
          </div>
        )}

        {view === 'staff' && canManageStaff && <StaffPanel profile={profile} toast={toast} />}

        {view === 'archive' && <ArchiveTab />}

        {view === 'mod_parts' && canManageStaff && <ModPartPanel toast={toast} />}

        {view === 'units' && (
          <>
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
          onSaved={() => { setForm(null); load() }} />
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
function Reveal({ children, className = '', style }) {
  const ref = useRef(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (prefersReduced()) { setShown(true); return }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setShown(true); io.disconnect() }
    }, { threshold: 0.16 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
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
const fadeParent = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } },
}
const fadeChild = {
  hidden: { opacity: 0, y: 20 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.2, 0.7, 0.25, 1] } },
}

// Bungkus sekelompok elemen; anak-anaknya (FadeIn.Item) muncul bergiliran.
function FadeIn({ children, className = '', style, amount = 0.25, once = true }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once, amount })
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
function FadeItem({ children, className = '', style, as = 'div' }) {
  const M = motion[as] || motion.div
  return <M className={className} style={style} variants={fadeChild}>{children}</M>
}

// ---------- Tab detail teknis unit (fade transition antar konten) ----------
const DETAIL_TABS = [
  { id: 'unit', label: 'Tentang unit' },
  { id: 'kurasi', label: 'Catatan kurasi' },
  { id: 'garansi', label: 'Perlindungan' },
]

function DetailTabs({ listing }) {
  const [tab, setTab] = useState('unit')
  return (
    <div className="dtabs-wrap">
      <div className="dtabs" role="tablist" aria-label="Detail unit">
        {DETAIL_TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
            className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={tab} className="dtab-body" role="tabpanel"
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22, ease: 'easeOut' }}>
          {tab === 'unit' && (
            <p>{listing.description || 'Deskripsi lengkap menyusul. Hubungi Motorell untuk detail unit ini.'}</p>)}
          {tab === 'kurasi' && (
            listing.known_issues
              ? <p>{listing.known_issues}</p>
              : <p className="muted">Tidak ada minus tercatat — unit ini lolos inspeksi tanpa catatan khusus.</p>)}
          {tab === 'garansi' && (
            <ul className="dtab-warranty">
              {warrantiesForGrade(listing.grade).map((w) => (
                <li key={w.code}>
                  <b>{w.name}</b>
                  <span>{w.desc}</span>
                  <em>{w.price ? '+' + rupiah(w.price) : 'Termasuk'}</em>
                </li>
              ))}
            </ul>)}
        </motion.div>
      </AnimatePresence>
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
            <div className="unit-terms">
              <h4>Ketentuan unit ini</h4>
              <ul>
                <li><span className="dot">•</span><span>DP flat <b>{rupiah(DP_FIXED)}</b> untuk mengunci unit — bukan persentase harga.</span></li>
                <li><span className="dot">•</span><span>Masa hold <b>3 hari</b> untuk pelunasan dan serah terima; lewat itu unit bisa ditawarkan kembali.</span></li>
                <li><span className="dot">•</span><span>DP <b>direfund 100%</b> bila kondisi unit tidak sesuai deskripsi yang tercantum.</span></li>
                <li><span className="dot">•</span><span>Selengkapnya di <a href="#/kebijakan" onClick={(e) => { e.preventDefault(); nav('#/kebijakan') }}>halaman kebijakan</a>.</span></li>
              </ul>
            </div>
          </div>

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
        </div>
        {canBook && (
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
function Card({ l, nav, index = 0, highlight = false }) {
  const photos = Array.isArray(l.photos) ? l.photos : []
  const wrapRef = useRef(null)
  const cardRef = useRef(null)
  const [shown, setShown] = useState(false)
  const reduced = useRef(false)

  // muncul berurutan saat kartu masuk layar
  useEffect(() => {
    reduced.current = prefersReduced()
    const el = wrapRef.current
    if (!el) return
    if (reduced.current) { setShown(true); return }
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting) { setShown(true); io.disconnect() }
      }
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
      <button ref={cardRef} className="card" onClick={() => nav('#/unit/' + l.slug)}
        onPointerMove={onMove} onPointerLeave={onLeave}>
        <div className="card-media">
          {photos[0] ? <FadeImg src={photos[0]} alt={l.title} loading="lazy" /> : <Blueprint />}
          <span className={'badge g-' + String(l.grade || '').toLowerCase()}>GRADE {l.grade}</span>
          {/* panel disingkap saat hover — pakai foto yang sama (bukan foto ke-2)
              supaya etalase tetap ringan; wipe clip-path meniru "object reveal" dari
              video referensi desain. Isinya info BARU (bukan duplikat tahun/km/harga
              yang sudah ada di card-body di bawahnya) */}
          <div className="card-reveal">
            {GRADE_DESC[l.grade] || 'Unit sudah lolos kurasi 50+ titik'}
          </div>
        </div>
        <div className="card-body">
          <h3>{l.title}</h3>
          <span className="card-meta">{l.year} · {l.mileage_km ? fmt(l.mileage_km) + ' KM' : 'KM —'}{l.color ? ' · ' + l.color.toUpperCase() : ''}</span>
          <span className="card-price">{rupiah(l.price)}</span>
        </div>
        <span className="card-go"><span>Lihat detail</span><span className="aro">→</span></span>
      </button>
    </div>
  )
}

function HomeView({ listings, nav, query = '', filters = null, searchActive = false,
  loading = false, error = '' }) {
  // listings sudah difilter hanya status 'published' oleh App.
  // Filter etalase memakai parser yang sama dengan dropdown navbar (harga,
  // tahun, grade, teks) — jadi yang terlihat di grid persis yang dijanjikan
  // dropdown. Section fitur & foto intro tetap pakai listings penuh.
  const shown = searchActive
    ? listings.filter((l) => matchListing(l, filters))
    : listings
  // Unit asli terbaik (grade tertinggi yang punya foto) — dipakai sebagai foto
  // fallback kalau WebGL gagal render (bukan lagi bagian animasi pembuka).
  const introUnit =
    listings.find((l) => l.grade === 'S' && l.photos?.[0]) ||
    listings.find((l) => l.grade === 'A' && l.photos?.[0]) ||
    listings.find((l) => l.photos?.[0]) || null
  const introPhoto = introUnit?.photos?.[0] || null
  // Petunjuk gesture 3D tampil sekali seumur perangkat: hilang begitu user
  // berinteraksi pertama kali, diingat lewat localStorage. Dirender di sini
  // (bukan di dalam .hero-3d) supaya tidak ikut transparan/tertutup layer teks.
  const [hint3d, setHint3d] = useState(() => {
    try { return !localStorage.getItem('m3d-hint-seen') } catch { return true }
  })
  const dismissHint = useCallback(() => {
    try { localStorage.setItem('m3d-hint-seen', '1') } catch { /* private mode */ }
    setHint3d(false)
  }, [])

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
        <div className="hero-3d">
          <Bike3D introPhoto={introPhoto} onInteract={dismissHint} />
        </div>
        <div className="hero-fade" aria-hidden="true" />
        <div className="container hero-inner">
          <div className="hero-copy">
            <p className="kicker">Motorell Market — Showroom motor terkurasi</p>
            <h1>Lebih dari motor bekas.<br />Kualitas <em>anti was-was.</em></h1>
            <p>Setiap motor telah diinspeksi, diverifikasi, dikurasi, dan siap
              mengukir cerita perjalanan Anda.</p>
            <div className="hero-cta">
              <a className="btn btn-dark" href="#etalase" onClick={goEtalase}>Lihat semua unit</a>
              <a className="btn btn-ghost" href="#kurasi">Standar kurasi</a>
            </div>
            {hint3d && (
              <span className="bike3d-hint" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                  strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12m0-1.5v-2a1.5 1.5 0 0 1 3 0V12m0-1v-.5a1.5 1.5 0 0 1 3 0V13c0 4-2.5 7-6.5 7-3 0-4.5-1.5-6-4l-1.7-3.3a1.4 1.4 0 0 1 2.3-1.5L8 14" />
                </svg>
                Seret · tilt · cubit untuk zoom
              </span>
            )}
          </div>
          <div className="spec-rail">
            <span>Unit diinspeksi<b>50 unit+</b></span>
            <span>Garansi mesin<b>s.d. 37 hari</b></span>
            <span>Kunci unit<b>DP {rupiah(DP_FIXED)}</b></span>
          </div>
        </div>
      </section>

      <Reveal> {/* Wrapped the #etalase section */}
        <section className="section" id="etalase">
          <div className="container">
            <div className="sec-head">
              <div>
                <p className="kicker">Galeri</p>
                <h2>Galeri Motorell.</h2>
              </div>
              <p className="aside">Klik unit untuk melihat foto, catatan kurasi, memilih paket perlindungan,
                dan mengunci unit dengan DP — book melalui Contact Kami.</p>
            </div>
            <div className="grid">
              {loading && (
                <div className="empty">Memuat etalase…</div>)}
              {!loading && error && (
                <div className="empty">
                  Gagal memuat etalase — {error}.<br />
                  <button className="btn btn-ghost btn-sm" style={{ marginTop: 14 }}
                    onClick={() => window.location.reload()}>Coba lagi</button>
                </div>)}
              {!loading && !error && listings.length === 0 && (
                <div className="empty">Etalase sedang kosong — unit baru sedang dalam proses kurasi.</div>)}
              {!loading && !error && listings.length > 0 && shown.length === 0 && (
                <div className="empty">Tidak ada unit yang cocok dengan pencarian "{query.trim()}".</div>)}
              {!loading && !error && shown.map((l, i) => (
                <Card key={l.id} l={l} nav={nav} index={i} highlight={searchActive} />))}
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
              <FadeItem as="p" className="aside">
                Kami saring dulu, baru tayang. Yang sampai ke etalase hanya unit yang
                lolos pemeriksaan dan layak kamu bawa pulang.
              </FadeItem>
            </FadeIn>
            {[
              {
                kicker: 'Kurasi jujur',
                title: 'Minus pun ditulis apa adanya.',
                text: 'Setiap unit diperiksa mekanik sebelum boleh tayang — mesin, rangka, kelistrikan, dokumen, sampai uji jalan. Catatan kurasinya kamu baca sendiri di halaman unit, bukan disembunyikan.',
              },
              {
                kicker: 'Perlindungan',
                title: 'Garansi mesin sampai 37 hari.',
                text: 'Tiga paket perlindungan bisa dipilih saat booking — dari 7 hari standar sampai 37 hari plus servis & tune up. Semua tertulis, bukan janji lisan.',
              },
              {
                kicker: 'Booking aman',
                title: 'DP ' + rupiah(DP_FIXED) + ', unit langsung terkunci.',
                text: 'Begitu DP masuk, unit hilang dari etalase dan aman dari serobotan. DP kembali penuh bila kondisi unit tidak sesuai laporan kurasi. Sudah diinspeksi sejumlah 50+ titik dan layak kamu bawa pulang.',
              },
            ].map((f, i) => (
              <Reveal key={f.kicker} className={'feature' + (i % 2 ? ' flip' : '')}>
                <div className="feature-media-slide">
                  <TiltMedia className="feature-media">
                    {listings[i]?.photos?.[0]
                      ? <FadeImg src={listings[i].photos[0]} alt="" loading="lazy" />
                      : <Blueprint />}
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

  const show = open && value.trim().length > 0

  const onKeyDown = (e) => {
    if (!show) return
    if (e.key === 'Escape') { setOpen(false); return }
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
          aria-expanded={show}
          aria-controls="ns-pop" />
      </form>

      {show && (
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
function parseHash() {
  const raw = window.location.hash || '#/'
  const qIdx = raw.indexOf('?')
  const path = qIdx === -1 ? raw : raw.slice(0, qIdx)
  const q = qIdx === -1 ? '' : (new URLSearchParams(raw.slice(qIdx + 1)).get('q') || '')
  const unit = path.match(/^#\/unit\/(.+)$/)
  if (unit) return { name: 'unit', slug: decodeURIComponent(unit[1]), q }
  if (path === '#/admin') return { name: 'admin', q }
  if (path === '#/kebijakan') return { name: 'kebijakan', q }
  return { name: 'home', q }
}

// ---------- Halaman kebijakan / FAQ (route #/kebijakan) ----------
const POLICY = [
  {
    q: 'DP & Booking',
    body: [
      'DP sebesar Rp500.000 mengunci unit selama 3 hari untuk proses pelunasan dan serah terima. Selama masa ini, unit tidak ditawarkan ke pembeli lain. Jika dalam 3 hari pelunasan belum dilakukan tanpa konfirmasi lebih lanjut dari Motorell, unit dapat ditawarkan kembali ke pembeli lain.',
      'DP akan dikembalikan secara penuh (100%) apabila kondisi unit yang diterima tidak sesuai dengan deskripsi dan catatan kurasi yang tercantum di halaman unit. Pengajuan refund dapat dilakukan dengan menghubungi tim Motorell melalui WhatsApp maksimal 1x24 jam setelah serah terima.',
    ],
  },
  {
    q: 'Syarat & Ketentuan',
    body: [
      'Harga yang tercantum adalah harga unit dalam kondisi sebagaimana dideskripsikan pada halaman masing-masing unit, belum termasuk biaya balik nama, pajak tahunan yang belum dibayarkan (jika ada), dan biaya pengiriman di luar area yang disepakati.',
      'Paket perlindungan (Avantgard/Spectre/Cullinan) berlaku sejak tanggal serah terima unit dan mencakup layanan sebagaimana dijelaskan pada masing-masing paket.',
    ],
  },
  {
    q: 'Kebijakan Privasi',
    body: [
      'Motorell menghargai privasi Anda. Data yang Anda berikan — termasuk nama, nomor telepon, dan alamat email — hanya digunakan untuk keperluan proses transaksi, konfirmasi booking, dan komunikasi terkait unit yang Anda minati.',
      'Dengan mendaftar atau melakukan booking, Anda memberikan persetujuan bagi Motorell untuk sesekali mengirimkan informasi promosi, penawaran unit baru, atau program menarik lainnya melalui email atau WhatsApp. Kami membatasi frekuensi komunikasi ini agar tetap relevan dan tidak mengganggu, dan Anda dapat berhenti berlangganan kapan pun dengan menghubungi tim kami.',
      'Motorell tidak membagikan data pribadi Anda kepada pihak ketiga mana pun di luar kebutuhan operasional internal, kecuali diwajibkan oleh hukum yang berlaku.',
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

export default function App() {
  const [route, setRoute] = useState(parseHash)
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [listings, setListings] = useState([])
  const [deepUnit, setDeepUnit] = useState(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [booking, setBooking] = useState(null) // {listing, warranty}
  const [pending, setPending] = useState(null) // {slug, wcode} nunggu login
  const [scrolled, setScrolled] = useState(false)
  const [toastMsg, setToastMsg] = useState('')
  const toastRef = useRef(null)
  const [waHandoff, setWaHandoff] = useState(false)
  const [query, setQuery] = useState('')
  // Etalase punya tiga keadaan berbeda yang dulu terlihat sama (grid kosong):
  // sedang memuat, gagal memuat, dan benar-benar kosong.
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')

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

  // ---- Smart search ----
  // query = apa yang sedang diketik (responsif), dQuery = versi yang sudah
  // diam 300ms — hanya yang terakhir ini dipakai untuk memfilter, menulis URL,
  // dan auto-scroll, supaya tidak ada kerja berat per ketukan tombol.
  const dQuery = useDebounced(query, 300)
  const filters = useMemo(() => parseQuery(dQuery), [dQuery])
  const active = hasFilter(filters)
  const results = useMemo(
    () => (active ? listings.filter((l) => matchListing(l, filters)) : []),
    [active, listings, filters])

  // Hash diperbarui tanpa menambah entri history per ketukan (replaceState tidak
  // memicu hashchange) — link tetap bisa di-share, tapi tombol back tidak
  // terjebak melangkahi 20 huruf yang barusan diketik.
  useEffect(() => {
    if (route.name !== 'home') return
    const want = dQuery.trim() ? '#/?q=' + encodeURIComponent(dQuery.trim()) : '#/'
    if (window.location.hash !== want && (window.location.hash || '#/') !== want) {
      window.history.replaceState(null, '', want)
    }
  }, [dQuery, route.name])

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

  useEffect(() => {
    if (!supabase) return
    if (!session) { setProfile(null); return }
    supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
      .then(({ data }) => setProfile(data))
  }, [session])

  const isStaff = Boolean(profile && ['admin', 'kurator'].includes(profile.role))

  // Etalase publik: HANYA unit 'published'. Unit yang ter-DP (booked) atau
  // terjual (sold) otomatis hilang dari sini; kalau booking batal, trigger DB
  // mengembalikannya ke 'published' sehingga muncul lagi.
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
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .abortSignal(ctrl.signal)
      // Dulu error di sini ditelan diam-diam sehingga etalase gagal-muat
      // tampak persis seperti etalase kosong.
      if (error) throw new Error(error.message)
      setListings((data || []).map((l) => ({
        ...l,
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

  // deep link ke unit yang tidak ada di etalase publik (booked/sold/draft)
  useEffect(() => {
    if (route.name !== 'unit' || !supabase) { setDeepUnit(null); return }
    const found = listings.find((l) => l.slug === route.slug)
    if (found) { setDeepUnit(null); return }
    supabase.from('listings').select('*').eq('slug', route.slug).maybeSingle()
      .then(({ data }) => setDeepUnit(data))
  }, [route, listings])

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
      openWhatsAppCS(listing, toast)
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
    ? (listings.find((l) => l.slug === route.slug) || deepUnit)
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
            {isStaff && route.name !== 'admin' && (
              <button className="btn btn-quiet btn-sm" onClick={() => nav('#/admin')}>Panel admin</button>)}
            {session ? (
              <button className="btn btn-ghost btn-sm"
                onClick={async () => { await supabase.auth.signOut(); toast('Kamu sudah keluar'); if (route.name === 'admin') nav('#/') }}>
                Keluar{profile ? ' · ' + (profile.full_name || '').split(' ')[0] : ''}
              </button>
            ) : (
              <button className="btn btn-dark btn-sm" onClick={() => setAuthOpen(true)}>Masuk</button>
            )}
          </div>
        </div>
      </header>

      <main>
        {route.name === 'home' && (
          <HomeView listings={listings} nav={nav}
            query={dQuery} filters={filters} searchActive={active}
            loading={listLoading} error={listError} />)}

        {route.name === 'kebijakan' && <KebijakanView nav={nav} />}

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
            </div></section>)}
      </main>

      <footer>
        <div className="container">
          <div className="foot">
            <span className="logo">MOTORELL<i>●</i></span>
            <div className="foot-links">
              <a href="#etalase" onClick={() => nav('#/')}>Etalase</a>
              <a href="#kurasi" onClick={() => nav('#/')}>Standar kurasi</a>
              <a href="#/kebijakan" onClick={(e) => { e.preventDefault(); nav('#/kebijakan') }}>Kebijakan refund DP</a>
              <a href="#/kebijakan" onClick={(e) => { e.preventDefault(); nav('#/kebijakan') }}>Syarat &amp; ketentuan</a>
              <a href="#/kebijakan" onClick={(e) => { e.preventDefault(); nav('#/kebijakan') }}>Kebijakan privasi</a>
            </div>
          </div>
          <div className="foot-base">
            <span>© {new Date().getFullYear()} MOTORELL — INDONESIA</span>
            <span>JUAL BELI MOTOR TERKURASI</span>
          </div>
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