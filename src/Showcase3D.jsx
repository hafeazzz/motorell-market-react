// ============================================================
// Showcase 3D interaktif (React Three Fiber) — route #/showcase.
//
// DIBANGUN SEBAGAI PRATINJAU TERPISAH, bukan mengganti hero produksi (<model-
// viewer>) yang sudah jalan & ringan. R3F/three (~800KB) di-LAZY-LOAD lewat
// React.lazy di App.jsx, jadi TAK membebani bundle awal — hanya termuat saat
// membuka #/showcase.
//
// JUJUR soal batasan: hover "per-bagian" (roda/mesin/jok terpisah) BUTUH GLB
// yang tiap bagiannya mesh terpisah & bernama. Model kita sudah DIGABUNG saat
// optimasi (Draco/join), jadi di sini hover = SELURUH model (highlight glossy +
// tooltip global). Untuk per-bagian, perlu aset baru yang disegmentasi.
// ============================================================
import React, { Suspense, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF, OrbitControls, Center, Bounds, ContactShadows, Loader, Environment, Lightformer } from '@react-three/drei'
import { motion } from 'framer-motion'

const MODEL = '/models/harley-davidson-flhrxs.glb'
useGLTF.preload(MODEL)

// ---- Model: load GLB, bobbing halus, highlight glossy saat hover ----
function Motor({ onHover }) {
  const { scene } = useGLTF(MODEL)
  const grp = useRef()
  const [hovered, setHovered] = useState(false)

  useEffect(() => {  // kloning material sekali → aman ubah emissive
    scene.traverse((o) => {
      if (o.isMesh && o.material) {
        o.material = o.material.clone()
        o.castShadow = true; o.receiveShadow = true
      }
    })
  }, [scene])

  useEffect(() => {  // highlight glossy saat hover
    scene.traverse((o) => {
      if (o.isMesh && o.material && o.material.emissive) {
        o.material.emissive.set(hovered ? '#16305c' : '#000000')
        o.material.emissiveIntensity = hovered ? 0.6 : 0
        o.material.needsUpdate = true
      }
    })
    onHover?.(hovered)
    document.body.style.cursor = hovered ? 'pointer' : ''
    return () => { document.body.style.cursor = '' }
  }, [hovered, scene, onHover])

  useFrame((s) => { if (grp.current) grp.current.position.y = Math.sin(s.clock.elapsedTime * 1.1) * 0.04 })

  return (
    <group ref={grp}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true) }}
      onPointerOut={() => setHovered(false)}>
      <Center><primitive object={scene} /></Center>
    </group>
  )
}

// Zoom detail saat klik-dua-kali: lerp FOV (tanpa mengganggu OrbitControls).
function CameraFov({ focused }) {
  const { camera } = useThree()
  useFrame(() => {
    const target = focused ? 26 : 42
    if (Math.abs(camera.fov - target) > 0.1) {
      camera.fov += (target - camera.fov) * 0.08
      camera.updateProjectionMatrix()
    }
  })
  return null
}

// Skema 3 lampu: key putih 45°, fill biru sejuk, rim belakang.
function Lights() {
  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight position={[4, 6, 4]} intensity={2.1} color="#ffffff" castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-6, 2, 3]} intensity={0.9} color="#8fb4ff" />
      <directionalLight position={[0, 3, -6]} intensity={1.4} color="#dfe8ff" />
    </>
  )
}

