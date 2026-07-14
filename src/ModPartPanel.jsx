import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import ModPartForm from './ModPartForm';

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = SUPA_URL && SUPA_KEY ? createClient(SUPA_URL, SUPA_KEY) : null;

const rupiah = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(Number(n) || 0));

function ModPartPanel({ toast }) {
  const [modParts, setModParts] = useState(null);
  const [form, setForm] = useState(null); // null | {} (new) | mod_part (edit)
  const [err, setErr] = useState('');

  const loadModParts = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from('mod_parts').select('*').order('name', { ascending: true });
    if (error) {
      setErr(error.message);
      setModParts([]);
      return;
    }
    setErr('');
    setModParts(data || []);
  }, []);

  useEffect(() => {
    loadModParts();
  }, [loadModParts]);

  return (
    <>
      <div style={{ marginBottom: '20px' }}>
        <button className="btn btn-accent" onClick={() => setForm({})}>+ Tambah Part Modifikasi</button>
      </div>

      {modParts === null && !err && <p style={{ color: 'var(--muted)' }}>Memuat...</p>}
      {err && <p className="f-err">Error: {err}</p>}
      {modParts && modParts.length === 0 && !err && (
        <div className="empty">Belum ada part modifikasi. Klik "Tambah Part Modifikasi" untuk menambah.</div>
      )}

      {modParts && modParts.length > 0 && (
        <div className="a-list">
          {modParts.map((part) => (
            <div className="a-row" key={part.id}>
              <div className="a-thumb">
                {part.image_url ? <img src={part.image_url} alt={part.name} /> : <span>NO IMG</span>}
              </div>
              <div className="a-info">
                <b>{part.name}</b>
                <span>Harga: {rupiah(part.price)}</span>
                <span>Posisi: ({part.x_pos}, {part.y_pos})</span>
              </div>
              <div className="a-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => setForm(part)}>Edit</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {form !== null && (
        <ModPartForm
          initial={form.id ? form : null}
          toast={toast}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            loadModParts();
          }}
        />
      )}
    </>
  );
}

export default ModPartPanel;
