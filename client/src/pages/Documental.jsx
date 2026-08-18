import { useEffect, useState } from 'react';
import { api, getToken } from '../api.js';
import { Chip, Field, Modal, PageHead, useToast } from '../ui.jsx';

const CHIP = { vigente: ['ok', 'Vigente'], por_vencer: ['bad', 'Por vencer'], vencido: ['bad', 'Vencido'] };

export default function Documental() {
  const [data, setData] = useState(null);
  const [filtro, setFiltro] = useState('Todos');
  const [carga, setCarga] = useState(false);
  const [form, setForm] = useState({ tipo: '', hito: '', vencimiento: '' });
  const [archivo, setArchivo] = useState(null);
  const toast = useToast();

  const load = () => api('/documentos').then(setData).catch((e) => toast(e.message, true));
  useEffect(() => { load(); }, []);
  if (!data) return <div className="loading">Cargando repositorio…</div>;

  const rows = filtro === 'Todos' ? data.rows : data.rows.filter((d) => d.tipo === filtro);

  async function subir() {
    if (!archivo) return toast('Adjunte el archivo a cargar', true);
    if (!form.tipo || !form.hito) return toast('Tipo documental e hito son obligatorios', true);
    const fd = new FormData();
    fd.append('archivo', archivo);
    fd.append('tipo', form.tipo);
    fd.append('hito', form.hito);
    if (form.vencimiento) fd.append('vencimiento', form.vencimiento);
    try {
      const r = await api('/documentos', { method: 'POST', form: fd });
      toast(`Documento cargado — versión ${r.version} vinculada al hito`);
      setCarga(false); setArchivo(null); setForm({ tipo: '', hito: '', vencimiento: '' });
      load();
    } catch (e) { toast(e.message, true); }
  }

  async function descargar(d) {
    const res = await fetch(`/api/documentos/${d.id}/descargar`, { headers: { Authorization: 'Bearer ' + getToken() } });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return toast(err.error || 'No se pudo descargar', true);
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = d.archivo;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="page">
      <PageHead title="Repositorio documental" sub="Tipos documentales del proceso con versionado, control de vencimientos y vinculación al hito correspondiente.">
        <button className="btn primary" onClick={() => setCarga(true)}>↑ Cargar documento</button>
      </PageHead>
      <div className="doc-filters">
        {['Todos', ...data.tipos].map((t) => (
          <button key={t} className={filtro === t ? 'active' : ''} onClick={() => setFiltro(t)}>{t}</button>
        ))}
      </div>
      <div className="card"><div className="tbl-wrap"><table>
        <thead><tr><th>Documento</th><th>Tipo</th><th>Hito vinculado</th><th className="num">Versión</th><th>Vencimiento</th><th>Estado</th><th>Cargado por</th><th></th></tr></thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id}>
              <td className="mono">{d.archivo}</td><td>{d.tipo}</td><td>{d.hito}</td>
              <td className="num">v{d.version}</td><td>{d.vencimiento || '—'}</td>
              <td><Chip tone={CHIP[d.estado][0]}>{CHIP[d.estado][1]}</Chip></td>
              <td>{d.subido_por}</td>
              <td className="num"><button className="btn sm" onClick={() => descargar(d)}>Descargar</button></td>
            </tr>
          ))}
        </tbody>
      </table></div></div>

      <Modal open={carga} title="Cargar documento al repositorio" onClose={() => setCarga(false)}
        footer={<>
          <button className="btn" onClick={() => setCarga(false)}>Cancelar</button>
          <button className="btn primary" onClick={subir}>Cargar y versionar</button>
        </>}>
        <Field label="Archivo"><input type="file" onChange={(e) => setArchivo(e.target.files[0])} /></Field>
        <Field label="Tipo documental">
          <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
            <option value="">Seleccione…</option>
            {data.tipos.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Hito vinculado">
          <input value={form.hito} onChange={(e) => setForm({ ...form, hito: e.target.value })} placeholder="Ej.: EP agosto 2026, Despacho GD-4532…" />
        </Field>
        <Field label="Fecha de vencimiento (opcional)">
          <input type="date" value={form.vencimiento} onChange={(e) => setForm({ ...form, vencimiento: e.target.value })} />
        </Field>
        <small style={{ color: 'var(--muted)' }}>Si ya existe el mismo archivo para el hito, se crea una nueva versión y la anterior queda en el historial.</small>
      </Modal>
    </div>
  );
}
