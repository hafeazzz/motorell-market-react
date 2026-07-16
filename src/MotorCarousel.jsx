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
const DRAG_PER_FRAME = 100   // 100px seret = maju 1 frame
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
function Lightbox({ photos, i, n, title, angle, spinnable, onGo, onClose }) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const imgRef = useRef(null)
  const drag = useRef(null)
  const zoomed = zoom > 1.001

  // ganti frame → reset perbesaran
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [i])

  // keyboard: Esc tutup, ←/→ putar
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') onGo(1)
      else if (e.key === 'ArrowLeft') onGo(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onGo])

  // roda mouse = perbesar. Di sini aman: lightbox overlay penuh, tidak ada
  // konten halaman yang perlu di-scroll di baliknya.
  useEffect(() => {
    const el = imgRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      setZoom((z) => {
        const next = clamp(z - e.deltaY * ZOOM_STEP, ZOOM_MIN, ZOOM_MAX)
        if (next <= ZOOM_MIN + 0.001) setPan({ x: 0, y: 0 })
        return next
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = (e) => {
    if (!zoomed) return
    drag.current = { x: e.clientX, y: e.clientY, startPan: pan }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    const lim = 220 * (zoom - 1)
    setPan({
      x: clamp(d.startPan.x + (e.clientX - d.x), -lim, lim),
      y: clamp(d.startPan.y + (e.clientY - d.y), -lim, lim),
    })
  }
  const onPointerUp = () => { drag.current = null }

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
        onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onDoubleClick={() => { setZoom((z) => (z > 1.001 ? 1 : 2)); setPan({ x: 0, y: 0 }) }} />
      {spinnable && (
        <>
          <button type="button" className="g-arrow prev" onClick={() => onGo(-1)}
            aria-label="Sudut sebelumnya">←</button>
          <button type="button" className="g-arrow next" onClick={() => onGo(1)}
            aria-label="Sudut berikutnya">→</button>
          <span className="g-count">{i + 1} / {n}</span>
        </>
      )}
      <span className="lb-hint">Gulir untuk perbesar · seret saat diperbesar · dobel-klik reset</span>
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

  const drag = useRef(null)      // state gesture aktif
  const momentum = useRef(0)     // id rAF untuk inersia
  const moved = useRef(false)    // bedakan klik dari seret

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

  // ---- inersia: lepas seret dengan cepat → putaran lanjut lalu melambat ----
  const glide = useCallback((framesLeft, dir) => {
    cancelAnimationFrame(momentum.current)
    let left = Math.abs(framesLeft)
    if (!left) return
    let last = performance.now()
    let wait = 70 // jeda antar frame, melar tiap langkah → terasa melambat
    const tick = (now) => {
      if (now - last >= wait) {
        setI((p) => mod(p + dir, n))
        last = now
        wait *= 1.35
        left--
      }
      if (left > 0) momentum.current = requestAnimationFrame(tick)
    }
    momentum.current = requestAnimationFrame(tick)
  }, [n])

  useEffect(() => () => cancelAnimationFrame(momentum.current), [])

  // ---- gesture pointer: seret HORIZONTAL memutar. Zoom tidak lagi di sini —
  // gulir vertikal dibiarkan menjadi scroll halaman biasa (touch-action:pan-y
  // di CSS), jadi carousel tidak lagi "menyandera" scroll. ----
  const onPointerDown = (e) => {
    if (!n) return
    if (e.target.closest('button')) return // biarkan panah/dot menerima klik
    cancelAnimationFrame(momentum.current)
    stopAuto()
    moved.current = false
    drag.current = {
      x: e.clientX, y: e.clientY,
      startI: i, lastX: e.clientX, lastT: performance.now(), vx: 0,
    }
  }

  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved.current = true

    const now = performance.now()
    const dt = now - d.lastT
    if (dt > 0) d.vx = (e.clientX - d.lastX) / dt // px/ms
    d.lastX = e.clientX
    d.lastT = now

    if (!spinnable) return
    // seret ke kiri = motor berputar maju, seperti memutar turntable
    const frames = Math.round(-dx / DRAG_PER_FRAME)
    setI(mod(d.startI + frames, n))
  }

  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    if (!d || !spinnable) return
    const extra = clamp(Math.round(Math.abs(d.vx) * 2.2), 0, n)
    if (extra >= 1) glide(extra, d.vx < 0 ? 1 : -1)
  }

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
        aria-label={'Galeri 360° ' + title + '. Panah kiri-kanan memutar, klik untuk memperbesar.'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onClick={() => { if (!moved.current) setLightbox(true) }}>

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
            ? (auto ? 'Berputar otomatis · seret untuk ambil alih · klik untuk perbesar'
                    : 'Seret untuk memutar · klik untuk perbesar')
            : 'Klik untuk perbesar'}
        </span>
      </div>

      {/* strip thumbnail tetap ada: lompat langsung ke sudut tertentu */}
      {spinnable && (
        <div className="thumbs">
          {photos.map((url, k) => (
            <button key={url} type="button" className={k === i ? 'on' : ''}
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
