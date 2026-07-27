// ============================================================
// Upload foto ke Supabase Storage — jalur TERPUSAT & bisa diuji.
//
// Modul terpisah (bukan di App.jsx) supaya bisa diuji dengan mock Supabase
// client tanpa merender React. Dipakai dua form: admin unit & titip jual.
//
// PENTING soal bucket:
//  - Nama bucket TIDAK di-hardcode di sini — dilewatkan pemanggil, dan HARUS
//    sama persis dengan nama di Supabase console (CASE-SENSITIVE: 'unit-photos'
//    bukan 'Unit-Photos').
//  - Bucket yang dipakai project: 'unit-photos' (unit resmi) dan
//    'titip-jual-photos' (titip jual — dibuat oleh migrasi 0003_titip_jual.sql).
//
// uploadPhoto() melempar Error ber-`code` dengan pesan yang jelas, dan
// mengembalikan { url, path } saat sukses.
// ============================================================

export const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const PHOTO_MAX_MB = 5   // batas ukuran file MENTAH per foto (checklist)

// Nama file dibersihkan: buang path & karakter aneh, buang ekstensi (konten
// selalu di-transcode ke JPEG). Menghasilkan bagian nama yang aman dipakai di
// path storage & tetap terbaca manusia.
export function sanitizePhotoName(name) {
  const base = String(name || 'foto').split(/[\\/]/).pop().replace(/\.[^.]+$/, '')
  const clean = base.toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return (clean || 'foto').slice(0, 60)
}

