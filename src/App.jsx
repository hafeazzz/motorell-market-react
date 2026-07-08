// ============================================================
// MOTORELL MARKET — src/App.jsx (single-file SPA)
// Stack: React + Vite + Supabase (auth, DB, storage, realtime)
// Pembayaran: Edge Function create-dp-payment -> Midtrans QRIS
// ============================================================

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'
import QRCode from 'qrcode'

// ---------- Konfigurasi ----------
const SUPA_URL = import.meta.env.VITE_SUPABASE_URL
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabase = SUPA_URL && SUPA_KEY ? createClient(SUPA_URL, SUPA_KEY) : null

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
    } catch { /* biarkan pesan default */ }
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

// ---------- Gaya ----------
const CSS = `
:root{
  --bg:#0c0d10; --panel:#14161a; --panel-2:#1a1d22;
  --line:#262a31; --line-soft:#1d2026;
  --text:#eef0f2; --muted:#98a0ac; --dim:#6b7280;
  --accent:#ff3d00; --accent-soft:#ff5722; --ok:#40c46f; --warn:#f2b544;
  --radius:14px;
  --font:'Archivo',system-ui,sans-serif;
  --mono:'IBM Plex Mono',monospace;
}
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--text);font-family:var(--font);
  -webkit-font-smoothing:antialiased;overflow-x:hidden}
img{display:block;max-width:100%}
a{color:inherit;text-decoration:none}
button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit}
input,select,textarea{font-family:inherit;color:var(--text)}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:4px}
::selection{background:var(--accent);color:#fff}
.wrap{width:min(1280px,93vw);margin-inline:auto}
.mono{font-family:var(--mono)}
.kicker{font-family:var(--mono);font-size:11.5px;letter-spacing:.16em;
  text-transform:uppercase;color:var(--muted);display:flex;align-items:center;gap:10px}
.kicker::before{content:"";width:22px;height:2px;background:var(--accent)}

/* ---------- nav ---------- */
.nav{position:fixed;inset:0 0 auto 0;z-index:60;border-bottom:1px solid transparent;
  transition:background .3s,border-color .3s,backdrop-filter .3s}
.nav.scrolled{background:rgba(12,13,16,.82);backdrop-filter:blur(14px);border-color:var(--line-soft)}
.nav-in{width:min(1280px,93vw);margin-inline:auto;display:flex;align-items:center;
  justify-content:space-between;padding:15px 0}
.logo{font-weight:750;font-size:19px;letter-spacing:.02em;display:flex;align-items:baseline;gap:7px}
.logo i{font-style:normal;color:var(--accent)}
.logo small{font-family:var(--mono);font-size:10px;letter-spacing:.2em;color:var(--dim)}
.nav-actions{display:flex;align-items:center;gap:10px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;
  font-weight:600;font-size:14.5px;padding:12px 22px;border-radius:999px;
  transition:transform .16s,background .16s,color .16s,border-color .16s,opacity .16s}
.btn:active{transform:scale(.97)}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn-accent{background:var(--accent);color:#fff}
.btn-accent:hover:not(:disabled){background:var(--accent-soft)}
.btn-ghost{border:1.5px solid var(--line);color:var(--text)}
.btn-ghost:hover:not(:disabled){border-color:var(--accent);color:var(--accent)}
.btn-quiet{color:var(--muted);font-weight:500;padding:10px 14px}
.btn-quiet:hover{color:var(--text)}
.btn-sm{padding:9px 16px;font-size:13px}
.btn-full{width:100%}

/* ---------- hero ---------- */
.hero{position:relative;min-height:92svh;display:flex;align-items:flex-end;
  padding:120px 0 0;overflow:hidden}
.hero-media{position:absolute;inset:0;z-index:0}
.hero-media img{width:100%;height:100%;object-fit:cover;opacity:.5}
.hero-media .sil{position:absolute;right:-4%;bottom:6%;width:min(62vw,760px);opacity:.5}
.hero-media::after{content:"";position:absolute;inset:0;
  background:
    radial-gradient(90% 70% at 78% 42%, rgba(255,132,52,.14), transparent 60%),
    linear-gradient(90deg, rgba(12,13,16,.96) 18%, rgba(12,13,16,.55) 55%, rgba(12,13,16,.25)),
    linear-gradient(0deg, var(--bg) 4%, transparent 42%)}
.hero-in{position:relative;z-index:1;width:100%;display:flex;flex-direction:column;gap:0}
.hero-copy{padding-bottom:clamp(40px,6vw,84px);max-width:640px}
.hero-copy h1{font-size:clamp(44px,7vw,96px);font-weight:730;line-height:.98;
  letter-spacing:-.022em;margin:20px 0 18px}
.hero-copy h1 em{font-style:normal;color:var(--accent)}
.hero-copy p{font-size:16.5px;line-height:1.6;color:var(--muted);max-width:460px;margin-bottom:26px}
.hero-copy .from{font-family:var(--mono);font-size:13px;color:var(--text);margin-bottom:26px}
.hero-copy .from b{color:var(--accent)}
.hero-cta{display:flex;gap:12px;flex-wrap:wrap}
.spec-rail{border-top:1px solid var(--line-soft);display:flex;flex-wrap:wrap}
.spec-rail span{flex:1;min-width:180px;padding:18px 20px 22px;font-family:var(--mono);
  font-size:12px;letter-spacing:.06em;color:var(--muted);
  border-right:1px solid var(--line-soft);display:flex;flex-direction:column;gap:5px}
.spec-rail span:last-child{border-right:none}
.spec-rail b{color:var(--text);font-size:15px;font-weight:600}

/* ---------- section ---------- */
.section{padding:clamp(64px,8vw,110px) 0}
.sec-head{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;
  margin-bottom:clamp(30px,4vw,48px)}
.sec-head h2{font-size:clamp(30px,4vw,52px);font-weight:720;letter-spacing:-.02em;
  line-height:1.02;margin-top:12px}
.sec-head .aside{max-width:320px;font-size:14.5px;color:var(--muted);line-height:1.55}

/* ---------- grid unit ---------- */
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.card{background:var(--panel);border:1px solid var(--line-soft);border-radius:var(--radius);
  overflow:hidden;display:flex;flex-direction:column;text-align:left;
  transition:transform .25s,border-color .25s}
.card:hover{transform:translateY(-5px);border-color:var(--line)}
.card-media{aspect-ratio:16/10;position:relative;overflow:hidden;
  background:radial-gradient(120% 100% at 50% 115%, #241b14, var(--panel-2) 62%)}
.card-media img{width:100%;height:100%;object-fit:cover;transition:transform .5s}
.card:hover .card-media img{transform:scale(1.04)}
.card-media .sil{position:absolute;inset:12% 8%;opacity:.75}
.badge{position:absolute;top:12px;left:12px;font-family:var(--mono);font-size:10.5px;
  font-weight:600;letter-spacing:.1em;padding:6px 11px;border-radius:999px;
  background:rgba(12,13,16,.78);backdrop-filter:blur(6px);border:1px solid var(--line)}
.badge.grade{color:var(--text)}
.badge.st-booked{left:auto;right:12px;color:var(--warn);border-color:rgba(242,181,68,.4)}
.badge.st-sold{left:auto;right:12px;color:var(--dim)}
.card-body{padding:18px 18px 16px;display:flex;flex-direction:column;gap:5px}
.card-body h3{font-size:17px;font-weight:650;letter-spacing:-.01em}
.card-meta{font-family:var(--mono);font-size:11.5px;color:var(--dim);letter-spacing:.05em}
.card-price{font-family:var(--mono);font-size:17px;font-weight:600;margin-top:8px}
.card-go{border-top:1px solid var(--line-soft);padding:13px 18px;font-size:13.5px;
  font-weight:600;color:var(--muted);display:flex;justify-content:space-between;
  transition:color .2s,background .2s}
.card:hover .card-go{color:var(--accent)}
.card.is-sold{opacity:.55}
.empty{border:1px dashed var(--line);border-radius:var(--radius);padding:56px 24px;
  text-align:center;color:var(--muted);font-size:15px;grid-column:1/-1}

/* ---------- trust ---------- */
.trust{border-block:1px solid var(--line-soft);display:flex;flex-wrap:wrap}
.trust div{flex:1;min-width:250px;padding:30px 26px;border-right:1px solid var(--line-soft)}
.trust div:last-child{border-right:none}
.trust h4{font-size:16px;font-weight:650;margin-bottom:8px}
.trust h4 b{color:var(--accent);font-family:var(--mono);font-weight:600;margin-right:8px}
.trust p{font-size:13.5px;color:var(--muted);line-height:1.55}

/* ---------- detail ---------- */
.detail{padding:120px 0 90px}
.back{font-family:var(--mono);font-size:12px;letter-spacing:.1em;color:var(--muted);
  margin-bottom:26px;display:inline-flex;gap:8px}
.back:hover{color:var(--accent)}
.detail-grid{display:grid;grid-template-columns:7fr 5fr;gap:clamp(24px,3.5vw,52px);align-items:start}
.gallery-main{aspect-ratio:4/3;border-radius:var(--radius);overflow:hidden;position:relative;
  background:radial-gradient(120% 100% at 50% 115%, #241b14, var(--panel-2) 62%);
  border:1px solid var(--line-soft)}
.gallery-main img{width:100%;height:100%;object-fit:cover}
.gallery-main .sil{position:absolute;inset:14% 10%;opacity:.75}
.thumbs{display:flex;gap:10px;margin-top:10px;flex-wrap:wrap}
.thumbs button{width:76px;height:58px;border-radius:9px;overflow:hidden;
  border:1.5px solid var(--line-soft);opacity:.65;transition:opacity .2s,border-color .2s}
.thumbs button.on{opacity:1;border-color:var(--accent)}
.thumbs img{width:100%;height:100%;object-fit:cover}
.desc{margin-top:34px}
.desc h4{font-family:var(--mono);font-size:11.5px;letter-spacing:.14em;
  text-transform:uppercase;color:var(--muted);margin-bottom:12px}
.desc p{font-size:15.5px;line-height:1.7;color:#c9ced6;max-width:60ch;white-space:pre-line}
.issues{margin-top:26px;border-left:3px solid var(--warn);padding-left:16px}
.issues p{color:var(--muted)}
.panel{background:var(--panel);border:1px solid var(--line-soft);border-radius:var(--radius);
  padding:26px;position:sticky;top:96px}
.panel h1{font-size:clamp(24px,2.6vw,32px);font-weight:700;letter-spacing:-.015em;line-height:1.08}
.panel .price{font-family:var(--mono);font-size:22px;font-weight:600;margin:10px 0 20px}
.specs{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line-soft);
  border-radius:11px;overflow:hidden;margin-bottom:24px}
.specs div{padding:12px 10px;border-right:1px solid var(--line-soft);text-align:center}
.specs div:last-child{border-right:none}
.specs small{display:block;font-family:var(--mono);font-size:9.5px;letter-spacing:.12em;
  color:var(--dim);text-transform:uppercase;margin-bottom:5px}
.specs b{font-family:var(--mono);font-size:13.5px;font-weight:600}
.w-title{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--muted);margin-bottom:11px}
.w-opts{display:flex;flex-direction:column;gap:9px;margin-bottom:22px}
.w-opt{display:flex;align-items:center;gap:13px;border:1.5px solid var(--line-soft);
  border-radius:11px;padding:13px 15px;text-align:left;transition:border-color .18s,background .18s}
.w-opt:hover{border-color:var(--line)}
.w-opt.on{border-color:var(--accent);background:rgba(255,61,0,.06)}
.w-dot{width:17px;height:17px;border-radius:50%;border:2px solid var(--dim);flex:none;
  display:flex;align-items:center;justify-content:center}
.w-opt.on .w-dot{border-color:var(--accent)}
.w-opt.on .w-dot::after{content:"";width:8px;height:8px;border-radius:50%;background:var(--accent)}
.w-body{flex:1}
.w-body b{display:block;font-size:14.5px;font-weight:650}
.w-body span{font-size:12.5px;color:var(--muted)}
.w-price{font-family:var(--mono);font-size:13px;font-weight:600;color:var(--text)}
.rows{border:1px solid var(--line-soft);border-radius:11px;overflow:hidden;margin-bottom:18px}
.row{display:flex;justify-content:space-between;gap:12px;padding:12px 15px;font-size:14px}
.row + .row{border-top:1px solid var(--line-soft)}
.row span{color:var(--muted)}
.row span small{display:block;font-size:11px;color:var(--dim)}
.row b{font-family:var(--mono);font-weight:600}
.row.hl{background:var(--panel-2)}
.row.hl b{color:var(--accent);font-size:16px}
.fine{font-size:12px;color:var(--dim);line-height:1.55;margin-top:14px}
.stnote{margin-bottom:16px;font-family:var(--mono);font-size:12px;padding:10px 14px;
  border-radius:9px;border:1px solid var(--line)}
.stnote.warn{color:var(--warn);border-color:rgba(242,181,68,.35)}
.stnote.dim{color:var(--dim)}

/* ---------- modal ---------- */
.overlay{position:fixed;inset:0;z-index:90;background:rgba(5,6,8,.72);
  backdrop-filter:blur(7px);display:flex;align-items:center;justify-content:center;padding:16px}
.modal{background:var(--panel);border:1px solid var(--line);border-radius:18px;
  width:min(430px,100%);max-height:92svh;overflow:auto;
  animation:pop .28s cubic-bezier(.2,.9,.3,1.15)}
@keyframes pop{from{transform:translateY(22px) scale(.97);opacity:0}}
.m-head{display:flex;justify-content:space-between;align-items:center;gap:12px;
  padding:18px 20px;border-bottom:1px solid var(--line-soft);
  position:sticky;top:0;background:var(--panel);z-index:2}
.m-head h3{font-size:16px;font-weight:650}
.m-head .sub{font-family:var(--mono);font-size:11.5px;color:var(--dim)}
.m-close{width:34px;height:34px;border-radius:50%;border:1.5px solid var(--line);
  font-size:15px;line-height:1;flex:none;transition:border-color .2s,color .2s}
.m-close:hover{border-color:var(--accent);color:var(--accent)}
.m-body{padding:20px}
.sandbox{display:inline-flex;align-items:center;gap:7px;font-family:var(--mono);
  font-size:10.5px;font-weight:600;letter-spacing:.08em;color:var(--warn);
  border:1px solid rgba(242,181,68,.35);padding:6px 11px;border-radius:999px;margin-bottom:15px}
.qr-tile{background:#fff;border-radius:13px;padding:16px;width:fit-content;margin:0 auto 14px}
.qr-tile img{width:222px;height:222px}
.qr-amount{font-family:var(--mono);font-size:21px;font-weight:600;text-align:center}
.qr-timer{font-family:var(--mono);font-size:12.5px;color:var(--muted);text-align:center;margin-top:6px}
.qr-timer b{color:var(--accent)}
.waiting{display:flex;align-items:center;justify-content:center;gap:9px;margin:14px 0 6px;
  font-size:13px;color:var(--muted)}
.dotp{width:8px;height:8px;border-radius:50%;background:var(--accent);animation:pulse 1.1s infinite}
@keyframes pulse{50%{opacity:.25}}
.m-note{font-size:12px;color:var(--dim);line-height:1.55;text-align:center;margin-top:12px}
.m-actions{display:flex;flex-direction:column;gap:10px;margin-top:16px}
.ok-mark{width:72px;height:72px;border-radius:50%;background:rgba(64,196,111,.12);
  display:flex;align-items:center;justify-content:center;margin:4px auto 14px}
.ok-mark svg{width:34px;height:34px;stroke:var(--ok);stroke-width:3;fill:none;
  stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:48;stroke-dashoffset:48;
  animation:draw .5s .15s forwards}
@keyframes draw{to{stroke-dashoffset:0}}
.ok-title{text-align:center;font-size:18px;font-weight:650;margin-bottom:4px}
.ok-sub{text-align:center;font-size:13px;color:var(--muted);margin-bottom:16px}
.chip-ok{font-family:var(--mono);font-size:11px;font-weight:600;color:var(--ok);
  background:rgba(64,196,111,.12);padding:4px 10px;border-radius:999px}

/* ---------- form ---------- */
.f-grid{display:grid;grid-template-columns:1fr 1fr;gap:13px}
.field{display:flex;flex-direction:column;gap:6px}
.field.full{grid-column:1/-1}
.field label{font-family:var(--mono);font-size:10.5px;letter-spacing:.12em;
  text-transform:uppercase;color:var(--muted)}
.field input,.field select,.field textarea{background:var(--bg);
  border:1.5px solid var(--line);border-radius:10px;padding:12px 13px;font-size:14.5px;
  transition:border-color .2s;width:100%}
.field textarea{min-height:88px;resize:vertical;line-height:1.5}
.field input:focus,.field select:focus,.field textarea:focus{outline:none;border-color:var(--muted)}
.f-err{font-size:13px;color:#ff7b66;margin-top:12px;line-height:1.5}
.f-info{font-size:13px;color:var(--muted);margin-top:12px;line-height:1.5}
.switcher{display:flex;gap:6px;background:var(--bg);border:1px solid var(--line-soft);
  border-radius:999px;padding:4px;margin-bottom:18px}
.switcher button{flex:1;padding:9px;border-radius:999px;font-size:13.5px;font-weight:600;color:var(--muted)}
.switcher button.on{background:var(--panel-2);color:var(--text)}

/* ---------- admin ---------- */
.admin{padding:120px 0 90px}
.a-head{display:flex;justify-content:space-between;align-items:center;gap:16px;
  flex-wrap:wrap;margin-bottom:26px}
.a-head h1{font-size:clamp(26px,3.4vw,40px);font-weight:720;letter-spacing:-.02em}
.a-list{display:flex;flex-direction:column;gap:10px}
.a-row{background:var(--panel);border:1px solid var(--line-soft);border-radius:12px;
  padding:15px 18px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.a-thumb{width:74px;height:54px;border-radius:8px;overflow:hidden;flex:none;
  background:var(--panel-2);border:1px solid var(--line-soft);
  display:flex;align-items:center;justify-content:center}
.a-thumb img{width:100%;height:100%;object-fit:cover}
.a-info{flex:1;min-width:180px}
.a-info b{display:block;font-size:15px;font-weight:650}
.a-info span{font-family:var(--mono);font-size:11.5px;color:var(--dim)}
.a-price{font-family:var(--mono);font-size:14px;font-weight:600}
.st{font-family:var(--mono);font-size:10.5px;font-weight:600;letter-spacing:.08em;
  padding:5px 11px;border-radius:999px;border:1px solid var(--line)}
.st.published{color:var(--ok);border-color:rgba(64,196,111,.35)}
.st.booked{color:var(--warn);border-color:rgba(242,181,68,.35)}
.st.sold{color:var(--dim)}
.st.draft{color:var(--muted)}
.a-actions{display:flex;gap:7px;flex-wrap:wrap}
.photo-strip{display:flex;gap:9px;flex-wrap:wrap;margin-top:4px}
.photo-strip .ph{position:relative;width:88px;height:64px;border-radius:9px;overflow:hidden;
  border:1px solid var(--line)}
.photo-strip img{width:100%;height:100%;object-fit:cover}
.photo-strip .rm{position:absolute;top:4px;right:4px;width:21px;height:21px;border-radius:50%;
  background:rgba(5,6,8,.8);font-size:11px;display:flex;align-items:center;justify-content:center}
.photo-strip .rm:hover{color:var(--accent)}
.up-tile{width:88px;height:64px;border:1.5px dashed var(--line);border-radius:9px;
  display:flex;align-items:center;justify-content:center;font-size:21px;color:var(--dim);
  transition:border-color .2s,color .2s}
.up-tile:hover{border-color:var(--accent);color:var(--accent)}

/* ---------- footer & toast ---------- */
footer{border-top:1px solid var(--line-soft);padding:44px 0 28px;margin-top:40px}
.foot{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;flex-wrap:wrap}
.foot .logo{font-size:24px}
.foot-links{display:flex;gap:22px;flex-wrap:wrap;font-size:13px;color:var(--muted)}
.foot-links a:hover{color:var(--accent)}
.foot-base{margin-top:26px;font-family:var(--mono);font-size:11px;color:var(--dim);
  display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
.toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,16px);z-index:120;
  background:#f2f3f5;color:#101114;font-size:13.5px;font-weight:500;padding:12px 20px;
  border-radius:999px;opacity:0;pointer-events:none;transition:.3s;max-width:88vw;text-align:center}
.toast.show{opacity:1;transform:translate(-50%,0)}
.cfg{min-height:100svh;display:flex;align-items:center;justify-content:center;padding:24px}
.cfg div{max-width:520px;border:1px solid var(--line);border-radius:14px;padding:30px;
  background:var(--panel);font-size:14.5px;line-height:1.65;color:var(--muted)}
.cfg b{color:var(--text)}
.cfg code{font-family:var(--mono);font-size:12.5px;color:var(--accent)}

@media(max-width:1020px){
  .grid{grid-template-columns:repeat(2,1fr)}
  .detail-grid{grid-template-columns:1fr}
  .panel{position:static}
}
@media(max-width:680px){
  .grid{grid-template-columns:1fr}
  .sec-head{flex-direction:column;align-items:flex-start}
  .hero{min-height:86svh}
  .f-grid{grid-template-columns:1fr}
  .specs{grid-template-columns:repeat(2,1fr)}
  .specs div:nth-child(2){border-right:none}
  .a-row{align-items:flex-start}
}
@media(prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}
  *{animation-duration:.001s !important;transition-duration:.001s !important}
}
`

