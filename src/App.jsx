// ============================================================
// MOTORELL MARKET — src/App.jsx (single-file SPA)
// Tema: showroom terang ala Porsche (putih, lapang, bersih)
// Stack: React + Vite + Supabase (auth, DB, storage, realtime)
// Pembayaran: Edge Function create-dp-payment -> Midtrans QRIS
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'
import QRCode from 'qrcode'
import * as THREE from 'three'

// ---------- Konfigurasi ----------
const SUPA_URL = import.meta.env.VITE_SUPABASE_URL
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabase = SUPA_URL && SUPA_KEY ? createClient(SUPA_URL, SUPA_KEY) : null

// DP dikunci flat Rp500.000 untuk semua unit (bukan persentase).
// Nilai ini juga divalidasi ulang di Edge Function create-dp-payment.
const DP_FIXED = 500000

// Opsi garansi — HARGA FINAL divalidasi ulang di Edge Function.
// Kalau mengubah harga di sini, ubah juga di create-dp-payment.
const WARRANTIES = [
  { code: 'standard', name: 'Garansi Standar', desc: 'Garansi mesin 30 hari', price: 0 },
  { code: 'plus', name: 'Garansi Plus', desc: 'Mesin 90 hari + 1× servis', price: 350000 },
  { code: 'max', name: 'Garansi Max', desc: 'Mesin 180 hari + 2× servis + tune-up', price: 750000 },
]