function uuid() {
  return (globalThis.crypto && globalThis.crypto.randomUUID)
    ? globalThis.crypto.randomUUID()
    : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

// Path: {dir}/{uuid}-{namaAsli}.{ext} — dir biasanya userId (titip jual) atau
// slug unit (admin). uuid mencegah bentrok; nama asli menjaga keterbacaan.
// `ext` mengikuti hasil kompresi (webp bila didukung, selain itu jpg).
export function buildPhotoPath(dir, fileName, ext = 'jpg') {
  const folder = String(dir || 'misc').replace(/^\/+|\/+$/g, '') || 'misc'
  const e = /^(webp|jpe?g|png)$/i.test(ext) ? ext.toLowerCase().replace('jpeg', 'jpg') : 'jpg'
  return folder + '/' + uuid() + '-' + sanitizePhotoName(fileName) + '.' + e
}

// Sisipkan ".thumb" sebelum ekstensi terakhir sebuah path/URL storage:
//   "dir/uuid-name.webp"     -> "dir/uuid-name.thumb.webp"
//   ".../name.jpg?token=abc" -> ".../name.thumb.jpg?token=abc"
// Dipakai DUA sisi: nama objek thumbnail saat upload, & menurunkan URL thumb
// dari URL full saat render kartu. Bila tak ada ekstensi yang cocok →
// dikembalikan apa adanya (pemanggil menyediakan fallback ke URL full).
export function thumbKey(pathOrUrl) {
  return String(pathOrUrl || '').replace(/(\.[a-z0-9]+)(\?.*)?$/i, '.thumb$1$2')
}

// Validasi tipe & ukuran SEBELUM upload. Melempar Error ber-`code`.
export function validatePhoto(file) {
  if (!file || !ALLOWED_PHOTO_TYPES.includes(file.type)) {
    throw Object.assign(
      new Error('Format tidak didukung' + (file && file.type ? ' (' + file.type + ')' : '') +
        ' — hanya JPG, PNG, atau WEBP.'),
      { code: 'invalid_type' })
  }
  if (file.size > PHOTO_MAX_MB * 1024 * 1024) {
    throw Object.assign(
      new Error('Ukuran ' + (file.size / 1048576).toFixed(1) + 'MB melebihi batas ' + PHOTO_MAX_MB + 'MB.'),
      { code: 'file_too_large' })
  }
}

// Terjemahkan error Storage jadi { code, message } yang jelas untuk pengguna.
export function classifyUploadError(err, bucket) {
  const raw = String((err && (err.message || err.error)) || err || '')
  const m = raw.toLowerCase()
  if (/bucket not found|no such bucket/.test(m)) {
    return {
      code: 'bucket_not_found',
      message: 'Bucket "' + bucket + '" tidak ditemukan di Supabase Storage. Cek nama bucket ' +
        '(case-sensitive) dan pastikan sudah dibuat' +
        (bucket === 'titip-jual-photos' ? ' — jalankan migrasi 0003_titip_jual.sql.' : '.'),
    }
  }
  if (/jwt|token|unauthorized|not authenticated|auth|permission|row-level|violates|denied|\b401\b|\b403\b/.test(m)) {
    return { code: 'auth_error', message: 'Sesi atau izin bermasalah — keluar lalu masuk lagi, kemudian ulangi upload.' }
  }
  if (/failed to fetch|networkerror|load failed|timeout|network/.test(m)) {
    return { code: 'network_error', message: 'Koneksi ke server bermasalah — cek internet lalu coba lagi.' }
  }
  if (/already exists|duplicate|\b409\b/.test(m)) {
    return { code: 'conflict', message: 'Nama file bentrok di server — coba unggah ulang.' }
  }
  return { code: 'storage_error', message: 'Gagal mengunggah foto: ' + (raw || 'coba lagi.') }
}

// Upload satu foto. `compress` (opsional) = fungsi async (file)->Blob untuk
// menekan ukuran (browser). `client` = Supabase client (di-inject supaya bisa
// di-mock saat test). Mengembalikan { url, path }; melempar Error ber-`code`.
export async function uploadPhoto(file, { client, bucket, dir, compress } = {}) {
  if (!client) throw Object.assign(new Error('Supabase client tidak tersedia.'), { code: 'no_client' })
  if (!bucket) throw Object.assign(new Error('Nama bucket wajib diisi.'), { code: 'no_bucket' })
  validatePhoto(file)

  // `compress` (opsional) bisa mengembalikan:
  //  - Blob (kontrak lama)              → 1 varian; ekstensi diturunkan dari tipe
  //  - { full, thumb, ext, type } (baru)→ 2 varian (full ≤1600px + thumb ≤640px)
  const out = compress ? await compress(file) : null
  let full = file, thumb = null, ext = 'jpg', type = 'image/jpeg'
  if (out && out.full) {
    full = out.full; thumb = out.thumb || null
    ext = out.ext || 'jpg'; type = out.type || 'image/jpeg'
  } else if (out) {
    full = out
    if (out.type === 'image/webp') { ext = 'webp'; type = 'image/webp' }
    else if (out.type === 'image/png') { ext = 'png'; type = 'image/png' }
  }

  const path = buildPhotoPath(dir, file.name, ext)

  // cacheControl 1 tahun: tiap `path` unik (uuid) & isinya tak pernah berubah,
  // jadi aman di-cache lama. Browser & CDN menyimpan foto → pengunjung berulang
  // / pindah halaman tak mengunduh ulang → EGRESS Supabase turun signifikan.
  // (Objek lama tetap 3600 sampai di-update; lihat catatan ke user soal batch.)
  const { error } = await client.storage.from(bucket)
    .upload(path, full, { contentType: type, cacheControl: '31536000', upsert: false })
  if (error) {
    const c = classifyUploadError(error, bucket)
    throw Object.assign(new Error(c.message), { code: c.code, raw: error })
  }

  // Thumbnail OPSIONAL: kalau gagal, JANGAN gagalkan upload utama — kartu punya
  // fallback ke URL full. Path thumb = path full + sisipan ".thumb".
  if (thumb) {
    const tpath = thumbKey(path)
    const { error: terr } = await client.storage.from(bucket)
      .upload(tpath, thumb, { contentType: type, cacheControl: '31536000', upsert: false })
    if (terr) console.warn('[UPLOAD] thumbnail gagal (diabaikan):', tpath, terr.message || terr)
  }

  const { data } = client.storage.from(bucket).getPublicUrl(path)
  if (!data || !data.publicUrl) {
    throw Object.assign(new Error('Upload berhasil tapi URL publik tidak tersedia.'), { code: 'no_url' })
  }
  return { url: data.publicUrl, path }
}
