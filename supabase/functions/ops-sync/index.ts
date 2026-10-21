// ============================================================
// Edge Function: ops-sync
// Menerima motor dari Motorell Ops dan membuat/memperbarui listing di etalase Market.
//   • Hanya permintaan bertanda tangan HMAC (OPS_SYNC_SECRET) yang diproses; cap waktu maks. 5 menit.
//   • Foto diunduh dari penyimpanan Ops (hanya URL berawalan OPS_STORAGE_PREFIX, anti-SSRF) lalu diunggah ke bucket unit-photos.
//   • Idempoten: kolom listings.ops_unit_id unik, kiriman ulang memperbarui listing yang sama.
//
// Deploy TANPA verifikasi JWT (Ops tidak mengirim JWT Market):
//   supabase functions deploy ops-sync --no-verify-jwt
// Secrets (jangan commit, jangan pakai prefix VITE_):
//   supabase secrets set OPS_SYNC_SECRET=<min 32 karakter> OPS_STORAGE_PREFIX=https://<ref-ops>.supabase.co/storage/v1/object/sign/photos/
// SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY otomatis tersedia.
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { slugify, validatePayload, verifySignature } from './lib.ts'

const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })
const MAX_PHOTO_BYTES = 6 * 1024 * 1024

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  const secret = Deno.env.get('OPS_SYNC_SECRET') ?? ''
  const prefix = Deno.env.get('OPS_STORAGE_PREFIX') ?? ''
  if (secret.length < 32 || !prefix.startsWith('https://')) return json(500, { error: 'Server config missing' })

  const raw = await req.text()
  if (raw.length > 100_000) return json(413, { error: 'Payload terlalu besar' })
  if (!(await verifySignature(secret, req.headers.get('x-ops-timestamp'), req.headers.get('x-ops-signature'), raw))) {
    return json(401, { error: 'Tanda tangan tidak valid' })
  }
  let body: unknown
  try { body = JSON.parse(raw) } catch { return json(400, { error: 'JSON tidak valid' }) }
  const parsed = validatePayload(body, prefix)
  if (!parsed.ok) return json(422, { error: parsed.error })
  const v = parsed.v

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } })

  try {
    const { data: existing, error: eErr } = await db.from('listings')
      .select('id, slug, published_at').eq('ops_unit_id', v.ops_unit_id).maybeSingle()
    if (eErr) throw new Error(eErr.message)
    const title = `${v.brand} ${v.model} ${v.year}`.replace(/\s+/g, ' ').trim()
    const slug = existing?.slug ?? `${slugify(title) || 'unit'}-${Math.random().toString(36).slice(2, 6)}`

    // Unduh foto dari Ops, unggah ke Market (path unik; foto lama dibiarkan agar tautan lama tidak patah).
    const urls: string[] = []
    for (let i = 0; i < v.photos.length; i++) {
      const res = await fetch(v.photos[i], { signal: AbortSignal.timeout(25_000) })
      if (!res.ok) throw new Error(`Foto ${i + 1} gagal diunduh dari Ops (${res.status})`)
      const type = (res.headers.get('content-type') ?? '').split(';')[0]
      if (type !== 'image/jpeg') throw new Error(`Foto ${i + 1} bukan JPEG`)
      const bytes = new Uint8Array(await res.arrayBuffer())
      if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) throw new Error(`Ukuran foto ${i + 1} tidak valid`)
      const path = `${slug}/ops-${crypto.randomUUID()}.jpg`
      const { error: uErr } = await db.storage.from('unit-photos')
        .upload(path, bytes, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false })
      if (uErr) throw new Error('Gagal mengunggah foto: ' + uErr.message)
      urls.push(db.storage.from('unit-photos').getPublicUrl(path).data.publicUrl)
    }

    const now = new Date().toISOString()
    const payload = {
      brand: v.brand, model: v.model, title, year: v.year, mileage_km: v.mileage_km, color: v.color, price: v.price,
      grade: v.grade, description: v.description, known_issues: v.known_issues, photos: urls, status: 'published',
      ops_unit_id: v.ops_unit_id, ops_synced_at: now,
    }
    if (existing) {
      const { error } = await db.from('listings')
        .update({ ...payload, published_at: existing.published_at ?? now }).eq('id', existing.id)
      if (error) throw new Error(error.message)
      return json(200, { listing_id: existing.id, slug, created: false })
    }
    const { data, error } = await db.from('listings')
      .insert({ ...payload, slug, published_at: now }).select('id').single()
    if (error) throw new Error(error.message)
    return json(200, { listing_id: data.id, slug, created: true })
  } catch (e) {
    return json(500, { error: (e as Error).message })
  }
})
