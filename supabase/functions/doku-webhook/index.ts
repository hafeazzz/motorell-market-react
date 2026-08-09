// ============================================================
// Edge Function: doku-webhook
// Menerima notifikasi pembayaran dari Doku dan meng-update status payments.
// WAJIB memverifikasi tanda tangan Doku dulu — tanpa itu siapa pun bisa memalsukan
// "SUCCESS". Hanya notifikasi ber-tanda-tangan sah yang diproses.
//
// Deploy TANPA verifikasi JWT (Doku tak mengirim JWT Supabase):
//   supabase functions deploy doku-webhook --no-verify-jwt
// Lalu daftarkan URL fungsi ini sebagai Notification URL di dashboard Doku.
// Secret dibaca dari env server (sama dengan create-doku-payment).
//
// DOKU_WEBHOOK_PATH: Request-Target yang dipakai Doku saat menandatangani (path
// notification URL persis seperti didaftarkan). Default '/functions/v1/doku-webhook'.
// Sesuaikan bila URL yang kamu daftarkan berbeda.
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  try {
    const clientId = Deno.env.get('DOKU_CLIENT_ID')
    const secret = Deno.env.get('DOKU_SECRET_KEY')
    if (!clientId || !secret) return new Response('Server config missing', { status: 500 })
    const targetPath = Deno.env.get('DOKU_WEBHOOK_PATH') || '/functions/v1/doku-webhook'

    const raw = await req.text()                       // butuh body MENTAH untuk digest
    const reqId = req.headers.get('Request-Id') || ''
    const reqTs = req.headers.get('Request-Timestamp') || ''
    const sigHeader = req.headers.get('Signature') || ''

    // Verifikasi tanda tangan (non-SNAP): recompute & bandingkan.
    const digest = await sha256B64(raw)
    const canonical = [
      `Client-Id:${clientId}`,
      `Request-Id:${reqId}`,
      `Request-Timestamp:${reqTs}`,
      `Request-Target:${targetPath}`,
      `Digest:${digest}`,
    ].join('\n')
    const expected = 'HMACSHA256=' + await hmac256B64(secret, canonical)
    if (sigHeader !== expected) {
      console.warn('[doku-webhook] Signature mismatch — notifikasi ditolak.')
      return new Response('Invalid signature', { status: 401 })
    }

    const body = JSON.parse(raw || '{}')
    // Nama field bisa berbeda antar produk Doku — verifikasi dengan payload nyata.
    const invoice = body?.order?.invoice_number || body?.transaction?.original_request_id
    const dokuStatus = (body?.transaction?.status || body?.order?.status || '').toString().toUpperCase()
    if (!invoice) return new Response('No invoice', { status: 200 })  // 200 → Doku berhenti retry

    const status = dokuStatus === 'SUCCESS' ? 'success'
      : dokuStatus === 'FAILED' || dokuStatus === 'EXPIRED' ? 'failed'
      : 'pending'

    const supaUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const db = createClient(supaUrl, serviceKey, { auth: { persistSession: false } })
    await db.from('payments').update({
      status,
      paid_at: status === 'success' ? new Date().toISOString() : null,
      raw_notification: body,
    }).eq('invoice_number', invoice)

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    console.error('[doku-webhook]', (e as Error)?.message)
    return new Response('Error', { status: 500 })
  }
})
