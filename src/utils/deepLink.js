// ============================================================
// Deep link ke aplikasi sosial (Instagram / TikTok) dengan fallback ke web.
//
// Tujuan: kalau app-nya terpasang → buka app; kalau tidak → buka profil web.
//
// Pendekatan "klasik" (window.location = scheme; lalu setTimeout window.open
// ke web) punya tiga bug nyata yang sengaja dihindari di sini:
//
//   1. window.open() di dalam setTimeout berjalan DI LUAR gesture ketukan user,
//      jadi diblokir popup-blocker (terutama Safari iOS). → fallback kita pakai
//      window.location (navigasi tab yang sama), bukan window.open.
//
//   2. Kalau app BERHASIL terbuka, timeout tetap menyala saat user kembali ke
//      browser → muncul tab web nyasar. → kita batalkan fallback lewat
//      visibilitychange/pagehide begitu halaman ke background.
//
//   3. Di iOS, window.location = 'instagram://…' saat app TIDAK terpasang
//      memunculkan alert "Cannot Open Page". → di iOS kita pakai Universal Link
//      (URL https-nya): iOS membuka app bila terpasang, Safari bila tidak,
//      tanpa error dan tanpa perlu timeout sama sekali.
//
// Di Android, custom scheme diprobe lewat hidden iframe (diam kalau app tak
// ada, alih-alih menavigasi seluruh halaman ke halaman error), lalu fallback
// ke Universal/App Link https bila app tak muncul ke depan.
// ============================================================

const SOCIAL = {
  instagram: {
    // Skema Instagram untuk buka profil langsung (dipakai sebagai akselerator
    // di Android; iOS memakai Universal Link https di bawah).
    scheme: 'instagram://user?username=motorell.garage',
    web: 'https://www.instagram.com/motorell.garage',
  },
  tiktok: {
    // TikTok punya App Link https yang terverifikasi dan membuka app langsung
    // ke profil — jauh lebih andal daripada skema custom-nya (yang butuh user
    // id numerik, bukan username). Jadi scheme sengaja null: Android pun pakai
    // https-nya.
    scheme: null,
    web: 'https://www.tiktok.com/@motorellgarage',
  },
}

const FALLBACK_MS = 1200

const ua = () => (typeof navigator !== 'undefined' ? navigator.userAgent : '')
const isIOS = () => /iPhone|iPad|iPod/i.test(ua())
const isAndroid = () => /Android/i.test(ua())

export function openSocialApp(platform) {
  const s = SOCIAL[platform]
  if (!s || typeof window === 'undefined') return

  // Desktop: tidak ada app — langsung profil web di tab baru (masih dalam
  // gesture klik, jadi window.open aman dari popup-blocker).
  if (!isIOS() && !isAndroid()) {
    window.open(s.web, '_blank', 'noopener,noreferrer')
    return
  }

  // iOS: Universal Link. Membuka app bila terpasang, Safari bila tidak — tanpa
  // alert error, tanpa timeout. Skema custom sengaja tidak dipakai di sini.
  if (isIOS()) {
    window.location.href = s.web
    return
  }

  // Android tanpa skema andal (TikTok): App Link https membuka app bila
  // terpasang, Chrome bila tidak.
  if (!s.scheme) {
    window.location.href = s.web
    return
  }

  // Android dengan skema (Instagram): probe skema lewat iframe tersembunyi,
  // fallback ke web di tab yang sama bila app tak muncul ke depan. Listener
  // visibilitychange/pagehide membatalkan fallback saat app benar-benar
  // membuka, supaya tidak ada tab web nyasar.
  let settled = false
  const iframe = document.createElement('iframe')

  const cleanup = () => {
    settled = true
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onHide)
    window.removeEventListener('pagehide', cleanup)
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
  }
  const onHide = () => { if (document.hidden) cleanup() }

  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', cleanup)

  const timer = setTimeout(() => {
    if (settled) return
    cleanup()
    window.location.href = s.web
  }, FALLBACK_MS)

  iframe.style.display = 'none'
  iframe.src = s.scheme
  document.body.appendChild(iframe)
}
