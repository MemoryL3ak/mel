import { useEffect, useState } from 'react';
import { api, fmtUSD } from '../api.js';
import { Select, Chip, Empty, Field, Modal, PageHead, useToast } from '../ui.jsx';

const EYEBROW = 'Fase 2 · Venta de obsoletos';
const ESTADO = {
  por_identificar: ['warn', 'Por identificar'], no_encontrado: ['bad', 'No encontrado en terreno'],
  planificado: ['neutral', 'Planificado'], publicado: ['info', 'Publicado'],
  adjudicado: ['ok', 'Adjudicado'], entregado: ['ok', 'Entregado'], chatarra: ['bad', 'Convertido a chatarra'],
};
const vacio = { codigo: '', nombre: '', especificaciones: '', sitio_id: '', ubicacion: '', valor_referencial: '', memo_id: '', fotos: [], ficha: null };
const FICHA_ACCEPT = 'application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/jpeg,image/png,image/webp,.xls,.xlsx';

// Parsea el pegado de la carga masiva: una línea por componente, columnas
// separadas por tabulación (pegado desde Excel) o punto y coma.
// Orden: Código (SKU) · Nombre · Especificaciones · Sitio · Ubicación · Valor USD.
function parseMasivo(texto) {
  return texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const c = l.split(/\t|;/).map((x) => x.trim());
    return { codigo: c[0] || '', nombre: c[1] || '', especificaciones: c[2] || '', sitio: c[3] || '', ubicacion: c[4] || '', valor_referencial: (c[5] || '').replace(/[^\d]/g, '') };
  }).filter((f) => (f.codigo || f.nombre) && !/^c[oó]digo$/i.test(f.codigo));
}

