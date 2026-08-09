// ============================================================
// Edge Function: create-doku-payment
// Membuat order pembayaran Doku (Checkout / non-SNAP) DENGAN AMAN:
//   • Secret Doku diambil dari env server (Supabase secrets), TAK PERNAH ke klien.
//   • Amount ditentukan SERVER (PRICES) — abaikan apa pun yang dikirim klien.
//   • Baris payments dibuat via service_role (klien tak punya izin tulis).
// Klien memanggil: supabase.functions.invoke('create-doku-payment', { body: { type, listing_id?, full_name, email, phone } })
// dan menerima { checkout_url } lalu redirect.
//
// Secrets yang WAJIB diset (JANGAN pakai prefix VITE_ / jangan commit):
//   supabase secrets set DOKU_CLIENT_ID=... DOKU_SECRET_KEY=... DOKU_ENV=sandbox
// (DOKU_ENV: 'sandbox' | 'production'. SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY
//  otomatis tersedia.)
//
// CATATAN: verifikasi endpoint & nama field body/response terhadap dokumen produk
// Doku milikmu (Checkout). Struktur di bawah mengikuti Doku non-SNAP Checkout.
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// SUMBER KEBENARAN harga (server-side). Ubah di sini, bukan di klien.
const PRICES: Record<string, number> = { etalase: 505_000, titip: 18_000 }
const DESC: Record<string, string> = { etalase: 'DP Pembelian Motor', titip: 'DP Titip Jual' }
const CHECKOUT_PATH = '/checkout/v1/payment'

function b64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
async function sha256B64(input: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return b64(new Uint8Array(h))
}
async function hmac256B64(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg))
  return b64(new Uint8Array(sig))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' })

  try {
    const clientId = Deno.env.get('DOKU_CLIENT_ID')
    const secret = Deno.env.get('DOKU_SECRET_KEY')
    const env = (Deno.env.get('DOKU_ENV') || 'sandbox').toLowerCase()
    if (!clientId || !secret) return json(500, { error: 'Konfigurasi Doku belum lengkap di server.' })
    const base = env === 'production' ? 'https://api.doku.com' : 'https://api-sandbox.doku.com'

    const supaUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const db = createClient(supaUrl, serviceKey, { auth: { persistSession: false } })

    // Pemanggil boleh anonim (guest) — tapi kalau ada JWT, catat user_id-nya.
    let userId: string | null = null
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (jwt) { const { data } = await db.auth.getUser(jwt); userId = data?.user?.id ?? null }

    const body = await req.json().catch(() => ({}))
    const type = String(body?.type || '')
    if (!(type in PRICES)) return json(400, { error: 'Tipe pembayaran tidak dikenal.' })
    const amount = PRICES[type]                         // ← server-authoritative, abaikan klien
    const full_name = (body?.full_name || '').toString().slice(0, 120)
    const email = (body?.email || '').toString().slice(0, 255)
    const phone = (body?.phone || '').toString().slice(0, 40)
    const listing_id = body?.listing_id ? String(body.listing_id) : null
    if (!full_name || !email || !phone) return json(400, { error: 'Nama, email, dan nomor WhatsApp wajib diisi.' })

    const invoice = `INV-${type}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    const origin = req.headers.get('Origin') || (body?.origin ? String(body.origin) : '')
    const successUrl = origin ? `${origin}/#/payment-success` : undefined

    // 1) Catat pending dulu (sumber kebenaran; webhook yang mengubah jadi success).
    const { error: insErr } = await db.from('payments').insert({
      user_id: userId, type, amount, status: 'pending',
      full_name, email, phone, listing_id, invoice_number: invoice,
    })
    if (insErr) return json(500, { error: 'Gagal menyimpan pembayaran: ' + insErr.message })

    // 2) Bangun tanda tangan Doku non-SNAP & panggil Checkout.
    const payload = {
      order: {
        amount, invoice_number: invoice, currency: 'IDR',
        callback_url: successUrl,
        line_items: [{ name: DESC[type], price: amount, quantity: 1 }],
      },
      payment: { payment_due_date: 60 },
      customer: { id: userId || email, name: full_name, email, phone },
    }
    const rawBody = JSON.stringify(payload)
    const requestId = crypto.randomUUID()
    const ts = new Date().toISOString().split('.')[0] + 'Z'
    const digest = await sha256B64(rawBody)
    const canonical = [
      `Client-Id:${clientId}`,
      `Request-Id:${requestId}`,
      `Request-Timestamp:${ts}`,
      `Request-Target:${CHECKOUT_PATH}`,
      `Digest:${digest}`,
    ].join('\n')
    const signature = 'HMACSHA256=' + await hmac256B64(secret, canonical)

    const dokuRes = await fetch(base + CHECKOUT_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Id': clientId,
        'Request-Id': requestId,
        'Request-Timestamp': ts,
        'Signature': signature,
      },
      body: rawBody,
    })
    const dokuData = await dokuRes.json().catch(() => ({}))
    // Doku Checkout mengembalikan response.payment.url (URL halaman bayar).
    const checkoutUrl = dokuData?.response?.payment?.url || dokuData?.payment?.url || null
    const tokenId = dokuData?.response?.payment?.token_id || null

    if (!dokuRes.ok || !checkoutUrl) {
      await db.from('payments').update({ status: 'failed', raw_notification: dokuData })
        .eq('invoice_number', invoice)
      return json(502, { error: dokuData?.error?.message || dokuData?.message || 'Gagal membuat order Doku.' })
    }

    // 3) Simpan URL/token, kembalikan URL ke klien untuk redirect.
    await db.from('payments').update({ doku_checkout_url: checkoutUrl, doku_token_id: tokenId })
      .eq('invoice_number', invoice)

    return json(200, { checkout_url: checkoutUrl, invoice_number: invoice })
  } catch (e) {
    return json(500, { error: (e as Error)?.message || 'Kesalahan server.' })
  }
})
