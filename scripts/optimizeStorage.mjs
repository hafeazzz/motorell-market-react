// ============================================================
// scripts/optimizeStorage.mjs — optimasi EGRESS untuk foto yang SUDAH ADA.
//
// Melengkapi optimasi upload baru (WebP + thumbnail + cache 1thn) dengan
// menerapkan hal yang sama ke objek LAMA di Supabase Storage:
//   1) set Cache-Control 1 tahun (objek lama masih 3600 dtk → boros egress),
//   2) recompress full ≤1600px (kualitas ~80) DI TEMPAT (path & nama TETAP →
//      URL yang tersimpan di DB tidak berubah / tidak rusak),
//   3) buat varian thumbnail "*.thumb.*" ≤640px (grid etalase otomatis memakainya
//      lewat thumbKey(url); tanpa ini kartu memuat foto full).
//
// AMAN by design:
//   - DRY-RUN default: hanya melapor rencana + ukuran saat ini (dari metadata,
//     tanpa mengunduh). Menulis HANYA bila diberi flag --apply.
//   - Recompress in-place (upsert) → tidak me-rename, tidak mengubah URL DB.
//   - Per-file try/catch → satu galat tak menghentikan seluruh proses.
//   - TIDAK dijadwalkan otomatis. Jalankan manual, sesekali.
//
// PRASYARAT:
//   npm i -D sharp
//   (sharp = pustaka Node native; TIDAK dipakai app browser — hanya skrip ini.)
//
// KREDENSIAL (JANGAN commit — repo ini publik):
//   export SUPABASE_URL="https://<ref>.supabase.co"
//   export SUPABASE_SERVICE_ROLE_KEY="<service_role — RAHASIA, bypass RLS>"
//   (service_role ada di Supabase Dashboard → Settings → API. Simpan di password
//    manager / GitHub Secret, jangan di file yang ter-commit.)
//
// PAKAI:
//   node scripts/optimizeStorage.mjs                 # dry-run (lihat rencana)
//   node scripts/optimizeStorage.mjs --apply         # kerjakan sungguhan
//   node scripts/optimizeStorage.mjs --apply --limit 20   # batasi 20 file (uji)
// ============================================================
import { createClient } from '@supabase/supabase-js'

let sharp
try { sharp = (await import('sharp')).default }
catch { console.error('✗ Butuh "sharp". Jalankan:  npm i -D sharp'); process.exit(1) }

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('✗ Set SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY dulu (lihat header file).')
  process.exit(1)
}
const APPLY = process.argv.includes('--apply')
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > -1 ? parseInt(process.argv[i + 1], 10) || Infinity : Infinity })()
const BUCKETS = ['unit-photos', 'titip-jual-photos']
const FULL_MAX = 1600, THUMB_MAX = 640, FULL_Q = 80, THUMB_Q = 70, CACHE = '31536000'

const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } })

const isImg = (n) => /\.(jpe?g|png|webp)$/i.test(n)
const isThumb = (n) => /\.thumb\.[a-z0-9]+$/i.test(n)
const thumbPath = (k) => k.replace(/(\.[a-z0-9]+)$/i, '.thumb$1')
const ctypeOf = (n) => /\.png$/i.test(n) ? 'image/png' : /\.webp$/i.test(n) ? 'image/webp' : 'image/jpeg'
const mb = (b) => (b / 1048576).toFixed(2) + ' MB'

// List rekursif (Supabase .list hanya satu level; folder = entri dengan id null).
async function* walk(bucket, prefix = '') {
  let offset = 0
  for (;;) {
    const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw error
    if (!data || data.length === 0) break
    for (const e of data) {
      const path = prefix ? prefix + '/' + e.name : e.name
      if (e.id === null && !e.metadata) yield* walk(bucket, path)   // folder
      else yield { path, size: e.metadata?.size || 0 }
    }
    if (data.length < 100) break
    offset += 100
  }
}

function encode(buf, maxW, quality, name) {
  const img = sharp(buf).rotate().resize(maxW, maxW, { fit: 'inside', withoutEnlargement: true })
  if (/\.png$/i.test(name)) return img.png({ quality, compressionLevel: 9 }).toBuffer()
  if (/\.webp$/i.test(name)) return img.webp({ quality }).toBuffer()
  return img.jpeg({ quality, mozjpeg: true }).toBuffer()
}

async function run() {
  console.log(`\n=== optimizeStorage — ${APPLY ? 'APPLY (menulis)' : 'DRY-RUN (tanpa menulis)'} ===`)
  let files = 0, thumbsToMake = 0, curBytes = 0, savedFull = 0, madeThumb = 0, errs = 0, processed = 0

  for (const bucket of BUCKETS) {
    // Kumpulkan dulu daftar nama (untuk cek thumb sudah ada / belum).
    let names
    try { names = new Set(); for await (const f of walk(bucket)) names.add(f.path) }
    catch (e) { console.error(`✗ Gagal list ${bucket}: ${e.message} (bucket ada?)`); continue }

    for await (const f of walk(bucket)) {
      if (processed >= LIMIT) break
      if (!isImg(f.path) || isThumb(f.path)) continue
      files++; curBytes += f.size
      const needThumb = !names.has(thumbPath(f.path))
      if (needThumb) thumbsToMake++

      if (!APPLY) continue
      processed++
      try {
        const { data: blob, error: dErr } = await sb.storage.from(bucket).download(f.path)
        if (dErr) throw dErr
        const buf = Buffer.from(await blob.arrayBuffer())

        // 1+2) recompress full in-place + cache 1thn (path & nama tetap).
        const full = await encode(buf, FULL_MAX, FULL_Q, f.path)
        if (full.length < buf.length) {
          const { error } = await sb.storage.from(bucket).upload(f.path, full,
            { upsert: true, contentType: ctypeOf(f.path), cacheControl: CACHE })
          if (error) throw error
          savedFull += (buf.length - full.length)
        } else {
          // Sudah optimal; tetap re-upload agar cache-control 1thn menempel.
          await sb.storage.from(bucket).upload(f.path, buf,
            { upsert: true, contentType: ctypeOf(f.path), cacheControl: CACHE })
        }

        // 3) thumbnail (kalau belum ada).
        if (needThumb) {
          const thumb = await encode(buf, THUMB_MAX, THUMB_Q, f.path)
          const { error } = await sb.storage.from(bucket).upload(thumbPath(f.path), thumb,
            { upsert: true, contentType: ctypeOf(f.path), cacheControl: CACHE })
          if (error) throw error
          madeThumb++
        }
        console.log(`✓ ${bucket}/${f.path}`)
      } catch (e) {
        errs++; console.error(`✗ ${bucket}/${f.path}: ${e.message}`)
      }
    }
  }

  console.log('\n--- Ringkasan ---')
  console.log(`Foto (bukan thumb)   : ${files}  (${mb(curBytes)} saat ini)`)
  console.log(`Thumbnail perlu dibuat: ${thumbsToMake}`)
  if (APPLY) {
    console.log(`Recompress hemat     : ${mb(savedFull)}`)
    console.log(`Thumbnail dibuat     : ${madeThumb}`)
    console.log(`Gagal                : ${errs}`)
    console.log('\nSelesai. Semua objek kini Cache-Control 1 tahun → egress berulang turun.')
  } else {
    console.log('\nDRY-RUN. Jalankan ulang dengan --apply untuk mengerjakannya.')
    console.log('Tip: uji dulu dengan  --apply --limit 20  sebelum semua.')
  }
}
run().catch((e) => { console.error('FATAL:', e.message); process.exit(1) })