// ---------- Siluet blueprint (fallback saat unit belum punya foto) ----------
function Silhouette() {
  return (
    <svg className="sil" viewBox="0 0 300 170" fill="none" stroke="#4a4f58"
      strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
  const [pay, setPay] = useState(null) // { booking_code, dp_amount, expires_at, qr_string, qr_url }
  const [qrImg, setQrImg] = useState(null)
  const chanRef = useRef(null)
  const pollRef = useRef(null)
  const { left, text: timerText } = useCountdown(pay ? pay.expires_at : null)

  const dp = Math.round(Number(listing.price) * Number(listing.dp_rate || 0.1))

  useEffect(() => () => cleanup(), []) // saat unmount
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
          width: 520, margin: 1, color: { dark: '#101114', light: '#ffffff' },
        })
        setQrImg(url)
      }
      setStep('qr')
      // Realtime: tunggu webhook menandai booking paid
      chanRef.current = supabase
        .channel('bk-' + data.booking_code)
        .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'bookings', filter: 'code=eq.' + data.booking_code },
          (payload) => { if (payload.new && payload.new.status === 'paid') markPaid() })
        .subscribe()
      // Cadangan: poll tiap 8 detik kalau realtime terlewat
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
                <div className="row"><span>DP ({Math.round((listing.dp_rate || 0.1) * 100)}%)<small>dibayar sekarang via QRIS</small></span><b>{rupiah(dp)}</b></div>
                <div className="row"><span>{warranty.name}<small>dibayar saat pelunasan</small></span><b>{warranty.price ? rupiah(warranty.price) : 'Termasuk'}</b></div>
                <div className="row hl"><span>Bayar sekarang</span><b>{rupiah(dp)}</b></div>
              </div>
              <p className="fine">DP mengunci unit selama 3 hari kerja untuk pelunasan dan serah terima.
                DP kembali penuh bila kondisi unit tidak sesuai laporan kurasi.</p>
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
              <span className="sandbox">● QRIS — kode booking {pay.booking_code}</span>
              <div className="qr-tile">
                {qrImg
                  ? <img src={qrImg} alt={'Kode QRIS untuk ' + rupiah(pay.dp_amount)} />
                  : pay.qr_url
                    ? <img src={pay.qr_url} alt="Kode QRIS" />
                    : <p style={{ color: '#101114', padding: 20 }}>QR tidak tersedia</p>}
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
    // slug mengikuti isian terbaru kalau unit baru
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
    if (error) toast('Gagal: ' + error.message)
    else { toast(status === 'sold' ? 'Unit ditandai terjual' : status === 'published' ? 'Unit tayang' : 'Unit ditarik dari etalase'); load() }
  }

  return (
    <section className="admin">
      <div className="wrap">
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
                  {(l.status === 'published' || l.status === 'booked') && (
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => { if (confirm('Tandai ' + l.title + ' sebagai TERJUAL?')) setStatus(l, 'sold') }}>
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
  const dp = Math.round(Number(listing.price) * Number(listing.dp_rate || 0.1))
  const canBook = listing.status === 'published'

  useEffect(() => { setIdx(0) }, [listing.id])

  return (
    <section className="detail">
      <div className="wrap">
        <a className="back" href="#/" onClick={(e) => { e.preventDefault(); nav('#/') }}>← Kembali ke etalase</a>
        <div className="detail-grid">
          <div>
            <div className="gallery-main">
              {photos[idx] ? <img src={photos[idx]} alt={listing.title} /> : <Silhouette />}
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
              <p className="stnote warn">Unit sedang di-booking pembeli lain. Bila DP-nya hangus, unit tayang kembali otomatis.</p>)}
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
              <div className="row hl"><span>DP kunci unit<small>dibayar sekarang via QRIS</small></span><b>{rupiah(dp)}</b></div>
            </div>

            <button className="btn btn-accent btn-full" disabled={!canBook}
              onClick={() => onBook(listing, warranty)}>
              {canBook ? 'Booking DP via QRIS' : listing.status === 'booked' ? 'Sudah di-booking' : listing.status === 'sold' ? 'Terjual' : 'Belum tersedia'}
            </button>
            <p className="fine">DP mengunci unit 3 hari kerja. Sisa pembayaran + garansi dibayar saat
              serah terima di Motorell. DP kembali penuh bila unit tidak sesuai laporan kurasi.</p>
          </aside>
        </div>
      </div>
    </section>
  )
}

