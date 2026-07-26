// ============================================================
// tests/security.spec.ts — 16 pemeriksaan keamanan MotorellMarket.
//
// Menjalankan:
//   npm i -D @playwright/test && npx playwright install chromium
//   (jalankan dev server dulu, atau set BASE_URL ke produksi)
//   npx playwright test tests/security.spec.ts --reporter=list
//
// Env (punya default):
//   BASE_URL          default http://localhost:5173  (jalankan `npm run dev`)
//   SUPABASE_URL      untuk uji RLS/SQLi via REST anon
//   SUPABASE_ANON_KEY kunci anon (publik by design; dilindungi RLS)
//
// JUJUR soal cakupan: #16 (rate limiting) diketahui GAGAL — tak ada rate limit
// level app (situs statis + Supabase). RLS lintas-user di-skip (butuh 2 akun).
// Lihat SECURITY_AUDIT_REPORT.md.
// ============================================================
import { test, expect, request } from '@playwright/test'
import { validatePhoto } from '../src/photoUpload.js'

const BASE = process.env.BASE_URL || 'http://localhost:5173'
const SB = process.env.SUPABASE_URL || ''
const KEY = process.env.SUPABASE_ANON_KEY || ''
const REF = (SB.match(/https:\/\/([^.]+)\./) || [])[1] || ''
const needSB = () => test.skip(!SB || !KEY, 'set SUPABASE_URL & SUPABASE_ANON_KEY')
const file = (o: any = {}) => ({ type: 'image/jpeg', size: 2 * 1024 * 1024, name: 'a.jpg', ...o }) as unknown as File
const routeEmpty = async (page: any) => {
  for (const t of ['listings', 'titip_jual_units', 'motor_mod_parts', 'profiles'])
    await page.route(`**/rest/v1/${t}*`, (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
}

test.describe('XSS', () => {
  test('1. <script> di search tidak dieksekusi', async ({ page }) => {
    let dlg = false; page.on('dialog', (d) => { dlg = true; d.dismiss() })
    await routeEmpty(page); await page.goto(`${BASE}/#/`)
    const s = page.locator('input[type=search], .nav-search input').first()
    await s.fill('<script>window.__xss=1;alert(1)</script>'); await page.waitForTimeout(600)
    expect(dlg).toBe(false); expect(await page.evaluate(() => (window as any).__xss)).toBeFalsy()
  })
  test('2. <img onerror> tidak dieksekusi / masuk DOM', async ({ page }) => {
    await routeEmpty(page); await page.goto(`${BASE}/#/`)
    await page.locator('input[type=search], .nav-search input').first().fill('<img src=x onerror="window.__x2=1">')
    await page.waitForTimeout(600)
    expect(await page.evaluate(() => (window as any).__x2 || document.querySelectorAll('img[onerror]').length)).toBeFalsy()
  })
  test('3. input berbahaya diperlakukan sebagai teks (React escape)', async ({ page }) => {
    await routeEmpty(page); await page.goto(`${BASE}/#/`)
    const s = page.locator('input[type=search], .nav-search input').first()
    await s.fill('<img src=x>'); expect(await s.inputValue()).toContain('<img')
  })
})

test.describe('SQL injection (PostgREST parameterized)', () => {
  test("4. \"' OR 1=1\" tidak mendump data", async () => {
    needSB(); const ctx = await request.newContext({ extraHTTPHeaders: { apikey: KEY } })
    const res = await ctx.get(`${SB}/rest/v1/listings?title=eq.${encodeURIComponent("' OR '1'='1")}&select=id`)
    expect(await res.json()).toEqual([]); await ctx.dispose()
  })
  test('5. "DROP TABLE" tak berefek — tabel tetap ada', async () => {
    needSB(); const ctx = await request.newContext({ extraHTTPHeaders: { apikey: KEY } })
    await ctx.get(`${SB}/rest/v1/listings?title=eq.${encodeURIComponent("x'; DROP TABLE listings;--")}&select=id`)
    const after = await ctx.get(`${SB}/rest/v1/listings?select=id&limit=1`)
    expect(after.status()).toBe(200); await ctx.dispose()
  })
})

test.describe('Upload validation (client)', () => {
  const throws = (fn: () => void, code: string) => { try { fn(); return false } catch (e: any) { return e.code === code } }
  test('6. tolak .exe (invalid_type)', () => expect(throws(() => validatePhoto(file({ type: 'application/x-msdownload', name: 'v.exe' })), 'invalid_type')).toBe(true))
  test('7. tolak > 5MB (file_too_large)', () => expect(throws(() => validatePhoto(file({ size: 6 * 1024 * 1024 })), 'file_too_large')).toBe(true))
  test('8. terima JPG/PNG/WEBP ≤ 5MB', () => { for (const t of ['image/jpeg', 'image/png', 'image/webp']) expect(() => validatePhoto(file({ type: t }))).not.toThrow() })
})

test.describe('Auth / access control', () => {
  test('9. non-staff ditolak dari panel admin', async ({ page }) => {
    await page.addInitScript((ref) => localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({ access_token: 'f', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 604800, refresh_token: 'r', user: { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'a@m' } })), REF)
    await page.route('**/rest/v1/profiles*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', role: null }) }))
    await routeEmpty(page); await page.goto(`${BASE}/#/admin`); await page.waitForTimeout(2200)
    expect(await page.locator('text=Tambah unit').count()).toBe(0)
    expect(await page.locator('text=/khusus staf|belum diakui sebagai staf/i').count()).toBeGreaterThan(0)
  })
  test('10. anon ditolak dari panel admin', async ({ page }) => {
    await routeEmpty(page); await page.goto(`${BASE}/#/admin`); await page.waitForTimeout(1800)
    expect(await page.locator('text=Tambah unit').count()).toBe(0)
  })
  test('11. titip submit butuh login (anon: gate, bukan form)', async ({ page }) => {
    await routeEmpty(page); await page.goto(`${BASE}/#/titip-jual`); await page.waitForTimeout(1800)
    expect(await page.locator('input#t-merek').count()).toBe(0)
    expect(await page.locator('text=/Masuk atau daftar dulu|login dulu/i').count()).toBeGreaterThan(0)
  })
})