const rupiah = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(Number(n) || 0))
const fmt = (n) => new Intl.NumberFormat('id-ID').format(Number(n) || 0)
const slugify = (s) =>
  String(s).toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const STATUS_LABEL = {
  draft: 'Draft', published: 'Tayang', booked: 'Di-booking', sold: 'Terjual', delisted: 'Arsip',
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

// ---------- Gaya (tema terang) ----------
const CSS = `
:root{
  --bg:#ffffff; --bg-2:#f3f3f1; --bg-3:#ececea;
  --panel:#ffffff; --panel-2:#f6f6f4;
  --line:#e4e4e1; --line-2:#d4d4d0;
  --ink:#111114; --muted:#5c6067; --dim:#9a9ea6;
  --accent:#ff3d00; --accent-ink:#dd3500; --ok:#1f9d55; --warn:#b8791b;
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

.container{width:100%;max-width:1260px;margin-inline:auto;
  padding-inline:clamp(20px,5vw,64px)}
.mono{font-family:var(--mono)}
.kicker{font-family:var(--mono);font-size:11.5px;letter-spacing:.18em;
  text-transform:uppercase;color:var(--muted);display:flex;align-items:center;gap:11px}
.kicker::before{content:"";width:24px;height:2px;background:var(--accent)}

/* ---------- nav ---------- */
.nav{position:fixed;inset:0 0 auto 0;z-index:60;
  background:rgba(255,255,255,0);border-bottom:1px solid transparent;
  transition:background .3s,border-color .3s,backdrop-filter .3s}
.nav.scrolled{background:rgba(255,255,255,.86);backdrop-filter:blur(16px);
  border-color:var(--line)}
.nav-in{display:flex;align-items:center;justify-content:space-between;padding:16px 0}
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

/* ---------- hero (full-bleed, 3D as ambient background) ---------- */
.hero{position:relative;min-height:94vh;display:flex;align-items:center;
  padding:148px 0 44px;border-bottom:1px solid var(--line);overflow:hidden;
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
.hero-3d{position:absolute;inset:0;z-index:1}
.bike3d{position:absolute;inset:0;cursor:grab;touch-action:pan-y}
.bike3d:active{cursor:grabbing}
.bike3d canvas{display:block;width:100% !important;height:100% !important}
.hero-fade{position:absolute;inset:0;z-index:2;pointer-events:none;
  background:
    linear-gradient(90deg, rgba(255,255,255,.99) 0%, rgba(255,255,255,.82) 30%, rgba(255,255,255,0) 56%),
    linear-gradient(0deg, rgba(255,255,255,.92) 0%, rgba(255,255,255,0) 24%)}
.hero-inner{position:relative;z-index:3;width:100%}
.hero-copy{max-width:580px}
.hero-copy h1{font-size:clamp(46px,6.4vw,86px);font-weight:750;line-height:.97;
  letter-spacing:-.03em;margin:22px 0 22px}
.hero-copy h1 em{font-style:normal;color:var(--accent)}
.hero-copy p{font-size:16.5px;line-height:1.62;color:var(--muted);max-width:440px;margin-bottom:26px}
.hero-copy .from{font-family:var(--mono);font-size:13px;color:var(--ink);margin-bottom:28px}
.hero-copy .from b{color:var(--accent)}
.hero-cta{display:flex;gap:12px;flex-wrap:wrap}
.hero-hint{position:absolute;left:clamp(20px,5vw,64px);bottom:20px;z-index:4;
  font-family:var(--mono);font-size:10px;letter-spacing:.14em;color:var(--dim);
  background:rgba(255,255,255,.85);border:1px solid var(--line);
  padding:6px 11px;border-radius:999px;pointer-events:none}
.spec-rail{display:flex;flex-wrap:wrap;border:1px solid var(--line);
  border-radius:12px;margin-top:52px;overflow:hidden;background:rgba(255,255,255,.78);
  backdrop-filter:blur(10px);max-width:900px}
.spec-rail span{flex:1;min-width:170px;padding:18px 22px;font-family:var(--mono);
  font-size:12px;letter-spacing:.05em;color:var(--muted);
  border-right:1px solid var(--line);display:flex;flex-direction:column;gap:6px}
.spec-rail span:last-child{border-right:none}
.spec-rail b{color:var(--ink);font-size:16px;font-weight:700;font-family:var(--font)}

/* ---------- section ---------- */
.section{padding:clamp(60px,8vw,104px) 0}
.section.grey{background:var(--bg-2);border-block:1px solid var(--line)}
.sec-head{display:flex;justify-content:space-between;align-items:flex-end;gap:26px;
  margin-bottom:clamp(30px,4vw,46px)}
.sec-head h2{font-size:clamp(30px,4vw,50px);font-weight:740;letter-spacing:-.025em;
  line-height:1.02;margin-top:13px}
.sec-head .aside{max-width:330px;font-size:14.5px;color:var(--muted);line-height:1.55}

/* ---------- grid unit ---------- */
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.card-wrap{opacity:0;transform:translateY(24px);
  transition:opacity .55s ease,transform .6s cubic-bezier(.2,.7,.25,1)}
.card-wrap.shown{opacity:1;transform:none}
.card{width:100%;height:100%;background:var(--panel);border:1px solid var(--line);
  border-radius:var(--radius);overflow:hidden;display:flex;flex-direction:column;
  text-align:left;
  transform:perspective(950px) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg))
    translateY(var(--lift,0px));
  transition:transform .16s ease-out,box-shadow .25s,border-color .25s}
.card:hover{--lift:-6px;box-shadow:var(--shadow);border-color:var(--line-2)}
.card-media{aspect-ratio:16/10;position:relative;overflow:hidden;
  background:radial-gradient(120% 120% at 50% 25%, #fbfbfa, var(--bg-3) 82%)}
.card-media img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;
  opacity:0;transition:opacity .45s ease,transform .6s cubic-bezier(.2,.6,.25,1)}
.card-media img.ok{opacity:1}
.card-media img.ph2{opacity:0}
.card:hover .card-media img.ph2.ok{opacity:1}
.card:hover .card-media img{transform:scale(1.055)}
.card-media::after{content:"";position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(105deg,transparent 42%,rgba(255,255,255,.5) 50%,transparent 58%);
  transform:translateX(-130%);transition:transform .65s ease}
.card:hover .card-media::after{transform:translateX(130%)}
.card-media .blp{position:absolute;inset:11% 8%;opacity:1}
.badge{position:absolute;top:13px;left:13px;z-index:2;font-family:var(--mono);font-size:10.5px;
  font-weight:600;letter-spacing:.08em;padding:6px 11px;border-radius:999px;
  background:rgba(255,255,255,.92);backdrop-filter:blur(6px);border:1px solid var(--line-2);
  color:var(--ink);transition:transform .25s ease}
.card:hover .badge{transform:translateY(-2px)}
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

/* ---------- trust ---------- */
.trust{display:grid;grid-template-columns:repeat(3,1fr);gap:0;
  border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--panel)}
.trust div{padding:34px 30px;border-right:1px solid var(--line)}
.trust div:last-child{border-right:none}
.trust .n{font-family:var(--font);font-size:44px;font-weight:780;letter-spacing:-.03em;
  color:var(--accent);line-height:1;margin-bottom:14px}
.trust h4{font-size:16px;font-weight:680;margin-bottom:9px}
.trust p{font-size:13.5px;color:var(--muted);line-height:1.6}

/* ---------- detail ---------- */
.detail{padding:118px 0 88px}
.back{font-family:var(--mono);font-size:12px;letter-spacing:.08em;color:var(--muted);
  margin-bottom:28px;display:inline-flex;gap:8px}
.back:hover{color:var(--accent)}
.detail-grid{display:grid;grid-template-columns:7fr 5fr;gap:clamp(26px,3.5vw,56px);align-items:start}
.gallery-main{aspect-ratio:4/3;border-radius:14px;overflow:hidden;position:relative;
  background:radial-gradient(120% 120% at 50% 25%, #fbfbfa, var(--bg-3) 82%);
  border:1px solid var(--line)}
.gallery-main img{width:100%;height:100%;object-fit:cover}
.gallery-main .blp{position:absolute;inset:13% 10%;opacity:1}
.thumbs{display:flex;gap:10px;margin-top:11px;flex-wrap:wrap}
.thumbs button{width:78px;height:60px;border-radius:9px;overflow:hidden;
  border:1.5px solid var(--line);opacity:.6;transition:opacity .2s,border-color .2s;background:var(--bg-2)}
.thumbs button.on{opacity:1;border-color:var(--accent)}
.thumbs img{width:100%;height:100%;object-fit:cover}
.desc{margin-top:36px}
.desc h4{font-family:var(--mono);font-size:11.5px;letter-spacing:.13em;
  text-transform:uppercase;color:var(--muted);margin-bottom:13px}
.desc p{font-size:15.5px;line-height:1.72;color:#33363c;max-width:60ch;white-space:pre-line}
.issues{margin-top:28px;border-left:3px solid var(--warn);padding-left:17px}
.issues p{color:var(--muted)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;
  padding:28px;position:sticky;top:98px;box-shadow:var(--shadow)}
.panel h1{font-size:clamp(25px,2.6vw,33px);font-weight:760;letter-spacing:-.02em;line-height:1.06}
.panel .price{font-size:26px;font-weight:780;margin:11px 0 22px;letter-spacing:-.02em}
.specs{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);
  border-radius:11px;overflow:hidden;margin-bottom:26px}
.specs div{padding:13px 10px;border-right:1px solid var(--line);text-align:center}
.specs div:last-child{border-right:none}
.specs small{display:block;font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;
  color:var(--dim);text-transform:uppercase;margin-bottom:6px}
.specs b{font-size:14px;font-weight:700}
.w-title{font-family:var(--mono);font-size:11px;letter-spacing:.13em;text-transform:uppercase;
  color:var(--muted);margin-bottom:12px}
.w-opts{display:flex;flex-direction:column;gap:9px;margin-bottom:24px}
.w-opt{display:flex;align-items:center;gap:13px;border:1.5px solid var(--line);
  border-radius:11px;padding:14px 15px;text-align:left;transition:border-color .18s,background .18s}
.w-opt:hover{border-color:var(--line-2)}
.w-opt.on{border-color:var(--accent);background:rgba(255,61,0,.045)}
.w-dot{width:18px;height:18px;border-radius:50%;border:2px solid var(--dim);flex:none;
  display:flex;align-items:center;justify-content:center}
.w-opt.on .w-dot{border-color:var(--accent)}
.w-opt.on .w-dot::after{content:"";width:9px;height:9px;border-radius:50%;background:var(--accent)}
.w-body{flex:1}
.w-body b{display:block;font-size:14.5px;font-weight:680}
.w-body span{font-size:12.5px;color:var(--muted)}
.w-price{font-family:var(--mono);font-size:13px;font-weight:600;color:var(--ink)}
.rows{border:1px solid var(--line);border-radius:11px;overflow:hidden;margin-bottom:19px}
.row{display:flex;justify-content:space-between;gap:12px;padding:13px 16px;font-size:14px}
.row + .row{border-top:1px solid var(--line)}
.row span{color:var(--muted)}
.row span small{display:block;font-size:11px;color:var(--dim)}
.row b{font-weight:680}
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
.m-close{width:34px;height:34px;border-radius:50%;border:1.5px solid var(--line-2);
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
.f-grid{display:grid;grid-template-columns:1fr 1fr;gap:13px}
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
.a-list{display:flex;flex-direction:column;gap:11px}
.a-row{background:var(--panel);border:1px solid var(--line);border-radius:12px;
  padding:15px 18px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;box-shadow:var(--shadow)}
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
  border:1px solid var(--line-2)}
.photo-strip img{width:100%;height:100%;object-fit:cover}
.photo-strip .rm{position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;
  background:rgba(255,255,255,.92);border:1px solid var(--line-2);font-size:11px;
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
.toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,16px);z-index:120;
  background:var(--ink);color:#fff;font-size:13.5px;font-weight:500;padding:12px 20px;
  border-radius:999px;opacity:0;pointer-events:none;transition:.3s;max-width:88vw;
  text-align:center;box-shadow:0 12px 40px rgba(17,17,20,.24)}
.toast.show{opacity:1;transform:translate(-50%,0)}
.cfg{min-height:100svh;display:flex;align-items:center;justify-content:center;padding:24px}
.cfg div{max-width:520px;border:1px solid var(--line);border-radius:14px;padding:32px;
  background:var(--panel);font-size:14.5px;line-height:1.65;color:var(--muted);box-shadow:var(--shadow)}
.cfg b{color:var(--ink)}
.cfg code{font-family:var(--mono);font-size:12.5px;color:var(--accent)}

@media(max-width:1020px){
  .grid{grid-template-columns:repeat(2,1fr)}
  .detail-grid{grid-template-columns:1fr}
  .panel{position:static}
  .hero{min-height:0;padding-top:128px}
  .hero-fade{background:
    linear-gradient(0deg, rgba(255,255,255,.97) 0%, rgba(255,255,255,.55) 46%, rgba(255,255,255,.1) 100%)}
  .hero-3d{opacity:.5}
  .hero-copy{max-width:100%}
  .spec-rail{max-width:100%}
}
@media(max-width:680px){
  .grid{grid-template-columns:1fr}
  .trust{grid-template-columns:1fr}
  .trust div{border-right:none;border-bottom:1px solid var(--line)}
  .trust div:last-child{border-bottom:none}
  .sec-head{flex-direction:column;align-items:flex-start}
  .f-grid{grid-template-columns:1fr}
  .specs{grid-template-columns:repeat(2,1fr)}
  .specs div:nth-child(2){border-right:none}
  .a-row{align-items:flex-start}
}
@media(prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}
  *{animation-duration:.001s !important;transition-duration:.001s !important}
  .card-media::after{display:none}
}
`

// ---------- Blueprint motor (fallback saat unit belum ada foto) ----------
function Blueprint() {
  return (
    <svg className="blp" viewBox="0 0 300 170" fill="none" stroke="#c3c3bf"
      strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="62" cy="122" r="34" /><circle cx="62" cy="122" r="10" />
      <circle cx="238" cy="122" r="34" /><circle cx="238" cy="122" r="10" />
      <path d="M62 122 L110 120 L96 70" />
      <path d="M238 122 L206 62 L196 54" />
      <path d="M110 120 L150 118 L196 54" />
      <path d="M96 70 L104 60 H150 L172 74 L150 118" />
      <path d="M150 62 q22 -16 44 -8" />
      <path d="M86 60 L104 60" /><path d="M86 52 v16" />
      <path d="M118 122 h64" strokeDasharray="3 8" />
      <path d="M206 62 l16 -10" />
    </svg>
  )
}

// ---------- Motor 3D interaktif (hero) ----------
function Bike3D() {
  const mountRef = useRef(null)
  const [failed, setFailed] = useState(false)

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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50)
    // Kamera "melihat" ke titik di kiri motor, bukan ke motornya langsung —
    // pada frame lebar (hero full-bleed) ini mendorong motor ke sisi kanan,
    // menyisakan ruang kosong di kiri untuk teks headline.
    camera.position.set(3.6, 1.55, 5.0)
    camera.lookAt(-1.6, 0.75, 0)

    scene.add(new THREE.HemisphereLight(0xffffff, 0xdfdfdb, 1.15))
    const key = new THREE.DirectionalLight(0xffffff, 2.4)
    key.position.set(3, 5, 4)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xffe8d6, 0.5)
    fill.position.set(-4, 2, -3)
    scene.add(fill)

    // lantai penangkap bayangan
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(2.4, 48),
      new THREE.ShadowMaterial({ opacity: 0.13 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)

    // ---- rakit motor dari bentuk dasar ----
    const bike = new THREE.Group()
    const mat = (color, o = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3, ...o })
    const M = {
      tire: mat('#17171b', { roughness: 0.93, metalness: 0.04 }),
      rim: mat('#c9c9cf', { metalness: 0.85, roughness: 0.22 }),
      frame: mat('#1b1b21', { metalness: 0.55, roughness: 0.4 }),
      chrome: mat('#d8d8dd', { metalness: 0.9, roughness: 0.18 }),
      tank: mat('#ff3d00', { metalness: 0.45, roughness: 0.3 }),
      dark: mat('#101014', { roughness: 0.85, metalness: 0.1 }),
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

    const wheels = []
    const makeWheel = (x) => {
      const g = new THREE.Group()
      g.add(shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.13, 18, 44), M.tire)))
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.07, 28), M.rim)
      rim.rotation.x = Math.PI / 2
      g.add(shadowed(rim))
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.17, 14), M.engine)
      hub.rotation.x = Math.PI / 2
      g.add(hub)
      g.position.set(x, 0.5, 0)
      bike.add(g)
      wheels.push(g)
    }
    makeWheel(-1.05)
    makeWheel(1.05)

    // rangka
    const rearAxle = V(-1.05, 0.5), steer = V(0.72, 1.3)
    const seatPost = V(-0.33, 1.04), crank = V(0.02, 0.64)
    bike.add(tube(rearAxle, seatPost, 0.045, M.frame))
    bike.add(tube(seatPost, steer, 0.05, M.frame))
    bike.add(tube(crank, seatPost, 0.045, M.frame))
    bike.add(tube(crank, steer, 0.05, M.frame))
    bike.add(tube(rearAxle, crank, 0.04, M.frame))
    // garpu depan (dua batang)
    bike.add(tube(V(0.78, 1.34, 0.07), V(1.05, 0.5, 0.07), 0.035, M.chrome))
    bike.add(tube(V(0.78, 1.34, -0.07), V(1.05, 0.5, -0.07), 0.035, M.chrome))
    // setang + grip
    bike.add(tube(V(0.7, 1.42, -0.3), V(0.7, 1.42, 0.3), 0.03, M.chrome))
    bike.add(tube(V(0.72, 1.3), V(0.7, 1.42), 0.04, M.chrome))
    const gripL = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 12), M.dark)
    gripL.rotation.x = Math.PI / 2
    gripL.position.set(0.7, 1.42, 0.34)
    bike.add(shadowed(gripL))
    const gripR = gripL.clone()
    gripR.position.z = -0.34
    bike.add(gripR)
    // tangki (aksen Motorell)
    const tank = new THREE.Mesh(new THREE.SphereGeometry(0.42, 28, 22), M.tank)
    tank.scale.set(1.25, 0.58, 0.72)
    tank.position.set(0.16, 1.14, 0)
    bike.add(shadowed(tank))
    // jok
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.1, 0.27), M.dark)
    seat.position.set(-0.46, 1.1, 0)
    bike.add(shadowed(seat))
    // mesin
    const engine = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.32, 0.3), M.engine)
    engine.position.set(0, 0.74, 0)
    bike.add(shadowed(engine))
    // knalpot
    bike.add(tube(V(0.24, 0.6, 0.14), V(-0.98, 0.7, 0.17), 0.05, M.chrome))
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.05, 0.22, 14), M.chrome)
    tip.rotation.z = Math.PI / 2
    tip.position.set(-1.06, 0.705, 0.17)
    bike.add(shadowed(tip))
    // lampu depan
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 18, 14),
      mat('#fff4dd', { emissive: 0xffe3b0, emissiveIntensity: 0.8, roughness: 0.4 }))
    lamp.position.set(0.84, 1.26, 0)
    bike.add(lamp)
    // spatbor belakang & depan (busur)
    const fenderR = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.045, 10, 30, Math.PI * 0.75), M.frame)
    fenderR.position.set(-1.05, 0.5, 0)
    fenderR.rotation.z = Math.PI * 0.35
    bike.add(shadowed(fenderR))
    const fenderF = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.04, 10, 26, Math.PI * 0.5), M.chrome)
    fenderF.position.set(1.05, 0.5, 0)
    fenderF.rotation.z = Math.PI * 0.28
    bike.add(shadowed(fenderF))

    bike.position.y = 0.02
    scene.add(bike)

    // ---- interaksi: seret untuk memutar ----
    let rotY = -0.6, targetY = -0.6, dragging = false, lastX = 0
    const autoSpin = !reduced
    const onDown = (e) => {
      dragging = true
      lastX = e.clientX
      if (mount.setPointerCapture) mount.setPointerCapture(e.pointerId)
    }
    const onMove = (e) => {
      if (!dragging) return
      targetY += (e.clientX - lastX) * 0.012
      lastX = e.clientX
    }
    const onUp = () => { dragging = false }
    mount.addEventListener('pointerdown', onDown)
    mount.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)

    // ---- ukuran mengikuti kontainer ----
    const resize = () => {
      const w = mount.clientWidth || 1, h = mount.clientHeight || 1
      renderer.setSize(w, h)
      camera.aspect = w / h
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
      if (autoSpin && !dragging) targetY += 0.0038
      rotY += (targetY - rotY) * 0.08
      bike.rotation.y = rotY
      if (!reduced) {
        bike.position.y = 0.02 + Math.sin(t * 1.3) * 0.018
        for (const w of wheels) w.rotation.z -= 0.045
      }
      renderer.render(scene, camera)
    }
    loop()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      mount.removeEventListener('pointerdown', onDown)
      mount.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose()
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose())
          else o.material.dispose()
        }
      })
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
    }
  }, [])

  if (failed) return <Blueprint />
  return <div ref={mountRef} className="bike3d" role="img"
    aria-label="Model 3D motor Motorell — seret untuk memutar" />
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
                <div className="row hl"><span>DP kunci unit<small>dibayar sekarang via QRIS</small></span><b>{rupiah(DP_FIXED)}</b></div>
              </div>
              <p className="fine">DP {rupiah(DP_FIXED)} mengunci unit selama 3 hari kerja untuk pelunasan dan
                serah terima. DP kembali penuh bila kondisi unit tidak sesuai laporan kurasi.</p>
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
                <div className="row"><span>Garansi dipilih</span><b>{warranty.name}</b></div>
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
  const [upMsg, setUpMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef(null)
  const slugRef = useRef(initial?.slug ||
    (slugify((f.brand || 'unit') + ' ' + (f.model || '') + ' ' + f.year) + '-' + Math.random().toString(36).slice(2, 6)))

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))

  async function addFiles(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    e.target.value = ''
    setErr('')
    if (!editing) {
      slugRef.current = slugify((f.brand || 'unit') + ' ' + (f.model || '') + ' ' + f.year) + '-' + slugRef.current.slice(-4)
    }
    for (let i = 0; i < files.length; i++) {
      setUpMsg('Mengunggah foto ' + (i + 1) + ' dari ' + files.length + '…')
      try {
        const blob = await compressImage(files[i])
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

  async function save(e) {
    e.preventDefault()
    setErr('')
    if (!f.brand || !f.model || !f.price) { setErr('Merek, model, dan harga wajib diisi.'); return }
    setBusy(true)
    const payload = {
      brand: f.brand.trim(), model: f.model.trim(),
      title: (f.brand + ' ' + f.model + ' ' + f.year).replace(/\s+/g, ' ').trim(),
      year: Number(f.year), mileage_km: Number(f.mileage_km) || 0,
      color: f.color.trim() || null, price: Number(f.price),
      grade: f.grade, description: f.description.trim() || null,
      known_issues: f.known_issues.trim() || null,
      photos, status: f.status,
    }
    try {
      if (editing) {
        if (f.status === 'published' && !initial.published_at) payload.published_at = new Date().toISOString()
        const { error } = await supabase.from('listings').update(payload).eq('id', initial.id)
        if (error) throw error
        toast('Unit diperbarui')
      } else {
        payload.slug = slugRef.current
        if (f.status === 'published') payload.published_at = new Date().toISOString()
        const { error } = await supabase.from('listings').insert(payload)
        if (error) throw error
        toast(f.status === 'published' ? 'Unit tayang di etalase' : 'Unit disimpan sebagai draft')
      }
      onSaved()
    } catch (ex) {
      setErr(ex.message || 'Gagal menyimpan unit')
    } finally { setBusy(false) }
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
                <label>Foto unit (otomatis dikompres sebelum diunggah)</label>
                <div className="photo-strip">
                  {photos.map((url, i) => (
                    <div className="ph" key={url}>
                      <img src={url} alt={'Foto ' + (i + 1)} />
                      <button type="button" className="rm" aria-label="Hapus foto"
                        onClick={() => setPhotos((p) => p.filter((u) => u !== url))}>✕</button>
                    </div>
                  ))}
                  <button type="button" className="up-tile" aria-label="Tambah foto"
                    onClick={() => fileRef.current && fileRef.current.click()}>＋</button>
                </div>
                <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={addFiles} />
                {upMsg && <p className="f-info">{upMsg}</p>}
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

// ---------- Panel admin ----------
function AdminPanel({ profile, toast, nav }) {
  const [rows, setRows] = useState(null)
  const [form, setForm] = useState(null) // null | {} (baru) | listing (edit)

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

  return (
    <section className="admin">
      <div className="container">
        <div className="a-head">
          <div>
            <p className="kicker">Panel admin — {profile.full_name}</p>
            <h1>Kelola etalase</h1>
          </div>
          <button className="btn btn-accent" onClick={() => setForm({})}>+ Tambah unit</button>
        </div>

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
      </div>
      {form !== null && (
        <UnitForm initial={form.id ? form : null} toast={toast}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); load() }} />
      )}
    </section>
  )
}

// ---------- Halaman detail unit ----------
function DetailView({ listing, nav, onBook }) {
  const [idx, setIdx] = useState(0)
  const [wcode, setWcode] = useState('standard')
  const photos = Array.isArray(listing.photos) ? listing.photos : []
  const warranty = WARRANTIES.find((w) => w.code === wcode) || WARRANTIES[0]
  const canBook = listing.status === 'published'

  useEffect(() => { setIdx(0) }, [listing.id])

  return (
    <section className="detail">
      <div className="container">
        <a className="back" href="#/" onClick={(e) => { e.preventDefault(); nav('#/') }}>← Kembali ke etalase</a>
        <div className="detail-grid">
          <div>
            <div className="gallery-main">
              {photos[idx] ? <img src={photos[idx]} alt={listing.title} /> : <Blueprint />}
            </div>
            {photos.length > 1 && (
              <div className="thumbs">
                {photos.map((url, i) => (
                  <button key={url} className={i === idx ? 'on' : ''} onClick={() => setIdx(i)}
                    aria-label={'Foto ' + (i + 1)}>
                    <img src={url} alt="" />
                  </button>
                ))}
              </div>
            )}
            <div className="desc">
              <h4>Tentang unit ini</h4>
              <p>{listing.description || 'Deskripsi lengkap menyusul. Hubungi Motorell untuk detail unit ini.'}</p>
            </div>
            {listing.known_issues && (
              <div className="desc issues">
                <h4>Catatan kurasi</h4>
                <p>{listing.known_issues}</p>
              </div>
            )}
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

            <p className="w-title">Pilih paket garansi</p>
            <div className="w-opts" role="radiogroup" aria-label="Paket garansi">
              {WARRANTIES.map((w) => (
                <button key={w.code} type="button" role="radio" aria-checked={wcode === w.code}
                  className={'w-opt' + (wcode === w.code ? ' on' : '')}
                  onClick={() => setWcode(w.code)}>
                  <span className="w-dot" />
                  <span className="w-body"><b>{w.name}</b><span>{w.desc}</span></span>
                  <span className="w-price">{w.price ? '+' + rupiah(w.price) : 'Termasuk'}</span>
                </button>
              ))}
            </div>

            <div className="rows">
              <div className="row"><span>Harga unit</span><b>{rupiah(listing.price)}</b></div>
              <div className="row"><span>{warranty.name}<small>dibayar saat pelunasan</small></span><b>{warranty.price ? rupiah(warranty.price) : 'Termasuk'}</b></div>
              <div className="row hl"><span>DP kunci unit<small>dibayar sekarang via QRIS</small></span><b>{rupiah(DP_FIXED)}</b></div>
            </div>

            <button className="btn btn-accent btn-full" disabled={!canBook}
              onClick={() => onBook(listing, warranty)}>
              {canBook ? 'Booking DP via QRIS' : listing.status === 'booked' ? 'Sudah di-booking' : listing.status === 'sold' ? 'Terjual' : 'Belum tersedia'}
            </button>
            <p className="fine">DP {rupiah(DP_FIXED)} mengunci unit 3 hari kerja. Sisa pembayaran + garansi
              dibayar saat serah terima di Motorell. DP kembali penuh bila unit tidak sesuai laporan kurasi.</p>
          </aside>
        </div>
      </div>
    </section>
  )
}

// ---------- Kartu & beranda ----------
function Card({ l, nav, index = 0 }) {
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
    <div ref={wrapRef} className={'card-wrap' + (shown ? ' shown' : '')}
      style={{ transitionDelay: shown ? (index % 3) * 70 + 'ms' : '0ms' }}>
      <button ref={cardRef} className="card" onClick={() => nav('#/unit/' + l.slug)}
        onPointerMove={onMove} onPointerLeave={onLeave}>
        <div className="card-media">
          {photos[0] ? <FadeImg src={photos[0]} alt={l.title} loading="lazy" /> : <Blueprint />}
          {photos[1] && <FadeImg className="ph2" src={photos[1]} alt="" loading="lazy" />}
          <span className="badge">GRADE {l.grade}</span>
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

function HomeView({ listings, nav }) {
  // listings sudah difilter hanya status 'published' oleh App.
  const minPrice = listings.length ? Math.min(...listings.map((l) => Number(l.price))) : null

  return (
    <>
      <section className="hero">
        <div className="hero-grid-lines" aria-hidden="true" />
        <div className="hero-3d">
          <Bike3D />
        </div>
        <div className="hero-fade" aria-hidden="true" />
        <div className="container hero-inner">
          <div className="hero-copy">
            <p className="kicker">Motorell Market — showroom terkurasi</p>
            <h1>Pilih. Kunci.<br />Bawa <em>pulang.</em></h1>
            <p>Setiap unit di lantai showroom ini sudah lolos inspeksi 175 titik oleh mekanik
              Motorell — lengkap dengan catatan jujur tentang kondisinya.</p>
            {minPrice && <p className="from">Unit tersedia mulai <b>{rupiah(minPrice)}</b></p>}
            <div className="hero-cta">
              <a className="btn btn-dark" href="#etalase">Lihat semua unit</a>
              <a className="btn btn-ghost" href="#kurasi">Standar kurasi</a>
            </div>
          </div>
          <div className="spec-rail">
            <span>Unit tayang<b>{listings.length} unit</b></span>
            <span>Inspeksi mekanik<b>175 titik</b></span>
            <span>Garansi mesin<b>s.d. 180 hari</b></span>
            <span>Kunci unit<b>DP {rupiah(DP_FIXED)}</b></span>
          </div>
        </div>
        <span className="hero-hint">3D · SERET UNTUK MEMUTAR</span>
      </section>

      <section className="section" id="etalase">
        <div className="container">
          <div className="sec-head">
            <div>
              <p className="kicker">Etalase</p>
              <h2>Pilih unitmu.</h2>
            </div>
            <p className="aside">Klik unit untuk melihat foto, catatan kurasi, memilih paket garansi,
              dan mengunci unit dengan DP via QRIS.</p>
          </div>
          <div className="grid">
            {listings.length === 0 && (
              <div className="empty">Etalase sedang kosong — unit baru sedang dalam proses kurasi.</div>)}
            {listings.map((l, i) => <Card key={l.id} l={l} nav={nav} index={i} />)}
          </div>
        </div>
      </section>

      <section className="section grey" id="kurasi">
        <div className="container">
          <div className="sec-head">
            <div>
              <p className="kicker">Kenapa Motorell</p>
              <h2>Beli motor,<br />tanpa was-was.</h2>
            </div>
            <p className="aside">Kami saring dulu, baru tayang. Yang sampai ke etalase hanya unit yang
              lolos pemeriksaan dan layak kamu bawa pulang.</p>
          </div>
          <div className="trust">
            <div><div className="n">175</div><h4>Titik inspeksi</h4>
              <p>Mesin, rangka, kelistrikan, dokumen, dan uji jalan diperiksa mekanik sebelum unit boleh tayang. Minusnya pun ditulis apa adanya.</p></div>
            <div><div className="n">180</div><h4>Hari garansi maksimal</h4>
              <p>Tiga paket garansi mesin bisa dipilih saat booking — dari 30 hari standar sampai 180 hari plus servis berkala.</p></div>
            <div><div className="n" style={{ fontSize: 30, paddingTop: 6 }}>{rupiah(DP_FIXED)}</div><h4>DP kunci unit via QRIS</h4>
              <p>Unit terkunci otomatis begitu DP masuk, aman dari serobotan. DP kembali penuh bila unit tidak sesuai laporan kurasi.</p></div>
          </div>
        </div>
      </section>
    </>
  )
}

// ---------- Root ----------
function parseHash() {
  const h = window.location.hash || '#/'
  const unit = h.match(/^#\/unit\/(.+)$/)
  if (unit) return { name: 'unit', slug: decodeURIComponent(unit[1]) }
  if (h === '#/admin') return { name: 'admin' }
  return { name: 'home' }
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

  const toast = useCallback((msg) => {
    setToastMsg(msg)
    clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setToastMsg(''), 3400)
  }, [])

  const nav = useCallback((hash) => { window.location.hash = hash }, [])

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
    const { data, error } = await supabase.from('listings')
      .select('*')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
    if (!error) setListings(data || [])
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
        {route.name === 'home' && <HomeView listings={listings} nav={nav} />}

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
              <a href="#/">Kebijakan refund DP</a>
              <a href="#/">Syarat &amp; ketentuan</a>
              <a href="#/">Kebijakan privasi</a>
            </div>
          </div>
          <div className="foot-base">
            <span>© {new Date().getFullYear()} MOTORELL — INDONESIA</span>
            <span>JUAL BELI MOTOR TANPA WAS-WAS</span>
          </div>
        </div>
      </footer>

      {authOpen && <AuthModal toast={toast} onClose={() => setAuthOpen(false)} onDone={() => setAuthOpen(false)} />}
      {booking && <BookingModal listing={booking.listing} warranty={booking.warranty}
        toast={toast} onClose={() => setBooking(null)} />}

      <div className={'toast' + (toastMsg ? ' show' : '')} role="status">{toastMsg}</div>
    </>
  )
}