// ---------- Kartu & beranda ----------
function Card({ l, nav }) {
  const photos = Array.isArray(l.photos) ? l.photos : []
  return (
    <button className={'card' + (l.status === 'sold' ? ' is-sold' : '')} onClick={() => nav('#/unit/' + l.slug)}>
      <div className="card-media">
        {photos[0] ? <img src={photos[0]} alt={l.title} loading="lazy" /> : <Silhouette />}
        <span className="badge grade">GRADE {l.grade}</span>
        {l.status === 'booked' && <span className="badge st-booked">DI-BOOKING</span>}
        {l.status === 'sold' && <span className="badge st-sold">TERJUAL</span>}
      </div>
      <div className="card-body">
        <h3>{l.title}</h3>
        <span className="card-meta">{l.year} · {l.mileage_km ? fmt(l.mileage_km) + ' KM' : 'KM —'}{l.color ? ' · ' + l.color.toUpperCase() : ''}</span>
        <span className="card-price">{rupiah(l.price)}</span>
      </div>
      <span className="card-go"><span>Lihat detail</span><span>→</span></span>
    </button>
  )
}

function HomeView({ listings, nav }) {
  const published = listings.filter((l) => l.status === 'published')
  const featured = published.find((l) => Array.isArray(l.photos) && l.photos.length > 0) || published[0]
  const minPrice = published.length ? Math.min(...published.map((l) => Number(l.price))) : null
  const order = { published: 0, booked: 1, sold: 2 }
  const shown = [...listings]
    .filter((l) => ['published', 'booked', 'sold'].includes(l.status))
    .sort((a, b) => (order[a.status] - order[b.status]) || (new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at)))

  return (
    <>
      <section className="hero">
        <div className="hero-media">
          {featured && Array.isArray(featured.photos) && featured.photos[0]
            ? <img src={featured.photos[0]} alt="" />
            : <Silhouette />}
        </div>
        <div className="hero-in wrap">
          <div className="hero-copy">
            <p className="kicker">Motorell Market — showroom terkurasi</p>
            <h1>Pilih. Kunci.<br />Bawa <em>pulang.</em></h1>
            <p>Setiap unit di lantai showroom ini sudah lolos inspeksi 175 titik oleh mekanik
              Motorell — lengkap dengan catatan jujur tentang kondisinya.</p>
            {minPrice && <p className="from">Unit tersedia mulai <b>{rupiah(minPrice)}</b></p>}
            <div className="hero-cta">
              <a className="btn btn-accent" href="#etalase">Lihat semua unit</a>
              <a className="btn btn-ghost" href="#kurasi">Standar kurasi</a>
            </div>
          </div>
          <div className="spec-rail">
            <span>Unit tayang<b>{published.length} unit</b></span>
            <span>Inspeksi mekanik<b>175 titik</b></span>
            <span>Garansi mesin<b>s.d. 180 hari</b></span>
            <span>Kunci unit<b>DP 10% via QRIS</b></span>
          </div>
        </div>
      </section>

      <section className="section" id="etalase">
        <div className="wrap">
          <div className="sec-head">
            <div>
              <p className="kicker">Etalase</p>
              <h2>Pilih unitmu.</h2>
            </div>
            <p className="aside">Klik unit untuk melihat foto, catatan kurasi, memilih paket garansi,
              dan mengunci unit dengan DP via QRIS.</p>
          </div>
          <div className="grid">
            {shown.length === 0 && (
              <div className="empty">Etalase sedang kosong — unit baru sedang dalam proses kurasi.</div>)}
            {shown.map((l) => <Card key={l.id} l={l} nav={nav} />)}
          </div>
        </div>
      </section>

      <section className="section" id="kurasi" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="trust">
            <div><h4><b>175</b>Titik inspeksi</h4>
              <p>Mesin, rangka, kelistrikan, dokumen, dan uji jalan diperiksa mekanik sebelum unit boleh tayang. Minusnya pun ditulis apa adanya.</p></div>
            <div><h4><b>180</b>Hari garansi maksimal</h4>
              <p>Tiga paket garansi mesin bisa dipilih saat booking — dari 30 hari standar sampai 180 hari plus servis berkala.</p></div>
            <div><h4><b>10%</b>DP via QRIS</h4>
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

  // routing via hash
  useEffect(() => {
    const onHash = () => { setRoute(parseHash()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // nav bg
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // auth
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

  // etalase + realtime
  const loadListings = useCallback(async () => {
    if (!supabase) return
    const { data, error } = await supabase.from('listings')
      .select('*')
      .in('status', ['published', 'booked', 'sold'])
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

  // deep link ke unit yang belum ada di state (mis. draft utk staf)
  useEffect(() => {
    if (route.name !== 'unit' || !supabase) { setDeepUnit(null); return }
    const found = listings.find((l) => l.slug === route.slug)
    if (found) { setDeepUnit(null); return }
    supabase.from('listings').select('*').eq('slug', route.slug).maybeSingle()
      .then(({ data }) => setDeepUnit(data))
  }, [route, listings])

  // lanjutkan booking setelah login
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
        <div className="nav-in">
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
              <button className="btn btn-ghost btn-sm" onClick={() => setAuthOpen(true)}>Masuk</button>
            )}
          </div>
        </div>
      </header>

      <main>
        {route.name === 'home' && <HomeView listings={listings} nav={nav} />}

        {route.name === 'unit' && (current
          ? <DetailView listing={current} nav={nav} onBook={requestBooking} />
          : <section className="detail"><div className="wrap">
              <a className="back" href="#/" onClick={(e) => { e.preventDefault(); nav('#/') }}>← Kembali ke etalase</a>
              <p style={{ color: 'var(--muted)' }}>Unit tidak ditemukan atau sudah tidak tayang.</p>
            </div></section>)}

        {route.name === 'admin' && (isStaff
          ? <AdminPanel profile={profile} toast={toast} nav={nav} />
          : <section className="admin"><div className="wrap">
              <p className="kicker">Panel admin</p>
              <h1 style={{ margin: '14px 0 12px', fontWeight: 720 }}>Khusus staf Motorell</h1>
              <p style={{ color: 'var(--muted)', maxWidth: 460, lineHeight: 1.6 }}>
                Masuk dengan akun yang berperan admin atau kurator untuk mengelola etalase.</p>
              {!session && <div style={{ marginTop: 20 }}>
                <button className="btn btn-accent" onClick={() => setAuthOpen(true)}>Masuk</button></div>}
            </div></section>)}
      </main>

      <footer>
        <div className="wrap">
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
