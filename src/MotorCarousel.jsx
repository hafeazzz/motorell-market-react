import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Blueprint from './Blueprint'

// ============================================================
// MotorCarousel — putar unit 360°, dan lihat part modifikasi terpasang.
// Perbesar foto lewat KLIK (buka lightbox), bukan lewat gulir.
//
// Sumber gambarnya adalah FOTO ASLI unit (listing.photos), bukan render stok:
// tiap foto diperlakukan sebagai satu "frame" sudut pandang. Delapan foto
// keliling motor = putaran 360° penuh (tiap frame 45°); dua foto tetap bisa
// diputar, hanya kasar. Jumlah frame tidak dipatok 8 — sudutnya dihitung dari
// jumlah foto yang benar-benar ada.
//
// CATATAN perilaku zoom: dulu roda mouse di atas carousel inline langsung
// men-zoom dan menahan scroll halaman — mengganggu saat orang cuma mau
// menggulung ke bawah. Sekarang gulir di atas carousel = scroll halaman
// biasa; perbesar dilakukan setelah klik foto, di dalam lightbox.
//
// Kalau unit belum punya foto, komponen ini tidak menampilkan layar kosong:
// ia jatuh ke blueprint + keterangan bahwa fotonya belum ada.
// ============================================================

// 4 detik per frame: cukup lama untuk benar-benar MENGAMATI tiap sudut.
// Konsekuensi yang disengaja: dengan 8 foto, satu putaran 360° penuh kini makan
// ~32 detik (dulu 6,4 detik), jadi ini terbaca sebagai "pergantian sudut" yang
// tenang, bukan lagi turntable yang berputar. Itulah yang diminta — dulu terlalu
// cepat untuk sempat melihat detail motornya.
// Catatan: auto-rotate memang hanya hidup di desktop — di perangkat sentuh dan
// prefers-reduced-motion ia tidak pernah menyala (lihat coarse()/reduced()).
const AUTO_MS = 4000
const ZOOM_MIN = 1
const ZOOM_MAX = 2.5
const ZOOM_STEP = 0.0022     // per unit deltaY roda mouse (di lightbox)

const reduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Perangkat sentuh: auto-rotate dimatikan (hemat baterai, dan di HP orang
// cenderung langsung menggeser sendiri).
const coarse = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(pointer: coarse)').matches

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const mod = (v, n) => ((v % n) + n) % n

// ---------- Lightbox: perbesar & geser, dibuka HANYA lewat klik foto ----------
// Gesture pointer NATIVE (tanpa library): 1 jari geser = swipe ganti foto (saat
// belum di-zoom) / seret pan (saat di-zoom); 2 jari = pinch zoom; dobel-ketuk =
// toggle zoom; roda mouse / Ctrl+scroll = zoom (desktop). Swipe hanya di lightbox
// (overlay penuh) — aman dari scroll halaman & tak bentrok dengan pinch, itulah
// sebabnya carousel inline sengaja tanpa swipe (lihat catatan di MotorCarousel).
const SWIPE_MIN = 55        // jarak min (px) agar dianggap swipe ganti foto
const TAP_SLOP = 8          // gerak < ini = ketukan (bukan seret)

function Lightbox({ photos, i, n, title, angle, spinnable, onGo, onClose }) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const imgRef = useRef(null)
  // Ref cermin state supaya handler pointer selalu baca nilai TERKINI (bukan nilai
  // tertangkap saat render) selama satu gesture berlangsung.
  const zoomRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })
  const pointers = useRef(new Map())   // pointerId → {x,y} yang sedang aktif
  const gesture = useRef(null)         // { mode, ... } gesture berjalan
  const lastTap = useRef(0)
  const zoomed = zoom > 1.001

  const setZ = (z) => { zoomRef.current = z; setZoom(z) }
  const setP = (p) => { panRef.current = p; setPan(p) }
  const clampPan = (p, z) => { const lim = 220 * (z - 1); return { x: clamp(p.x, -lim, lim), y: clamp(p.y, -lim, lim) } }

  // ganti frame → reset perbesaran & gesture
  useEffect(() => { setZ(1); setP({ x: 0, y: 0 }); pointers.current.clear(); gesture.current = null }, [i])

  // keyboard: Esc tutup, ←/→ ganti foto
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') onGo(1)
      else if (e.key === 'ArrowLeft') onGo(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onGo])

  // roda mouse / Ctrl+scroll = perbesar. Aman: overlay penuh, tak ada konten di
  // baliknya yang perlu di-scroll.
  useEffect(() => {
    const el = imgRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      const next = clamp(zoomRef.current - e.deltaY * ZOOM_STEP, ZOOM_MIN, ZOOM_MAX)
      setZ(next)
      setP(next <= ZOOM_MIN + 0.001 ? { x: 0, y: 0 } : clampPan(panRef.current, next))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const twoDist = () => {
    const p = [...pointers.current.values()]
    return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)
  }

  const onPointerDown = (e) => {
    // setPointerCapture bisa melempar (mis. pointer sudah tak aktif) — jangan
    // biarkan itu membatalkan sisa logika gesture.
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* abaikan */ }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      gesture.current = { mode: 'pinch', startDist: twoDist() || 1, startZoom: zoomRef.current }
    } else {
      // 1 jari: pan bila sudah di-zoom, selain itu kandidat swipe/ketuk.
      gesture.current = { mode: zoomRef.current > 1.001 ? 'pan' : 'swipe',
        startX: e.clientX, startY: e.clientY, startPan: panRef.current }
    }
  }

  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (!g) return
    if (g.mode === 'pinch' && pointers.current.size >= 2) {
      const z = clamp(g.startZoom * (twoDist() / g.startDist), ZOOM_MIN, ZOOM_MAX)
      setZ(z); setP(clampPan(panRef.current, z))
    } else if (g.mode === 'pan') {
      const lim = 220 * (zoomRef.current - 1)
      setP({ x: clamp(g.startPan.x + (e.clientX - g.startX), -lim, lim),
        y: clamp(g.startPan.y + (e.clientY - g.startY), -lim, lim) })
    }
    // mode 'swipe': cukup dinilai saat pointer-up (dx/dy dari start).
  }

  const onPointerUp = (e) => {
    const g = gesture.current
    pointers.current.delete(e.pointerId)
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* abaikan */ }
    if (g && (g.mode === 'swipe' || g.mode === 'pan')) {
      const dx = e.clientX - g.startX, dy = e.clientY - g.startY
      const moved = Math.abs(dx) > TAP_SLOP || Math.abs(dy) > TAP_SLOP
      if (!moved) {
        // ketukan: dua ketukan cepat = toggle zoom (dobel-tap)
        const now = Date.now()
        if (now - lastTap.current < 300) {
          const nz = zoomRef.current > 1.001 ? 1 : 2
          setZ(nz); setP({ x: 0, y: 0 }); lastTap.current = 0
        } else { lastTap.current = now }
      } else if (g.mode === 'swipe' && spinnable &&
        Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.4) {
        onGo(dx < 0 ? 1 : -1)   // swipe kiri → foto berikutnya
      }
    } else if (g && g.mode === 'pinch' && zoomRef.current <= ZOOM_MIN + 0.02) {
      setZ(1); setP({ x: 0, y: 0 })
    }
    // Sisa jari (mis. angkat 1 dari 2): siapkan ulang mode-nya.
    if (pointers.current.size === 1) {
      const pt = [...pointers.current.values()][0]
      gesture.current = zoomRef.current > 1.001
        ? { mode: 'pan', startX: pt.x, startY: pt.y, startPan: panRef.current }
        : { mode: null, startX: pt.x, startY: pt.y }
    } else if (pointers.current.size === 0) {
      gesture.current = null
    }
  }

  const onPointerCancel = (e) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 0) gesture.current = null
  }

  return (
    <motion.div className="lightbox" role="dialog" aria-modal="true" aria-label={'Foto ' + title}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <motion.img ref={imgRef} src={photos[i]} alt={title + ' — sudut ' + angle + '°'}
        draggable={false}
        className={zoomed ? 'lb-zoomed' : ''}
        animate={{ scale: zoom, x: pan.x, y: pan.y }}
        transition={{ type: 'spring', stiffness: 260, damping: 30 }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} />
      {zoomed && <span className="lb-zoom" aria-hidden="true">{Math.round(zoom * 100)}%</span>}
      {spinnable && (
        <>
          <button type="button" className="g-arrow prev" onClick={() => onGo(-1)}
            aria-label="Foto sebelumnya">←</button>
          <button type="button" className="g-arrow next" onClick={() => onGo(1)}
            aria-label="Foto berikutnya">→</button>
          <span className="g-count">{i + 1} / {n}</span>
        </>
      )}
      <span className="lb-hint">
        {spinnable ? 'Geser untuk ganti foto · ' : ''}Cubit / gulir untuk perbesar · dobel-ketuk reset
      </span>
      <button type="button" className="lb-close" onClick={onClose} aria-label="Tutup">✕</button>
    </motion.div>
  )
}

