// Set tema SEBELUM paint pertama → tanpa kedip putih (FOUC).
//
// File EKSTERNAL (bukan <script> inline) supaya lolos Content-Security-Policy
// `script-src 'self'` TANPA perlu 'unsafe-inline' / nonce / hash. Dimuat sinkron
// (blocking, tanpa defer/async) di <head> sebelum <body> di-paint, jadi efeknya
// identik dengan versi inline sebelumnya — tapi tidak melanggar CSP.
(function () {
  try {
    var t = localStorage.getItem('theme');
    // Default = LIGHT (tidak mengikuti tema OS) → konsisten di semua perangkat.
    if (t !== 'dark' && t !== 'light') { t = 'light'; }
    var el = document.documentElement;
    el.setAttribute('data-theme', t);
    el.style.background = t === 'dark' ? '#0d0f14' : '#ffffff';
    el.style.colorScheme = t;
  } catch (e) {}
})();
