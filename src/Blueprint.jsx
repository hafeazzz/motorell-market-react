// Blueprint motor — fallback saat unit belum punya foto. Dipisah ke modul
// sendiri supaya MotorCarousel bisa memakainya tanpa meng-import App.jsx
// (yang meng-import MotorCarousel → lingkaran import).
export default function Blueprint() {
  return (
    <svg className="blp" viewBox="0 0 300 170" fill="none" stroke="#c3c3bf"
      strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="62" cy="122" r="34" /><circle cx="62" cy="122" r="10" />
      <circle cx="238" cy="122" r="34" /><circle cx="238" cy="122" r="10" />
      <path d="M62 122 L110 120 L96 70" />
      <path d="M238 122 L206 62 L196 54" />
      <path d="M110 120 L150 118 L196 54" />
      <path d="M96 70 L104 60 H150 L172 74 L150 118" />
      <path d="M150 62 q22 -16 44 -8" />
      <path d="M86 60 L104 60" /><path d="M86 52 v16" />
      <path d="M118 122 h64" strokeDasharray="3 8" />
      <path d="M206 62 l16 -10" />
    </svg>
  )
}
