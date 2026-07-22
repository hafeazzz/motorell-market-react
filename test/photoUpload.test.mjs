// Uji upload foto Supabase dengan MOCK Supabase client — tanpa jaringan/DOM.
// Jalankan: node test/photoUpload.test.mjs
import { uploadPhoto, validatePhoto, sanitizePhotoName, buildPhotoPath, classifyUploadError, PHOTO_MAX_MB }
  from '../src/photoUpload.js'

let pass = 0, fail = 0
const ok = (label, cond) => { if (cond) { pass++; console.log('  ok   ' + label) } else { fail++; console.log('  FAIL ' + label) } }
const throws = async (label, fn, code) => {
  try { await fn(); fail++; console.log('  FAIL ' + label + ' (tidak melempar)') }
  catch (e) { const good = !code || e.code === code; if (good) { pass++; console.log('  ok   ' + label + ' → ' + e.code) } else { fail++; console.log('  FAIL ' + label + ' (code ' + e.code + ' ≠ ' + code + ')') } }
}

// Mock Supabase client: merekam call, bisa disetel mengembalikan error/URL.
function mockClient({ uploadError = null, publicUrl = 'x' } = {}) {
  const calls = []
  return {
    calls,
    storage: {
      from(bucket) {
        return {
          upload(path, blob, opts) { calls.push({ op: 'upload', bucket, path, opts, blobType: blob && blob.type }); return Promise.resolve({ data: uploadError ? null : { path }, error: uploadError }) },
          getPublicUrl(path) { return { data: publicUrl ? { publicUrl: 'https://cdn.example/' + bucket + '/' + path } : {} } },
        }
      },
    },
  }
}
const file = (over = {}) => ({ type: 'image/jpeg', size: 2 * 1024 * 1024, name: 'My Photo (1).JPG', ...over })
const compress = async () => ({ type: 'image/jpeg', size: 300 * 1024 })

console.log('--- sanitize & path ---')
ok('buang spasi/kurung/case', sanitizePhotoName('My Photo (1).JPG') === 'my-photo-1')
ok('nama kosong → foto', sanitizePhotoName('') === 'foto')
ok('buang path traversal', !sanitizePhotoName('../../etc/passwd').includes('/'))
ok('path {dir}/{uuid}-{name}.jpg', /^user-123\/[a-z0-9-]+-front-view\.jpg$/.test(buildPhotoPath('user-123', 'Front View.png')))
ok('uuid unik tiap panggil', buildPhotoPath('d', 'a.jpg') !== buildPhotoPath('d', 'a.jpg'))
ok('dir leading slash dibersihkan', buildPhotoPath('/user/', 'a.jpg').startsWith('user/'))

console.log('\n--- validasi ---')
await throws('tipe gif ditolak', async () => validatePhoto(file({ type: 'image/gif' })), 'invalid_type')
await throws('tanpa file ditolak', async () => validatePhoto(null), 'invalid_type')
await throws('>5MB ditolak', async () => validatePhoto(file({ size: 6 * 1024 * 1024 })), 'file_too_large')
ok('5MB pas diterima', (() => { try { validatePhoto(file({ size: PHOTO_MAX_MB * 1024 * 1024 })); return true } catch { return false } })())

console.log('\n--- klasifikasi error ---')
ok('bucket_not_found', classifyUploadError({ message: 'Bucket not found' }, 'titip-jual-photos').code === 'bucket_not_found')
ok('bucket_not_found sebut migrasi', classifyUploadError({ message: 'Bucket not found' }, 'titip-jual-photos').message.includes('0003'))
ok('auth (jwt)', classifyUploadError({ message: 'invalid JWT' }, 'unit-photos').code === 'auth_error')
ok('auth (row-level)', classifyUploadError({ message: 'violates row-level security policy' }, 'unit-photos').code === 'auth_error')
ok('network', classifyUploadError({ message: 'Failed to fetch' }, 'unit-photos').code === 'network_error')
ok('storage_error fallback', classifyUploadError({ message: 'weird 500' }, 'unit-photos').code === 'storage_error')

console.log('\n--- uploadPhoto (mock client) ---')
{
  const c = mockClient()
  const res = await uploadPhoto(file(), { client: c, bucket: 'unit-photos', dir: 'yamaha-xsr-2023', compress })
  ok('return URL publik', res.url.startsWith('https://cdn.example/unit-photos/yamaha-xsr-2023/'))
  ok('path uuid+nama.jpg', /yamaha-xsr-2023\/[a-z0-9-]+-my-photo-1\.jpg$/.test(res.path))
  ok('contentType jpeg', c.calls.find((x) => x.op === 'upload').opts.contentType === 'image/jpeg')
}
await throws('client hilang', async () => uploadPhoto(file(), { bucket: 'b' }), 'no_client')
await throws('bucket hilang', async () => uploadPhoto(file(), { client: mockClient() }), 'no_bucket')
await throws('tipe salah', async () => uploadPhoto(file({ type: 'image/gif' }), { client: mockClient(), bucket: 'b', dir: 'd' }), 'invalid_type')
await throws('>5MB', async () => uploadPhoto(file({ size: 9e6 }), { client: mockClient(), bucket: 'b', dir: 'd' }), 'file_too_large')
await throws('bucket_not_found dari server', async () => uploadPhoto(file(), { client: mockClient({ uploadError: { message: 'Bucket not found' } }), bucket: 'titip-jual-photos', dir: 'u1', compress }), 'bucket_not_found')
await throws('auth error dari server', async () => uploadPhoto(file(), { client: mockClient({ uploadError: { message: 'invalid JWT' } }), bucket: 'unit-photos', dir: 'u1', compress }), 'auth_error')
await throws('URL publik kosong', async () => uploadPhoto(file(), { client: mockClient({ publicUrl: '' }), bucket: 'b', dir: 'd', compress }), 'no_url')

console.log('\n' + pass + ' pass, ' + fail + ' fail')
process.exit(fail ? 1 : 0)
