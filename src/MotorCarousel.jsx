import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Blueprint from './Blueprint'

// ============================================================
// MotorCarousel — putar unit 360°, zoom, dan lihat part modifikasi terpasang.
//
// Sumber gambarnya adalah FOTO ASLI unit (listing.photos), bukan render stok:
// tiap foto diperlakukan sebagai satu "frame" sudut pandang. Delapan foto
// keliling motor = putaran 360° penuh (tiap frame 45°); dua foto tetap bisa
// diputar, hanya kasar. Jumlah frame tidak dipatok 8 — sudutnya dihitung dari
// jumlah foto yang benar-benar ada, jadi unit dengan 5 atau 12 foto sama-sama
// benar.
//
// Kalau unit belum punya foto, komponen ini tidak menampilkan layar kosong:
// ia jatuh ke blueprint + keterangan bahwa fotonya belum ada.
// ============================================================

const AUTO_MS = 800          // 1 frame / 800ms → 8 foto = 6,4 detik per putaran
const DRAG_PER_FRAME = 100   // 100px seret = maju 1 frame
const ZOOM_MIN = 1
const ZOOM_MAX = 2.5
const ZOOM_STEP = 0.0022     // per unit deltaY roda mouse

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

function MotorCarousel({ photos = [], title = '', selectedModParts = [] }) {
  const n = photos.length
  const spinnable = n >= 2

  const [i, setI] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [auto, setAuto] = useState(false)
  const [loaded, setLoaded] = useState(0)
  const [lightbox, setLightbox] = useState(false)

  const boxRef = useRef(null)
  const drag = useRef(null)      // state gesture aktif
  const momentum = useRef(0)     // id rAF untuk inersia
  const moved = useRef(false)    // bedakan klik dari seret

  const zoomed = zoom > 1.001

  // ---- preload: semua frame dimuat di depan, supaya memutar tidak nge-lag
  // menunggu gambar berikutnya ter-fetch di tengah gesture ----
  useEffect(() => {
    setLoaded(0)
    setI(0)
    setZoom(1)
    setPan({ x: 0, y: 0 })
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
    if (!auto || !spinnable || zoomed) return
    const t = setInterval(() => setI((p) => mod(p + 1, n)), AUTO_MS)
    return () => clearInterval(t)
  }, [auto, spinnable, n, zoomed])

  const stopAuto = useCallback(() => setAuto(false), [])

  const go = useCallback((delta) => {
    stopAuto()
    setI((p) => mod(p + delta, n || 1))
  }, [n, stopAuto])

  const resetView = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  // ---- roda mouse = zoom. Listener dipasang manual karena butuh
  // passive:false agar preventDefault() bisa menahan scroll halaman ----
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const onWheel = (e) => {
      if (!n) return
      e.preventDefault()
      stopAuto()
      setZoom((z) => {
        const next = clamp(z - e.deltaY * ZOOM_STEP, ZOOM_MIN, ZOOM_MAX)
        if (next <= ZOOM_MIN + 0.001) setPan({ x: 0, y: 0 })
        return next
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
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

  // ---- gesture pointer: seret memutar (zoom 1x) atau menggeser (zoom > 1x).
  // Satu handler untuk mouse & sentuh — pointer events menyatukan keduanya. ----
  const onPointerDown = (e) => {
    if (!n) return
    // Panah/dot/reset ada DI DALAM kotak ini. Kalau gesture ikut dimulai di
    // atasnya, setPointerCapture di bawah akan menarik pointer ke container
    // dan tombolnya tidak pernah menerima click — jadi biarkan tombol lewat.
    if (e.target.closest('button')) return
    cancelAnimationFrame(momentum.current)
    stopAuto()
    moved.current = false
    drag.current = {
      x: e.clientX, y: e.clientY,
      startI: i, startPan: pan,
      lastX: e.clientX, lastT: performance.now(), vx: 0,
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
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

    if (zoomed) {
      // saat di-zoom, seret = geser bingkai (bukan memutar)
      const lim = 140 * (zoom - 1)
      setPan({
        x: clamp(d.startPan.x + dx, -lim, lim),
        y: clamp(d.startPan.y + dy, -lim, lim),
      })
      return
    }
    if (!spinnable) return
    // seret ke kiri = motor berputar maju, seperti memutar turntable
    const frames = Math.round(-dx / DRAG_PER_FRAME)
    setI(mod(d.startI + frames, n))
  }

  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    if (!d || zoomed || !spinnable) return
    // lempar cepat → lanjut beberapa frame lalu melambat
    const extra = clamp(Math.round(Math.abs(d.vx) * 2.2), 0, n)
    if (extra >= 1) glide(extra, d.vx < 0 ? 1 : -1)
  }

  // ---- keyboard: ←/→ putar, spasi setel auto-rotate, 0 reset zoom ----
  const onKeyDown = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
    else if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault()
      if (spinnable) setAuto((a) => !a)
    } else if (e.key === '0') resetView()
    else if (e.key === 'Escape') setLightbox(false)
  }

  useEffect(() => {
    if (!lightbox) return
    const onKey = (e) => {
      if (e.key === 'Escape') setLightbox(false)
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox, go])

  // Sudut pandang dihitung dari jumlah foto — 8 foto → 0/45/90…, 4 foto → 0/90/…
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

  const frame = (
    <>
      {/* Gambar + part modifikasi ikut satu transform, supaya part tetap
          menempel di tempatnya saat di-zoom/geser. */}
      <motion.div className="mc-stage"
        animate={{ scale: zoom, x: pan.x, y: pan.y }}
        transition={{ type: 'spring', stiffness: 260, damping: 30 }}
        style={{ willChange: 'transform' }}>
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
      </motion.div>

      {!allReady && <div className="mc-skeleton" aria-hidden="true" />}
    </>
  )

  return (
    <>
      <div
        ref={boxRef}
        className={'gallery-main mc has-photo' + (zoomed ? ' zoomed' : '')}
        role="group"
        tabIndex={0}
        aria-label={'Galeri 360° ' + title + '. Panah kiri-kanan memutar, spasi menyetel putar otomatis.'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onDoubleClick={resetView}
        onClick={() => { if (!moved.current && !zoomed) setLightbox(true) }}>

        {frame}

        {spinnable && <span className="mc-angle">{String(angle).padStart(3, '0')}°</span>}
        {zoomed && (
          <button type="button" className="mc-reset"
            onClick={(e) => { e.stopPropagation(); resetView() }}>
            {zoom.toFixed(1)}× · reset
          </button>
        )}

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

            <span className="mc-hint">
              {auto ? 'Berputar otomatis · seret untuk ambil alih' : 'Seret untuk memutar · gulir untuk zoom'}
            </span>
          </>
        )}
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
          <motion.div className="lightbox" role="dialog" aria-modal="true"
            aria-label={'Foto ' + title}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onMouseDown={(e) => { if (e.target === e.currentTarget) setLightbox(false) }}>
            <img src={photos[i]} alt={title + ' — sudut ' + angle + '°'} draggable={false} />
            {spinnable && (
              <>
                <button type="button" className="g-arrow prev" onClick={() => go(-1)}
                  aria-label="Sudut sebelumnya">←</button>
                <button type="button" className="g-arrow next" onClick={() => go(1)}
                  aria-label="Sudut berikutnya">→</button>
                <span className="g-count">{i + 1} / {n}</span>
              </>
            )}
            <button type="button" className="lb-close" onClick={() => setLightbox(false)}
              aria-label="Tutup">✕</button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

// Memo: DetailView re-render tiap kali paket garansi diganti — carousel tidak
// perlu ikut menghitung ulang kalau foto & part-nya sama.
export default memo(MotorCarousel)