export default function Inventario() {
  const [data, setData] = useState(null);
  const [sitios, setSitios] = useState([]);
  const [busy, setBusy] = useState(false);
  const [nuevo, setNuevo] = useState(false);
  const [f, setF] = useState(vacio);
  const [editar, setEditar] = useState(null);
  const [eliminar, setEliminar] = useState(null);
  const [masivo, setMasivo] = useState(false);
  const [memos, setMemos] = useState([]);
  const [memoMasivo, setMemoMasivo] = useState('');
  const [texto, setTexto] = useState('');
  const [verAdj, setVerAdj] = useState(null);
  const toast = useToast();

  const load = () => api('/componentes').then(setData).catch((e) => toast(e.message, true));
  useEffect(() => {
    load();
    // Obsoletos se dan de baja en faena MEL o en La Negra; Lampa no aplica.
    api('/maestros').then((m) => setSitios((m.sitios ?? []).filter((s) => s.codigo !== 'LP'))).catch(() => {});
    // El componente cuelga del memo que autoriza su baja; los cerrados ya no reciben.
    api('/memos').then((ms) => setMemos(ms.filter((m) => m.estado !== 'cerrado'))).catch(() => {});
  }, []);
  if (!data) return <div className="loading">Cargando inventario…</div>;

  // Envuelve una acción para bloquear el botón mientras corre (evita el doble clic).
  const correr = async (fn) => { if (busy) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };

  const crear = () => correr(async () => {
    if (!f.codigo.trim()) return toast('El código (SKU SAP) es obligatorio', true);
    if (!f.nombre.trim()) return toast('El nombre del componente es obligatorio', true);
    const fd = new FormData();
    fd.append('codigo', f.codigo.trim());
    fd.append('nombre', f.nombre.trim());
    fd.append('especificaciones', f.especificaciones);
    if (f.sitio_id) fd.append('sitio_id', f.sitio_id);
    fd.append('ubicacion', f.ubicacion);
    if (f.valor_referencial !== '') fd.append('valor_referencial', Number(f.valor_referencial));
    if (f.memo_id) fd.append('memo_id', f.memo_id);
    for (const foto of f.fotos) fd.append('fotos', foto);
    if (f.ficha) fd.append('ficha', f.ficha);
    try {
      const c = await api('/componentes', { method: 'POST', body: fd });
      toast(`Componente ${c.codigo} ingresado`);
      setNuevo(false); setF(vacio); load();
    } catch (e) { toast(e.message, true); }
  });

  const guardarEdicion = () => correr(async () => {
    if (!editar.codigo.trim()) return toast('El código es obligatorio', true);
    if (!editar.nombre.trim()) return toast('El nombre es obligatorio', true);
    try {
      await api(`/componentes/${editar.id}`, { method: 'PATCH', body: {
        codigo: editar.codigo.trim(), nombre: editar.nombre.trim(), especificaciones: editar.especificaciones,
        sitio_id: editar.sitio_id || '', ubicacion: editar.ubicacion,
        valor_referencial: editar.valor_referencial === '' ? '' : Number(editar.valor_referencial) } });
      toast('Componente actualizado');
      setEditar(null); load();
    } catch (e) { toast(e.message, true); }
  });

  const eliminarComp = () => correr(async () => {
    try {
      await api(`/componentes/${eliminar.id}`, { method: 'DELETE' });
      toast(`${eliminar.codigo} eliminado`);
      setEliminar(null); load();
    } catch (e) { toast(e.message, true); }
  });

  const cargarMasivo = () => correr(async () => {
    const filas = parseMasivo(texto);
    if (!filas.length) return toast('No hay filas válidas para cargar', true);
    try {
      const r = await api('/componentes/masivo', { method: 'POST', body: { filas, memo_id: memoMasivo || undefined } });
      toast(`${r.cargados} componente(s) cargado(s)`);
      setMasivo(false); setTexto(''); setMemoMasivo(''); load();
    } catch (e) { toast(e.message + (e.detalle ? ` · ${e.detalle.join(' · ')}` : ''), true); }
  });

  async function abrirAdjuntos(c) {
    try {
      const r = await api(`/componentes/${c.id}/adjuntos`);
      if (!r.archivos?.length) return toast('Este componente no tiene adjuntos', true);
      setVerAdj({ componente: c, archivos: r.archivos });
    } catch (e) { toast(e.message, true); }
  }

  const previa = parseMasivo(texto);

  return (
    <div>
      <PageHead eyebrow={EYEBROW} title="Inventario y logística de obsoletos"
        sub="Planificación de venta, ubicación en terreno y bandeja de pendientes de entrega.">
        <button className="btn" onClick={() => { setMasivo(true); setTexto(''); }}>⇪ Carga masiva</button>
        <button className="btn primary" onClick={() => { setNuevo(true); setF(vacio); }}>+ Ingresar componente</button>
      </PageHead>

      <div className="card" style={{ marginBottom: 16 }}><div className="tbl-wrap"><table>
        <thead><tr><th>Componente</th><th>Código SAP</th><th>Memo</th><th>Ubicación en terreno</th><th className="num">Valor referencial</th><th>Estado</th><th className="acc"></th></tr></thead>
        <tbody>
          {data.componentes.map((c) => {
            const [tono, txt] = ESTADO[c.estado] ?? ['neutral', c.estado];
            return (
              <tr key={c.id}>
                <td><b>{c.nombre}</b>{c.fotos > 0 && <small style={{ color: 'var(--muted)' }}> · 📎 {c.fotos}</small>}{c.especificaciones && <><br /><small style={{ color: 'var(--muted)' }}>{c.especificaciones}</small></>}</td>
                <td className="mono">{c.codigo}</td>
                <td>{c.memo
                  ? <><span className="mono">{c.memo}</span><br /><small style={{ color: 'var(--muted)' }}>{c.area_usuaria}</small></>
                  : <small style={{ color: 'var(--muted)' }}>Sin memo</small>}</td>
                <td>{[c.sitio, c.ubicacion].filter(Boolean).join(' · ') || '—'}</td>
                <td className="num">{fmtUSD(c.valor_referencial)}</td>
                <td><Chip tone={tono}>{txt}{c.estado === 'publicado' && c.dia != null ? ` · día ${c.dia}` : ''}</Chip>
                  {c.nota_terreno && <><br /><small style={{ color: 'var(--muted)' }}>{c.nota_terreno}</small></>}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  {c.fotos > 0 && <button className="btn sm" onClick={() => abrirAdjuntos(c)}>Adjuntos</button>}{' '}
                  <button className="btn sm" onClick={() => setEditar({ ...c, especificaciones: c.especificaciones ?? '', ubicacion: c.ubicacion ?? '', sitio_id: c.sitio_id ?? '', valor_referencial: c.valor_referencial ?? '' })}>Editar</button>{' '}
                  {['planificado', 'por_identificar', 'no_encontrado'].includes(c.estado) && <button className="btn sm danger" onClick={() => setEliminar(c)}>Eliminar</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
        {data.componentes.length === 0 && <Empty title="Inventario vacío">Ingrese el primer componente obsoleto para planificar su venta.</Empty>}
      </div>

      <div className="card">
        <div className="card-h"><h3>Pendientes de entrega</h3><small>adjudicados sin retiro coordinado</small></div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Componente</th><th>Comprador</th><th>Adjudicado el</th><th className="num">Días de espera</th><th>Estado</th></tr></thead>
          <tbody>
            {data.pendientes.map((p) => (
              <tr key={p.adjudicacion_id}>
                <td><b>{p.componente}</b><br /><small className="mono" style={{ color: 'var(--muted)' }}>{p.codigo}</small></td>
                <td>{p.comprador}</td>
                <td className="mono">{p.adjudicado_el}</td>
                <td className="num">{p.dias_espera}</td>
                <td><Chip tone={p.estado === 'pagada' ? 'warn' : 'info'}>{p.estado === 'pagada' ? 'Pagado · por retirar' : 'Sin coordinación'}</Chip></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {data.pendientes.length === 0 && <Empty title="Sin pendientes">No hay componentes adjudicados esperando retiro.</Empty>}
      </div>

      {/* ---- alta ---- */}
      <Modal open={nuevo} title="Ingresar componente obsoleto" onClose={() => setNuevo(false)}
        footer={<>
          <button className="btn" onClick={() => setNuevo(false)} disabled={busy}>Cancelar</button>
          <button className="btn primary" onClick={crear} disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar al inventario'}</button>
        </>}>
        <Campos v={f} set={setF} sitios={sitios} memos={memos} conArchivos />
      </Modal>

      {/* ---- edición ---- */}
      <Modal open={!!editar} title={editar && `Editar ${editar.codigo}`} onClose={() => setEditar(null)}
        footer={<>
          <button className="btn" onClick={() => setEditar(null)} disabled={busy}>Cancelar</button>
          <button className="btn primary" onClick={guardarEdicion} disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
        </>}>
        {editar && <Campos v={editar} set={setEditar} sitios={sitios} />}
      </Modal>

      {/* ---- eliminar ---- */}
      <Modal open={!!eliminar} title="Eliminar componente" onClose={() => setEliminar(null)}
        footer={<>
          <button className="btn" onClick={() => setEliminar(null)} disabled={busy}>Cancelar</button>
          <button className="btn danger" onClick={eliminarComp} disabled={busy}>{busy ? 'Eliminando…' : 'Eliminar'}</button>
        </>}>
        <p style={{ marginTop: 0 }}>¿Eliminar <b>{eliminar?.nombre}</b> ({eliminar?.codigo}) del inventario? Se borran también sus adjuntos. Esta acción no se revierte.</p>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>Solo se pueden eliminar componentes que aún no se publicaron.</p>
      </Modal>

      {/* ---- carga masiva ---- */}
      <Modal open={masivo} title="Carga masiva de componentes" onClose={() => setMasivo(false)} ancho
        footer={<>
          <button className="btn" onClick={() => setMasivo(false)} disabled={busy}>Cancelar</button>
          <button className="btn primary" onClick={cargarMasivo} disabled={busy || !previa.length}>{busy ? 'Cargando…' : `Cargar ${previa.length || ''}`}</button>
        </>}>
        <p style={{ marginTop: 0, color: 'var(--ink-2)', fontSize: 13.5 }}>
          Pega una fila por componente (desde Excel o separadas por <b>;</b>), en este orden:
          <br /><b>Código SAP · Nombre · Especificaciones · Sitio (MEL/La Negra) · Ubicación · Valor referencial (USD)</b>
        </p>
        <Field label="Memo de baja" hint="Toda la carga queda respaldada por este memo: es la lista que declara.">
          <Select value={memoMasivo} onChange={(e) => setMemoMasivo(e.target.value)}>
            <option value="">— Elija el memo —</option>
            {memos.map((m) => <option key={m.id} value={m.id}>{m.folio} · {m.area_usuaria}</option>)}
          </Select>
        </Field>
        <Field label="Datos">
          <textarea rows="7" value={texto} onChange={(e) => setTexto(e.target.value)}
            placeholder={'1000234;Motor eléctrico 4000 HP;WEG 3.300V;MEL;Los Colorados B-3;28500\n1000235;Tolva CAEX 930E;Estructura completa;La Negra;Patio A-1;45000'} />
        </Field>
        {previa.length > 0 && (
          <div className="tbl-wrap" style={{ marginTop: 4 }}><table>
            <thead><tr><th>Código</th><th>Nombre</th><th>Sitio</th><th>Ubicación</th><th className="num">Valor ref.</th></tr></thead>
            <tbody>
              {previa.slice(0, 8).map((r, i) => (
                <tr key={i}><td className="mono">{r.codigo || '—'}</td><td>{r.nombre}</td><td>{r.sitio || '—'}</td><td>{r.ubicacion || '—'}</td><td className="num">{r.valor_referencial ? fmtUSD(r.valor_referencial) : '—'}</td></tr>
              ))}
            </tbody>
          </table>{previa.length > 8 && <small style={{ color: 'var(--muted)' }}>… y {previa.length - 8} más</small>}</div>
        )}
      </Modal>

      {/* ---- adjuntos ---- */}
      <Modal open={!!verAdj} title={verAdj && `Adjuntos · ${verAdj.componente.nombre}`} onClose={() => setVerAdj(null)} ancho>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 8 }}>
          {verAdj?.archivos.map((a) => (
            <a key={a.url} href={a.url} target="_blank" rel="noreferrer" title={a.tipo === 'ficha' ? 'Ficha técnica' : 'Foto'}>
              {a.tipo === 'ficha'
                ? <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', height: 130, background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--line)', color: 'var(--ink-2)', fontSize: 13, fontWeight: 600 }}><span style={{ fontSize: 26 }}>📄</span>Ficha técnica</span>
                : <img src={a.url} alt="Foto" style={{ width: '100%', height: 130, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)' }} />}
            </a>
          ))}
        </div>
      </Modal>
    </div>
  );
}

// Campos compartidos entre alta y edición.
function Campos({ v, set, sitios, memos, conArchivos }) {
  return (<>
    {memos && (
      <Field label="Memo de baja"
        hint="El memo firmado del área usuaria que autoriza enajenar este componente. Se carga en «Memos de baja».">
        <Select value={v.memo_id} onChange={(e) => set({ ...v, memo_id: e.target.value })}>
          <option value="">— Elija el memo —</option>
          {memos.map((m) => <option key={m.id} value={m.id}>{m.folio} · {m.area_usuaria}</option>)}
        </Select>
        {memos.length === 0 && (
          <small style={{ color: 'var(--warn-tx)', display: 'block', marginTop: 6 }}>
            No hay memos abiertos. Cargue primero el memo en «Memos de baja».
          </small>
        )}
      </Field>
    )}
    <div className="grid g2" style={{ gap: 0, columnGap: 14 }}>
      <Field label="Código (SKU SAP)" hint="Se digita: corresponde al SKU del componente en SAP.">
        <input value={v.codigo} onChange={(e) => set({ ...v, codigo: e.target.value })} placeholder="1000234" />
      </Field>
      <Field label="Nombre del componente">
        <input value={v.nombre} onChange={(e) => set({ ...v, nombre: e.target.value })} placeholder="Motor eléctrico 4.000 HP" />
      </Field>
    </div>
    <Field label="Especificaciones" hint="Marca, características, estado de uso. Se muestran en el portal público.">
      <textarea rows="2" value={v.especificaciones} onChange={(e) => set({ ...v, especificaciones: e.target.value })}
        placeholder="WEG · 3.300 V · 50 Hz · usado, operativo al retiro de servicio" />
    </Field>
    <div className="grid g2" style={{ gap: 0, columnGap: 14 }}>
      <Field label="Sitio">
        <Select value={v.sitio_id} onChange={(e) => set({ ...v, sitio_id: e.target.value })}>
          <option value="">— Sin definir —</option>
          {sitios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </Select>
      </Field>
      <Field label="Ubicación en terreno">
        <input value={v.ubicacion} onChange={(e) => set({ ...v, ubicacion: e.target.value })} placeholder="Sector B-3 · Fila 2" />
      </Field>
    </div>
    <Field label="Valor referencial (USD)" hint="Estimación interna en dólares; no es la oferta mínima de la publicación.">
      <input type="number" min="0" value={v.valor_referencial} onChange={(e) => set({ ...v, valor_referencial: e.target.value })} placeholder="28500" />
    </Field>
    {conArchivos && <>
      <Field label="Fotos del componente" hint="JPG, PNG o WebP · hasta 4 · se muestran en el portal público.">
        <input type="file" multiple accept="image/jpeg,image/png,image/webp"
          onChange={(e) => set({ ...v, fotos: Array.from(e.target.files).slice(0, 4) })} />
        {v.fotos?.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {v.fotos.map((foto) => (
              <img key={foto.name} src={URL.createObjectURL(foto)} alt={foto.name}
                style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--line)' }} />
            ))}
          </div>
        )}
      </Field>
      <Field label="Ficha técnica" hint="PDF, planilla Excel o foto. Opcional.">
        <input type="file" accept={FICHA_ACCEPT}
          onChange={(e) => set({ ...v, ficha: e.target.files[0] || null })} />
        {v.ficha && <small style={{ color: 'var(--muted)', display: 'block', marginTop: 6 }}>📄 {v.ficha.name}</small>}
      </Field>
    </>}
  </>);
}
