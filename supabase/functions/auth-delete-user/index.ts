// ============================================================
// Edge Function: auth-delete-user
// HARD DELETE sebuah akun dari auth.users (cascade menghapus baris profiles &
// data ber-FK lain). Hanya bisa dipanggil admin/owner. Semua penjaga ditegakkan
// DI SINI (server), bukan sekadar di UI — klien tak bisa dipercaya.
//
// Deploy:  supabase functions deploy auth-delete-user
// Env yang dipakai (otomatis tersedia di runtime Edge Functions):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Dipanggil dari app lewat supabase.functions.invoke('auth-delete-user', {body}).
// (JANGAN set verify_jwt=false — kita butuh JWT pemanggil untuk cek perannya;
//  fungsi ini juga memvalidasi ulang token via getUser.)
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const GRACE_DAYS = 30

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' })

  try {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!jwt) return json(401, { error: 'Tidak terautentikasi.' })

    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

    // 1) Siapa pemanggilnya? (verifikasi token) + perannya.
    const { data: { user }, error: uErr } = await admin.auth.getUser(jwt)
    if (uErr || !user) return json(401, { error: 'Sesi tidak valid.' })
    const { data: caller } = await admin.from('profiles').select('role, email').eq('id', user.id).single()
    if (!caller || !['admin', 'owner'].includes(caller.role)) return json(403, { error: 'Butuh akses admin/owner.' })
    const callerIsOwner = caller.role === 'owner'

    // 2) Validasi input.
    const body = await req.json().catch(() => ({}))
    const targetId: string | undefined = body?.user_id
    const reason = (body?.reason ?? '').toString().trim()
    if (!targetId) return json(400, { error: 'user_id wajib diisi.' })
    if (targetId === user.id) return json(400, { error: 'Tidak bisa menghapus akun sendiri.' })
    if (!reason) return json(400, { error: 'Alasan penghapusan wajib diisi (untuk audit).' })

    // 3) Penjaga pada target.
    const { data: target } = await admin.from('profiles').select('role, email, deleted_at').eq('id', targetId).single()
    if (!target) return json(404, { error: 'Pengguna tidak ditemukan.' })
    if (target.role === 'owner') return json(403, { error: 'Owner tidak bisa dihapus.' })
    if (!target.deleted_at) return json(400, { error: 'Akun harus di-soft-delete (Hapus) dulu sebelum dihapus permanen.' })

    // Admin non-owner: hanya boleh menghapus BARIS PENGGUNA (bukan staf) —
    // konsisten dengan RLS 0010. Owner boleh siapa pun (kecuali owner lain).
    if (!callerIsOwner && ['admin', 'kurator'].includes(target.role)) {
      return json(403, { error: 'Hanya owner yang boleh menghapus akun staf.' })
    }

    // Masa tenggang 30 hari — owner bisa memaksa lebih awal.
    const days = (Date.now() - new Date(target.deleted_at).getTime()) / 86_400_000
    if (days < GRACE_DAYS && !callerIsOwner) {
      return json(403, { error: `Masa tenggang ${GRACE_DAYS} hari belum lewat (${Math.floor(days)}/${GRACE_DAYS}). Hanya owner yang bisa memaksa.` })
    }

    // 4) Tulis audit DULU (sebelum baris profiles lenyap oleh cascade).
    await admin.from('audit_log').insert({
      admin_id: user.id, admin_email: caller.email, action: 'hard_delete',
      target_user_id: targetId, target_email: target.email, reason,
    })

    // 5) Hapus dari auth.users → cascade menghapus profiles & data ber-FK.
    const { error: delErr } = await admin.auth.admin.deleteUser(targetId)
    if (delErr) return json(500, { error: 'Gagal menghapus auth user: ' + delErr.message })

    return json(200, { ok: true, email: target.email })
  } catch (e) {
    return json(500, { error: (e as Error)?.message || 'Kesalahan server.' })
  }
})