function MotorCarousel({ photos = [], title = '', selectedModParts = [] }) {
  const n = photos.length
  const spinnable = n >= 2

  const [i, setI] = useState(0)
  const [auto, setAuto] = useState(false)
  const [loaded, setLoaded] = useState(0)
  const [lightbox, setLightbox] = useState(false)

  // ---- preload: semua frame dimuat di depan, supaya memutar tidak nge-lag
  // menunggu gambar berikutnya ter-fetch di tengah gesture ----
  useEffect(() => {
    setLoaded(0)
    setI(0)
    if (!n) return
    let alive = true
    let done = 0
    const bump = () => { done++; if (alive) setLoaded(done) }
    const imgs = photos.map((src) => {
      const im = new Image()
      im.onload = bump
      im.onerror = bump // gambar rusak tidak boleh menggantung skeleton selamanya
      im.src = src
      return im
    })
    return () => {
      alive = false
      imgs.forEach((im) => { im.onload = null; im.onerror = null })
    }
  }, [photos, n])

  const allReady = n > 0 && loaded >= n

  // ---- auto-rotate: jalan sendiri sekali foto siap, berhenti begitu user
  // menyentuh apa pun (dia sudah pegang kendali — jangan direbut) ----
  useEffect(() => {
    if (!spinnable || !allReady) return
    if (reduced() || coarse()) return
    setAuto(true)
  }, [spinnable, allReady])

  useEffect(() => {
    if (!auto || !spinnable || lightbox) return
    const t = setInterval(() => setI((p) => mod(p + 1, n)), AUTO_MS)
    return () => clearInterval(t)
  }, [auto, spinnable, n, lightbox])

  const stopAuto = useCallback(() => setAuto(false), [])

  const go = useCallback((delta) => {
    stopAuto()
    setI((p) => mod(p + delta, n || 1))
  }, [n, stopAuto])

  // ---- Navigasi HANYA lewat tombol: panah, dot, thumbnail, keyboard ----
  // Seret/geser jari SENGAJA DIHAPUS. Dulu gesture pointer horizontal memutar
  // foto; di layar sentuh, jari yang dipakai untuk pinch-to-zoom ikut terbaca
  // sebagai seret dan foto tergeser tanpa sengaja. Sekarang di atas foto tidak
  // ada penangkap gesture sama sekali — pinch-zoom native browser bebas jalan
  // (lihat touch-action:pinch-zoom di CSS), dan foto hanya berpindah lewat
  // kontrol eksplisit. Perbesar tetap lewat ketuk → lightbox.

  // ---- keyboard: ←/→ putar, spasi setel auto-rotate, Enter buka lightbox ----
  const onKeyDown = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
    else if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault()
      if (spinnable) setAuto((a) => !a)
    } else if (e.key === 'Enter') setLightbox(true)
  }

  // Sudut pandang dihitung dari jumlah foto — 8 foto → 0/45/90…, 4 foto → 0/90/…
  // Penunjuk derajat yang dulu tampil di pojok kiri atas foto sudah dihapus
  // (mengganggu visual). Nilainya tetap dipakai untuk teks alt gambar, jadi
  // pembaca layar masih tahu ini sudut pandang ke berapa — tak terlihat mata.
  const angle = spinnable ? Math.round((i * 360) / n) : 0

  // ---------- unit tanpa foto: jangan tampilkan kotak kosong ----------
  if (!n) {
    return (
      <div className="gallery-main mc" role="img" aria-label={'Belum ada foto ' + title}>
        <Blueprint />
        <p className="mc-nophoto">Foto unit belum tersedia</p>
      </div>
    )
  }

  return (
    <>
      <div
        className="gallery-main mc has-photo"
        role="group"
        tabIndex={0}
        aria-label={'Galeri ' + title + '. Panah kiri-kanan ganti foto, klik untuk memperbesar.'}
        onKeyDown={onKeyDown}
        onClick={() => setLightbox(true)}>

        <div className="mc-stage">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.img key={i} src={photos[i]} draggable={false}
              alt={title + ' — sudut ' + angle + '°'}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="mc-img" />
          </AnimatePresence>

          {/* Part terpilih muncul dengan crossfade — bukan lompat tiba-tiba */}
          <AnimatePresence>
            {selectedModParts.map((part) => (
              <motion.img key={part.id} src={part.image_url} alt={part.name}
                className="mc-part" draggable={false}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                style={{ left: part.x_pos + 'px', top: part.y_pos + 'px' }} />
            ))}
          </AnimatePresence>
        </div>

        {!allReady && <div className="mc-skeleton" aria-hidden="true" />}

        {spinnable && (
          <>
            <button type="button" className="g-arrow prev" aria-label="Sudut sebelumnya"
              onClick={(e) => { e.stopPropagation(); go(-1) }}>←</button>
            <button type="button" className="g-arrow next" aria-label="Sudut berikutnya"
              onClick={(e) => { e.stopPropagation(); go(1) }}>→</button>

            <div className="mc-dots" role="tablist" aria-label="Sudut pandang">
              {photos.map((_, k) => (
                <button key={k} type="button" role="tab" aria-selected={k === i}
                  aria-label={'Sudut ' + Math.round((k * 360) / n) + '°'}
                  className={k === i ? 'on' : ''}
                  onClick={(e) => { e.stopPropagation(); stopAuto(); setI(k) }} />
              ))}
            </div>
          </>
        )}

        <span className="mc-hint">
          {spinnable
            ? (auto ? 'Berputar otomatis · panah/thumbnail untuk pilih · klik untuk perbesar'
                    : 'Panah atau thumbnail untuk ganti foto · klik untuk perbesar')
            : 'Klik untuk perbesar'}
        </span>
      </div>

      {/* strip thumbnail tetap ada: lompat langsung ke sudut tertentu */}
      {spinnable && (
        <div className="thumbs">
          {photos.map((url, k) => (
            <button key={url + '-' + k} type="button" className={k === i ? 'on' : ''}
              onClick={() => { stopAuto(); setI(k) }} aria-label={'Foto ' + (k + 1)}>
              <img src={url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      <AnimatePresence>
        {lightbox && (
          <Lightbox photos={photos} i={i} n={n} title={title} angle={angle}
            spinnable={spinnable} onGo={go} onClose={() => setLightbox(false)} />
        )}
      </AnimatePresence>
    </>
  )
}

// Memo: DetailView re-render tiap kali paket garansi diganti — carousel tidak
// perlu ikut menghitung ulang kalau foto & part-nya sama.
export default memo(MotorCarousel)
