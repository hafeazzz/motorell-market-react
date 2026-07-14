import { useState, useRef, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import { MOD_CATEGORIES, CAT_FALLBACK } from './modParts';

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = SUPA_URL && SUPA_KEY ? createClient(SUPA_URL, SUPA_KEY) : null;

function ModPartForm({ initial, onClose, onSaved, toast }) {
  const editing = Boolean(initial && initial.id);
  const [f, setF] = useState({
    name: initial?.name || '',
    category: initial?.category || CAT_FALLBACK,
    price: initial?.price || '',
    x_pos: initial?.x_pos || 0,
    y_pos: initial?.y_pos || 0,
  });
  const [imageUrl, setImageUrl] = useState(initial?.image_url || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileInputRef = useRef(null);

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const handleImageUpload = async (file) => {
    if (!file) return;
    setBusy(true);
    setErr('');
    try {
      const fileName = `mod_parts/${Date.now()}-${file.name}`;
      const { data, error } = await supabase.storage.from('mod-part-photos').upload(fileName, file);
      if (error) throw error;
      const { data: publicUrlData } = supabase.storage.from('mod-part-photos').getPublicUrl(fileName);
      setImageUrl(publicUrlData.publicUrl);
      toast('Gambar berhasil diunggah!');
    } catch (ex) {
      setErr('Gagal mengunggah gambar: ' + (ex.message || 'coba lagi'));
    } finally {
      setBusy(false);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setErr('');
    if (!f.name || !f.price || !imageUrl) {
      setErr('Nama, Harga, dan Gambar Part wajib diisi.');
      return;
    }
    setBusy(true);
    const payload = {
      name: f.name.trim(),
      category: f.category,
      price: Number(f.price),
      image_url: imageUrl,
      x_pos: Number(f.x_pos),
      y_pos: Number(f.y_pos),
    };

    try {
      if (editing) {
        const { error } = await supabase.from('mod_parts').update(payload).eq('id', initial.id);
        if (error) throw error;
        toast('Part modifikasi diperbarui!');
      } else {
        const { error } = await supabase.from('mod_parts').insert(payload);
        if (error) throw error;
        toast('Part modifikasi ditambahkan!');
      }
      onSaved();
    } catch (ex) {
      // Kolom category baru ada setelah migrasi dijalankan. Tanpa pesan ini,
      // admin cuma melihat error PostgREST mentah yang tidak menyebut solusinya.
      const raw = ex.message || '';
      setErr(/category/i.test(raw) && /column|schema cache/i.test(raw)
        ? 'Kolom "category" belum ada di tabel mod_parts. Jalankan dulu migrasi '
          + 'supabase/migrations/0001_mod_part_category.sql di SQL Editor Supabase.'
        : (raw || 'Gagal menyimpan part modifikasi'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 'min(500px,100%)' }}>
        <div className="m-head">
          <div>
            <h3>{editing ? 'Edit Part Modifikasi' : 'Tambah Part Modifikasi'}</h3>
            <span className="sub">{f.name || 'Detail part'}</span>
          </div>
          <button className="m-close" onClick={onClose} aria-label="Tutup">✕</button>
        </div>
        <div className="m-body">
          <form onSubmit={save}>
            <div className="f-grid">
              <div className="field full">
                <label htmlFor="mp-name">Nama Part</label>
                <input id="mp-name" value={f.name} onChange={set('name')} placeholder="Stang Fatbar" required />
              </div>
              <div className="field full">
                <label htmlFor="mp-cat">Kategori</label>
                <select id="mp-cat" value={f.category} onChange={set('category')}>
                  {MOD_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="field full">
                <label htmlFor="mp-price">Harga Part (Rp)</label>
                <input id="mp-price" type="number" min="0" value={f.price} onChange={set('price')} placeholder="500000" required />
              </div>
              <div className="field">
                <label htmlFor="mp-xpos">Posisi X (px)</label>
                <input id="mp-xpos" type="number" value={f.x_pos} onChange={set('x_pos')} placeholder="0" />
              </div>
              <div className="field">
                <label htmlFor="mp-ypos">Posisi Y (px)</label>
                <input id="mp-ypos" type="number" value={f.y_pos} onChange={set('y_pos')} placeholder="0" />
              </div>
              <div className="field full">
                <label>Foto Part (PNG transparan)</label>
                {imageUrl && <img src={imageUrl} alt="Part Preview" style={{ maxWidth: '150px', maxHeight: '150px', marginBottom: '10px' }} />}
                <input type="file" accept="image/png" onChange={(e) => handleImageUpload(e.target.files[0])} ref={fileInputRef} />
              </div>
            </div>
            {err && <p className="f-err">{err}</p>}
            <div className="m-actions">
              <button className="btn btn-accent btn-full" disabled={busy}>
                {busy ? 'Menyimpan…' : editing ? 'Simpan Perubahan' : 'Tambah Part'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default ModPartForm;
