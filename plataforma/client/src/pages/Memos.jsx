import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { DateField, Select, Chip, Empty, Field, Modal, PageHead, hoyISO, useToast } from '../ui.jsx';

// Memo de baja: el documento firmado del área usuaria generadora que autoriza
// enajenar componentes. Es el origen del inventario obsoleto y la lista contra
// la cual se concilia lo que aparece en terreno.
// Lo carga MEL (coordinador); el vendor lo lee para saber de dónde viene lo que publica.
const EYEBROW = 'Fase 2 · Venta de obsoletos';
const ESTADO = {
  recibido: ['info', 'Recibido'],
  en_identificacion: ['warn', 'En identificación'],
  cerrado: ['ok', 'Cerrado'],
};
const EST_COMP = {
  por_identificar: ['warn', 'Por identificar'], no_encontrado: ['bad', 'No encontrado'],
  planificado: ['neutral', 'Confirmado en terreno'], publicado: ['info', 'Publicado'],
  adjudicado: ['ok', 'Adjudicado'], entregado: ['ok', 'Entregado'], chatarra: ['bad', 'Chatarra'],
};
const vacio = { area_usuaria: '', emitido_por: '', referencia: '', fecha_memo: hoyISO(), observaciones: '', doc: null };

export default function Memos() {
  const { user } = useAuth();
  const esMEL = user?.role === 'coordinador';
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [nuevo, setNuevo] = useState(false);
  const [f, setF] = useState(vacio);
  const [editar, setEditar] = useState(null);
  const [eliminar, setEliminar] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [terreno, setTerreno] = useState(null);   // { componente, encontrado }
  const [nota, setNota] = useState('');
  const toast = useToast();

  const load = () => api('/memos').then(setRows).catch((e) => toast(e.message, true));
  useEffect(() => { load(); }, []);
  if (!rows) return <div className="loading">Cargando memos…</div>;

  const correr = async (fn) => { if (busy) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };

  const crear = () => correr(async () => {
    if (!f.area_usuaria.trim()) return toast('Indique el área usuaria que genera el memo', true);
    const fd = new FormData();
    fd.append('area_usuaria', f.area_usuaria.trim());
    fd.append('emitido_por', f.emitido_por);
    fd.append('referencia', f.referencia);
    fd.append('fecha_memo', f.fecha_memo || hoyISO());
    fd.append('observaciones', f.observaciones);
    if (f.doc) fd.append('doc', f.doc);
    try {
      const m = await api('/memos', { method: 'POST', body: fd });
      toast(`Memo ${m.folio} cargado`);
      setNuevo(false); setF({ ...vacio, fecha_memo: hoyISO() }); load();
    } catch (e) { toast(e.message, true); }
  });

  const guardarEdicion = () => correr(async () => {
    if (!editar.area_usuaria.trim()) return toast('El área usuaria es obligatoria', true);
    try {
      await api(`/memos/${editar.id}`, { method: 'PATCH', body: {
        area_usuaria: editar.area_usuaria.trim(), emitido_por: editar.emitido_por,
        referencia: editar.referencia, fecha_memo: editar.fecha_memo,
        observaciones: editar.observaciones, estado: editar.estado } });
      toast('Memo actualizado');
      setEditar(null); load();
    } catch (e) { toast(e.message, true); }
  });

  const eliminarMemo = () => correr(async () => {
    try {
      await api(`/memos/${eliminar.id}`, { method: 'DELETE' });
      toast(`${eliminar.folio} eliminado`);
      setEliminar(null); load();
    } catch (e) { toast(e.message, true); }
  });

  async function abrirDetalle(m) {
    try { setDetalle(await api(`/memos/${m.id}`)); }
    catch (e) { toast(e.message, true); }
  }

  async function verDocumento(m) {
    try {
      const r = await api(`/memos/${m.id}/documento`);
      if (!r.url) return toast('Este memo no tiene documento adjunto', true);
      window.open(r.url, '_blank', 'noreferrer');
    } catch (e) { toast(e.message, true); }
  }

  // Conciliación de terreno: confirma si el componente declarado apareció.
  const marcarTerreno = () => correr(async () => {
    const { componente, encontrado } = terreno;
    if (!encontrado && !nota.trim()) return toast('Indique por qué no se encontró', true);
    try {
      await api(`/componentes/${componente.id}/terreno`, { method: 'POST', body: { encontrado, nota: nota.trim() } });
      toast(encontrado ? `${componente.codigo} confirmado en terreno` : `${componente.codigo} marcado como no encontrado`);
      setTerreno(null); setNota('');
      setDetalle(await api(`/memos/${detalle.id}`));
      load();
    } catch (e) { toast(e.message, true); }
  });

  return (
    <div>
      <PageHead eyebrow={EYEBROW} title="Memos de baja"
        sub="El memo firmado del área usuaria autoriza enajenar los componentes y declara la lista que se concilia en terreno.">
        {esMEL && <button className="btn primary" onClick={() => { setNuevo(true); setF({ ...vacio, fecha_memo: hoyISO() }); }}>+ Cargar memo</button>}
      </PageHead>

      <div className="card"><div className="tbl-wrap"><table>
        <thead><tr>
          <th>Folio</th><th>Área usuaria generadora</th><th>Fecha</th>
          <th className="num">Componentes</th><th>Identificación en terreno</th><th>Estado</th><th className="acc"></th>
        </tr></thead>
        <tbody>
          {rows.map((m) => {
            const [tono, txt] = ESTADO[m.estado] ?? ['neutral', m.estado];
            const confirmados = m.componentes - m.por_identificar - m.no_encontrados;
            return (
              <tr key={m.id}>
                <td><b className="mono">{m.folio}</b>{m.referencia && <><br /><small style={{ color: 'var(--muted)' }}>Ref. {m.referencia}</small></>}</td>
                <td>{m.area_usuaria}{m.emitido_por && <><br /><small style={{ color: 'var(--muted)' }}>Firma: {m.emitido_por}</small></>}</td>
                <td className="mono">{m.fecha_memo}</td>
                <td className="num">{m.componentes}</td>
                <td>
                  {m.componentes === 0 ? <small style={{ color: 'var(--muted)' }}>Sin componentes cargados</small> : (<>
                    <small>{confirmados} confirmado(s)</small>
                    {m.por_identificar > 0 && <> · <small style={{ color: 'var(--warn-tx)', fontWeight: 600 }}>{m.por_identificar} por identificar</small></>}
                    {m.no_encontrados > 0 && <> · <small style={{ color: 'var(--bad-tx)', fontWeight: 600 }}>{m.no_encontrados} no encontrado(s)</small></>}
                  </>)}
                </td>
                <td><Chip tone={tono}>{txt}</Chip></td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn sm" onClick={() => abrirDetalle(m)}>Ver</button>{' '}
                  {m.doc > 0 && <button className="btn sm" onClick={() => verDocumento(m)}>Documento</button>}{' '}
                  {esMEL && <button className="btn sm" onClick={() => setEditar({ ...m, emitido_por: m.emitido_por ?? '', referencia: m.referencia ?? '', observaciones: m.observaciones ?? '' })}>Editar</button>}{' '}
                  {esMEL && m.componentes === 0 && <button className="btn sm danger" onClick={() => setEliminar(m)}>Eliminar</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
        {rows.length === 0 && (
          <Empty title="Sin memos cargados">
            {esMEL ? 'Cargue el memo firmado del área usuaria para dar origen al inventario obsoleto.'
                   : 'El coordinador aún no ha cargado memos de baja.'}
          </Empty>
        )}
      </div>
      <div className="audit-note" style={{ marginTop: 12 }}>
        ⚙ Los componentes se cargan desde el inventario indicando su memo. Nacen «por identificar» y quedan disponibles para publicar recién cuando se confirman en terreno.
      </div>

      {/* ---- carga ---- */}
      <Modal open={nuevo} title="Cargar memo de baja" onClose={() => setNuevo(false)}
        footer={<>
          <button className="btn" onClick={() => setNuevo(false)} disabled={busy}>Cancelar</button>
          <button className="btn primary" onClick={crear} disabled={busy}>{busy ? 'Cargando…' : 'Cargar memo'}</button>
        </>}>
        <CamposMemo v={f} set={setF} conArchivo />
      </Modal>

      {/* ---- edición ---- */}
      <Modal open={!!editar} title={editar && `Editar ${editar.folio}`} onClose={() => setEditar(null)}
        footer={<>
          <button className="btn" onClick={() => setEditar(null)} disabled={busy}>Cancelar</button>
          <button className="btn primary" onClick={guardarEdicion} disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
        </>}>
        {editar && <>
          <CamposMemo v={editar} set={setEditar} />
          <Field label="Estado del memo" hint="«Cerrado» cuando toda la lista quedó conciliada en terreno.">
            <Select value={editar.estado} onChange={(e) => setEditar({ ...editar, estado: e.target.value })}>
              <option value="recibido">Recibido</option>
              <option value="en_identificacion">En identificación</option>
              <option value="cerrado">Cerrado</option>
            </Select>
          </Field>
        </>}
      </Modal>

      {/* ---- eliminar ---- */}
      <Modal open={!!eliminar} title="Eliminar memo" onClose={() => setEliminar(null)}
        footer={<>
          <button className="btn" onClick={() => setEliminar(null)} disabled={busy}>Cancelar</button>
          <button className="btn danger" onClick={eliminarMemo} disabled={busy}>{busy ? 'Eliminando…' : 'Eliminar'}</button>
        </>}>
        <p style={{ marginTop: 0 }}>¿Eliminar el memo <b>{eliminar?.folio}</b> de {eliminar?.area_usuaria}? Se borra también el documento adjunto.</p>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>Solo se pueden eliminar memos que aún no tienen componentes asociados.</p>
      </Modal>

      {/* ---- detalle + conciliación de terreno ---- */}
      <Modal open={!!detalle} title={detalle && `${detalle.folio} · ${detalle.area_usuaria}`} onClose={() => setDetalle(null)} ancho>
        {detalle && <>
          <div className="grid g2" style={{ gap: 0, columnGap: 14, marginBottom: 6 }}>
            <Field label="Fecha del memo"><div className="mono">{detalle.fecha_memo}</div></Field>
            <Field label="Emitido por"><div>{detalle.emitido_por || '—'}</div></Field>
          </div>
          {detalle.observaciones && <Field label="Observaciones"><div style={{ color: 'var(--ink-2)' }}>{detalle.observaciones}</div></Field>}

          <h4 style={{ margin: '16px 0 8px', fontSize: 13 }}>Componentes declarados ({detalle.componentes.length})</h4>
          <div className="tbl-wrap"><table>
            <thead><tr><th>Código SAP</th><th>Componente</th><th>Sitio</th><th>Estado</th><th className="acc"></th></tr></thead>
            <tbody>
              {detalle.componentes.map((c) => {
                const [tono, txt] = EST_COMP[c.estado] ?? ['neutral', c.estado];
                return (
                  <tr key={c.id}>
                    <td className="mono">{c.codigo}</td>
                    <td>{c.nombre}{c.nota_terreno && <><br /><small style={{ color: 'var(--muted)' }}>{c.nota_terreno}</small></>}</td>
                    <td>{c.sitio || '—'}</td>
                    <td><Chip tone={tono}>{txt}</Chip></td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      {['por_identificar', 'no_encontrado'].includes(c.estado) && (
                        <button className="btn sm" onClick={() => { setTerreno({ componente: c, encontrado: true }); setNota(''); }}>Encontrado</button>
                      )}{' '}
                      {c.estado === 'por_identificar' && (
                        <button className="btn sm danger" onClick={() => { setTerreno({ componente: c, encontrado: false }); setNota(''); }}>No encontrado</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
          {detalle.componentes.length === 0 && (
            <Empty title="Sin componentes">Cargue los componentes de este memo desde el inventario.</Empty>
          )}
        </>}
      </Modal>

      {/* ---- confirmación de terreno ---- */}
      <Modal open={!!terreno} title={terreno?.encontrado ? 'Confirmar en terreno' : 'Componente no encontrado'} onClose={() => setTerreno(null)}
        footer={<>
          <button className="btn" onClick={() => setTerreno(null)} disabled={busy}>Cancelar</button>
          <button className={`btn ${terreno?.encontrado ? 'primary' : 'danger'}`} onClick={marcarTerreno} disabled={busy}>
            {busy ? 'Guardando…' : terreno?.encontrado ? 'Confirmar' : 'Registrar como no encontrado'}
          </button>
        </>}>
        <p style={{ marginTop: 0 }}>
          <b>{terreno?.componente.nombre}</b> ({terreno?.componente.codigo})
        </p>
        <p style={{ color: 'var(--ink-2)', fontSize: 13.5 }}>
          {terreno?.encontrado
            ? 'El componente fue identificado en terreno y queda disponible para transferir a la zona de consolidación y publicar.'
            : 'El memo lo declara, pero no apareció en terreno. Queda registrado como no encontrado y no se puede publicar.'}
        </p>
        <Field label={terreno?.encontrado ? 'Nota de terreno' : 'Motivo'}
          hint={terreno?.encontrado ? 'Opcional.' : 'Obligatorio: qué se revisó y qué se encontró en su lugar.'}>
          <textarea rows="2" value={nota} onChange={(e) => setNota(e.target.value)}
            placeholder={terreno?.encontrado ? 'Ubicado en patio A-1, completo.' : 'Revisado sector B-3; no está en la ubicación declarada.'} />
        </Field>
      </Modal>
    </div>
  );
}

// Campos compartidos entre carga y edición del memo.
function CamposMemo({ v, set, conArchivo }) {
  return (<>
    <div className="grid g2" style={{ gap: 0, columnGap: 14 }}>
      <Field label="Área usuaria generadora" hint="Área de MEL que emite el memo y autoriza la baja.">
        <input value={v.area_usuaria} onChange={(e) => set({ ...v, area_usuaria: e.target.value })} placeholder="Mantención Planta Concentradora" />
      </Field>
      <Field label="Emitido por" hint="Quien firma el memo.">
        <input value={v.emitido_por} onChange={(e) => set({ ...v, emitido_por: e.target.value })} placeholder="Nombre y cargo" />
      </Field>
    </div>
    <div className="grid g2" style={{ gap: 0, columnGap: 14 }}>
      <Field label="Referencia del memo" hint="Número o código interno del área. Opcional.">
        <input value={v.referencia} onChange={(e) => set({ ...v, referencia: e.target.value })} placeholder="MEM-MPC-2026-114" />
      </Field>
      <Field label="Fecha del memo">
        <DateField value={v.fecha_memo} onChange={(e) => set({ ...v, fecha_memo: e.target.value })} />
      </Field>
    </div>
    <Field label="Observaciones" hint="Contexto de la baja. Opcional.">
      <textarea rows="2" value={v.observaciones} onChange={(e) => set({ ...v, observaciones: e.target.value })}
        placeholder="Equipos retirados de servicio en la detención mayor de septiembre." />
    </Field>
    {conArchivo && (
      <Field label="Memo firmado" hint="PDF o foto del memo escaneado. Es el respaldo de la autorización.">
        <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp"
          onChange={(e) => set({ ...v, doc: e.target.files[0] || null })} />
        {v.doc && <small style={{ color: 'var(--muted)', display: 'block', marginTop: 6 }}>📄 {v.doc.name}</small>}
      </Field>
    )}
  </>);
}
