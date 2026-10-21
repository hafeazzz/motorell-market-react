// Logika murni fungsi ops-sync (tanpa jaringan/DB) supaya bisa diuji.

export const PHOTO_MIN = 3
export const PHOTO_MAX = 10

export async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

// Tanda tangan sah = HMAC-SHA256(secret, `${timestamp}.${bodyMentah}`) dan timestamp tidak lebih tua dari 5 menit.
export async function verifySignature(secret: string, ts: string | null, sig: string | null, raw: string, nowSec = Date.now() / 1000): Promise<boolean> {
  const t = Number(ts)
  if (!secret || !sig || !Number.isFinite(t) || Math.abs(nowSec - t) > 300) return false
  return safeEq(sig, await hmacHex(secret, `${t}.${raw}`))
}

export const slugify = (s: string) =>
  String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const str = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max

export interface OpsListing {
  ops_unit_id: string; brand: string; model: string; year: number; mileage_km: number; color: string
  price: number; grade: 'S' | 'A' | 'B'; description: string; known_issues: string | null; photos: string[]
}

// Mengembalikan { ok:true, v } atau { ok:false, error }. photoPrefix = awalan URL foto yang diizinkan (hanya penyimpanan Ops).
export function validatePayload(p: any, photoPrefix: string, nowYear = new Date().getFullYear()): { ok: true; v: OpsListing } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error })
  if (!p || typeof p !== 'object') return bad('Body tidak valid')
  if (typeof p.ops_unit_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.ops_unit_id)) return bad('ops_unit_id tidak valid')
  if (!str(p.brand, 60)) return bad('brand wajib')
  if (!str(p.model, 80)) return bad('model wajib')
  if (!Number.isInteger(p.year) || p.year < 1950 || p.year > nowYear + 1) return bad('year tidak valid')
  if (!Number.isInteger(p.mileage_km) || p.mileage_km < 1 || p.mileage_km > 300000) return bad('mileage_km tidak valid')
  if (!str(p.color, 40)) return bad('color wajib')
  if (!Number.isInteger(p.price) || p.price < 1_000_000 || p.price > 5_000_000_000) return bad('price tidak valid')
  if (!['S', 'A', 'B'].includes(p.grade)) return bad('grade harus S, A, atau B')
  if (typeof p.description !== 'string' || p.description.trim().length < 20 || p.description.length > 4000) return bad('description minimal 20 huruf')
  if (p.known_issues != null && (typeof p.known_issues !== 'string' || p.known_issues.length > 2000)) return bad('known_issues tidak valid')
  if (!Array.isArray(p.photos) || p.photos.length < PHOTO_MIN || p.photos.length > PHOTO_MAX) return bad(`foto harus ${PHOTO_MIN}-${PHOTO_MAX}`)
  if (!photoPrefix || !p.photos.every((u: unknown) => typeof u === 'string' && u.startsWith(photoPrefix))) return bad('URL foto tidak diizinkan')
  return { ok: true, v: {
    ops_unit_id: p.ops_unit_id.toLowerCase(), brand: p.brand.trim(), model: p.model.trim(), year: p.year, mileage_km: p.mileage_km,
    color: p.color.trim(), price: p.price, grade: p.grade, description: p.description.trim(),
    known_issues: p.known_issues ? String(p.known_issues).trim() || null : null, photos: p.photos,
  } }
}