// Error boundary: WebGL tak didukung / gagal → fallback statis.
class WebGLBoundary extends React.Component {
  constructor(p) { super(p); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(e) { console.warn('[SHOWCASE3D] WebGL gagal → fallback:', e?.message) }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

const FEATURES = ['Kualitas Terjamin', 'Harga Terbaik', 'Kurasi 50+ Titik']

export default function Showcase3D({ onExit, onShop }) {
  const [focused, setFocused] = useState(false)
  const [hoverInfo, setHoverInfo] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const controls = useRef()

  useEffect(() => {  // keyboard: panah = putar, Enter = belanja, Esc = keluar
    const onKey = (e) => {
      const c = controls.current
      if (e.key === 'ArrowLeft' && c) c.setAzimuthalAngle(c.getAzimuthalAngle() - 0.12)
      else if (e.key === 'ArrowRight' && c) c.setAzimuthalAngle(c.getAzimuthalAngle() + 0.12)
      else if (e.key === 'Enter') onShop?.()
      else if (e.key === 'Escape') onExit?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onShop, onExit])

  const fallback = (
    <div className="sc-fallback">
      <p>Browser kamu tidak mendukung 3D (WebGL).</p>
      <button className="sc-cta" onClick={onShop}>Mulai Belanja</button>
    </div>
  )

  return (
    <div className="sc-root" onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}>
      <style>{CSS}</style>
      <WebGLBoundary fallback={fallback}>
        <Canvas shadows dpr={[1, 2]} camera={{ position: [0.2, 0.6, 4.2], fov: 42 }}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          onDoubleClick={() => setFocused((f) => !f)}
          aria-label="Motor 3D interaktif — seret untuk memutar, klik dua kali untuk perbesar">
          <color attach="background" args={['#1f2a38']} />
          <fog attach="fog" args={['#1f2a38', 6, 15]} />
          <Lights />
          <CameraFov focused={focused} />
          <Suspense fallback={null}>
            {/* Environment map lokal (dari Lightformer, TANPA CDN) → cat metalik
                punya sesuatu untuk dipantulkan → tampak glossy, tak gelap pekat. */}
            <Environment resolution={128} frames={1}>
              <Lightformer intensity={2.6} position={[0, 4, 5]} scale={[12, 6, 1]} color="#ffffff" />
              <Lightformer intensity={1.3} position={[-6, 1, 2]} scale={[5, 8, 1]} color="#a8c6ff" />
              <Lightformer intensity={1.1} position={[6, 1, -2]} scale={[5, 8, 1]} color="#ffe9c7" />
            </Environment>
            <Bounds fit clip margin={1.15}>
              <Motor onHover={setHoverInfo} />
            </Bounds>
            <ContactShadows position={[0, -1.05, 0]} opacity={0.5} scale={9} blur={2.6} far={4} />
          </Suspense>
          <OrbitControls ref={controls} makeDefault enableZoom={false} enablePan={false}
            autoRotate autoRotateSpeed={0.9} minPolarAngle={Math.PI / 3} maxPolarAngle={Math.PI / 1.9} />
        </Canvas>
      </WebGLBoundary>

      <Loader containerStyles={{ background: 'transparent' }} />

      {hoverInfo && (
        <div className="sc-tip" style={{ left: pos.x + 16, top: pos.y + 16 }} role="status">
          <b>Harley-Davidson FLHRXS</b><br />Cat metalik · kondisi prima · seret untuk memutar
        </div>
      )}

      <div className="sc-ui">
        <motion.div className="sc-logo" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}>MOTORELL<span>MARKET</span></motion.div>
        <div className="sc-features">
          {FEATURES.map((t, i) => (
            <motion.span key={t} initial={{ opacity: 0, y: 16, filter: 'blur(8px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.7, delay: 0.7 + i * 0.18, ease: [0.22, 1, 0.36, 1] }}>{t}</motion.span>
          ))}
        </div>
        <motion.div className="sc-bottom" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 1.3 }}>
          <button className="sc-cta" onClick={onShop} aria-label="Mulai belanja — lihat etalase">Mulai Belanja</button>
          <button className="sc-ghost" onClick={onExit} aria-label="Kembali ke beranda">← Beranda</button>
        </motion.div>
      </div>
    </div>
  )
}

const CSS = `
.sc-root{position:fixed;inset:0;z-index:60;overflow:hidden;
  background:radial-gradient(120% 90% at 70% 20%,#2b3a4d 0%,#1f2a38 45%,#0f1620 100%)}
.sc-root canvas{touch-action:none}
.sc-ui{position:absolute;inset:0;pointer-events:none;display:flex;flex-direction:column;
  align-items:center;justify-content:space-between;padding:clamp(22px,5vw,54px) 20px;text-align:center}
.sc-ui>*{pointer-events:auto}
.sc-logo{font-family:var(--font,Archivo,sans-serif);font-weight:800;letter-spacing:.14em;
  font-size:clamp(18px,2.6vw,26px);color:#fff;text-shadow:0 2px 20px rgba(0,0,0,.4)}
.sc-logo span{color:#7db0ff}
.sc-features{display:flex;flex-direction:column;gap:8px;color:#eaf1ff}
.sc-features span{font-size:clamp(20px,4vw,40px);font-weight:750;letter-spacing:-.02em;
  text-shadow:0 2px 24px rgba(0,0,0,.5)}
.sc-bottom{display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:center}
.sc-cta{border:none;cursor:pointer;font:inherit;font-weight:750;font-size:15px;color:#0b1220;
  background:#fff;padding:14px 30px;border-radius:999px;transition:transform .2s,box-shadow .2s,background .2s;
  box-shadow:0 8px 30px rgba(0,0,0,.35)}
.sc-cta:hover{transform:scale(1.05);background:#9C7A45;color:#fff;
  box-shadow:0 10px 40px rgba(156,122,69,.6),0 0 0 4px rgba(156,122,69,.18)}
.sc-ghost{border:1px solid rgba(255,255,255,.4);background:rgba(255,255,255,.06);color:#fff;
  cursor:pointer;font:inherit;font-size:14px;padding:13px 20px;border-radius:999px;transition:background .2s}
.sc-ghost:hover{background:rgba(255,255,255,.16)}
.sc-tip{position:fixed;z-index:70;pointer-events:none;background:rgba(10,16,24,.9);color:#fff;
  font-size:12px;line-height:1.5;padding:8px 12px;border-radius:9px;border:1px solid rgba(255,255,255,.14);
  max-width:260px;box-shadow:0 8px 26px rgba(0,0,0,.5)}
.sc-fallback{position:absolute;inset:0;display:flex;flex-direction:column;gap:18px;
  align-items:center;justify-content:center;color:#fff;text-align:center;padding:24px}
@media (prefers-reduced-motion: reduce){.sc-features span,.sc-logo,.sc-bottom{transition:none}}
`