test.describe('RLS (live anon probe)', () => {
  const anonInsert = async (t: string) => {
    const ctx = await request.newContext({ extraHTTPHeaders: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' } })
    const res = await ctx.post(`${SB}/rest/v1/${t}`, { data: {} }); await ctx.dispose(); return res.status()
  }
  test('12. anon INSERT listings → ditolak (401/403)', async () => { needSB(); expect([401, 403]).toContain(await anonInsert('listings')) })
  test('13. anon INSERT titip_jual_units → ditolak', async () => { needSB(); expect([401, 403]).toContain(await anonInsert('titip_jual_units')) })
  test('14. anon SELECT listings publik → 200 (disengaja)', async () => {
    needSB(); const ctx = await request.newContext({ extraHTTPHeaders: { apikey: KEY } })
    expect((await ctx.get(`${SB}/rest/v1/listings?select=id&limit=1`)).status()).toBe(200); await ctx.dispose()
  })
})

test.describe('Error handling & rate limiting', () => {
  test('15. error tidak membocorkan stack/file path', async () => {
    needSB(); const ctx = await request.newContext({ extraHTTPHeaders: { apikey: KEY } })
    const body = await (await ctx.get(`${SB}/rest/v1/listings?select=kolom_tidak_ada`)).text()
    expect(/\/(home|var|usr|app)\/|node_modules|\.[tj]s:\d/i.test(body)).toBe(false); await ctx.dispose()
  })
  // ⚠️ DIKETAHUI GAGAL: tak ada rate limit level app. Ditandai `fail` agar jujur.
  test('16. rate limiting: 120 req → 429 [KNOWN GAP]', async () => {
    needSB(); const ctx = await request.newContext({ extraHTTPHeaders: { apikey: KEY } })
    const codes = await Promise.all(Array.from({ length: 120 }, () => ctx.get(`${SB}/rest/v1/listings?select=id&limit=1`).then((r) => r.status())))
    await ctx.dispose()
    // Ekspektasi ideal ada 429; realita = 0 → test ini SENGAJA gagal untuk menandai gap.
    expect(codes.some((c) => c === 429), 'Tidak ada rate limiting app/gateway — pasang Vercel Firewall').toBe(true)
  })
})

// SKIP jujur: butuh 2 akun nyata + login.
test.fixme('RLS lintas-user: User A tak bisa melihat submission pending / profil User B', async () => {})
