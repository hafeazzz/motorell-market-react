import React from 'react'

// Tanpa error boundary, satu error saat render membuat React melepas SELURUH
// pohon komponen — hasilnya #root kosong alias layar putih, tanpa petunjuk apa
// pun di halaman. Boundary ini menahan error terakhir supaya yang muncul adalah
// pesan yang bisa dibaca (dan stack-nya tetap masuk console untuk debugging).
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ERROR] Render gagal:', error)
    console.error('[ERROR] Component stack:', info?.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    // Styling di-inline: boundary ini menggantikan <App />, dan <style>{CSS}</style>
    // ada DI DALAM App — jadi saat App gagal render, tidak ada CSS sama sekali.
    return (
      <div style={{
        minHeight: '100svh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, background: '#fff', color: '#111114',
        fontFamily: 'system-ui,-apple-system,sans-serif',
      }}>
        <div style={{
          maxWidth: 520, border: '1px solid #e4e4e1', borderRadius: 14, padding: 32,
          lineHeight: 1.65, fontSize: 14.5,
        }}>
          <b style={{ fontSize: 18 }}>Ada yang salah saat menampilkan halaman.</b>
          <p style={{ margin: '16px 0', color: '#5c6067' }}>
            <code style={{ fontFamily: 'monospace', color: '#1a2f5e' }}>
              {error.message || String(error)}
            </code>
          </p>
          <p style={{ color: '#5c6067' }}>
            Detail lengkap (stack trace) ada di console browser — buka DevTools → Console.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 20, padding: '12px 24px', borderRadius: 999, border: 'none',
              background: '#111114', color: '#fff', fontWeight: 600, fontSize: 14,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
            Muat ulang
          </button>
        </div>
      </div>
    )
  }
}
