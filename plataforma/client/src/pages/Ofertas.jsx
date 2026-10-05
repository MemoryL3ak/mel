import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fmtUSD } from '../api.js';
import { Select, Chip, Empty, Field, Modal, PageHead, Tabs, useToast } from '../ui.jsx';

const EYEBROW = 'Fase 2 · Venta de obsoletos';
const DD = { aprobada: ['ok', 'Aprobada'], pendiente: ['warn', 'En revisión'], rechazada: ['bad', 'Rechazada'] };
const EST_ADJ = { adjudicada: ['info', 'Adjudicada'], pagada: ['warn', 'Pagada'], entregada: ['ok', 'Entregada'] };

export default function Ofertas() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState('adjudicar');
  const [pubs, setPubs] = useState([]);
  const [criterios, setCriterios] = useState([]);
  const [adjudicaciones, setAdjudicaciones] = useState([]);
  const [pubId, setPubId] = useState(params.get('pub') ?? '');
  const [ofertas, setOfertas] = useState(null);
  const [puntajes, setPuntajes] = useState({});   // { ofertaId: { criterioId: 1..10 } }
  const [ganadorSel, setGanadorSel] = useState('');
  const [pesos, setPesos] = useState({});         // edición de ponderaciones
  const [nombres, setNombres] = useState({});     // edición del nombre del criterio
  const [nuevoCrit, setNuevoCrit] = useState({ nombre: '', peso: '' });
  const [pago, setPago] = useState(null);
  const [entrega, setEntrega] = useState(null);
  const [cert, setCert] = useState(null);
  const toast = useToast();

  const load = () => {
    api('/publicaciones').then((r) => setPubs(r.filter((p) => p.estado === 'activa' && p.ofertas > 0))).catch((e) => toast(e.message, true));
    api('/criterios').then((c) => { setCriterios(c); setPesos(Object.fromEntries(c.map((x) => [x.id, x.peso]))); setNombres(Object.fromEntries(c.map((x) => [x.id, x.nombre]))); }).catch(() => {});
    api('/adjudicaciones').then(setAdjudicaciones).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!pubId) { setOfertas(null); return; }
    api(`/publicaciones/${pubId}/ofertas`).then((r) => {
      setOfertas(r.ofertas);
      // Puntaje inicial 5 para cada oferta/criterio.
      setPuntajes(Object.fromEntries(r.ofertas.map((o) => [o.id, Object.fromEntries(criterios.map((c) => [c.id, 5]))])));
      setGanadorSel('');
    }).catch((e) => toast(e.message, true));
  }, [pubId, criterios.length]);

  const pesoTotal = criterios.reduce((a, c) => a + c.peso, 0) || 1;
  const totales = useMemo(() => {
    if (!ofertas) return {};
    const t = {};
    for (const o of ofertas) {
      const pj = puntajes[o.id] || {};
      const suma = criterios.reduce((a, c) => a + (Number(pj[c.id]) || 0) * c.peso, 0);
      t[o.id] = Math.round((suma / pesoTotal) * 100) / 100;
    }
    return t;
  }, [ofertas, puntajes, criterios, pesoTotal]);

  const recomendado = useMemo(() => {
    if (!ofertas?.length) return null;
    return [...ofertas].sort((a, b) => (totales[b.id] ?? 0) - (totales[a.id] ?? 0))[0]?.id ?? null;
  }, [ofertas, totales]);

  const pub = pubs.find((p) => String(p.id) === String(pubId));
  const setPj = (oId, cId, v) => setPuntajes((s) => ({ ...s, [oId]: { ...s[oId], [cId]: v } }));

  async function adjudicar() {
    const ganador = ganadorSel || recomendado;
    if (!ganador) return toast('No hay oferta que adjudicar', true);
    try {
      const a = await api(`/publicaciones/${pubId}/adjudicar`, { method: 'POST', body: { oferta_id: Number(ganador), puntajes } });
      toast(`Adjudicado · certificado ${a.cert_folio} emitido`);
      setPubId(''); setParams({}); load(); setTab('certificados');
    } catch (e) { toast(e.message, true); }
  }

  async function guardarPesos() {
    try {
      const c = await api('/criterios', { method: 'PATCH', body: {
        pesos: criterios.map((x) => ({ id: x.id, peso: Number(pesos[x.id]), nombre: nombres[x.id] ?? x.nombre })),
      } });
      setCriterios(c); sincronizar(c); toast('Matriz actualizada');
    } catch (e) { toast(e.message, true); }
  }

  // La matriz no es fija: se pueden renombrar los criterios, agregar los que
  // falten y sacar los que no apliquen. Cambiarla no toca lo ya adjudicado,
  // porque cada certificado guarda su propia copia congelada.
  const sincronizar = (c) => {
    setPesos(Object.fromEntries(c.map((x) => [x.id, x.peso])));
    setNombres(Object.fromEntries(c.map((x) => [x.id, x.nombre])));
  };
  async function agregarCriterio() {
    const nombre = (nuevoCrit.nombre || '').trim();
    if (!nombre) return toast('Indique el nombre del criterio', true);
    try {
      await api('/criterios', { method: 'POST', body: { nombre, peso: Number(nuevoCrit.peso) || 0 } });
      const c = await api('/criterios');
      setCriterios(c); sincronizar(c); setNuevoCrit({ nombre: '', peso: '' });
      toast(`Criterio «${nombre}» agregado`);
    } catch (e) { toast(e.message, true); }
  }
  async function quitarCriterio(x) {
    try {
      await api(`/criterios/${x.id}`, { method: 'DELETE' });
      const c = await api('/criterios');
      setCriterios(c); sincronizar(c);
      toast(`Criterio «${x.nombre}» quitado de la matriz`);
    } catch (e) { toast(e.message, true); }
  }

  async function verActa(a) {
    try {
      const r = await api(`/adjudicaciones/${a.id}/acta`);
      if (!r.archivos?.length) return toast('Esta entrega no tiene acta adjunta', true);
      for (const x of r.archivos) window.open(x.url, '_blank', 'noreferrer');
    } catch (e) { toast(e.message, true); }
  }

  async function registrarPago() {
    try {
      await api(`/adjudicaciones/${pago.id}/pago`, { method: 'POST', body: { pago_ref: pago.ref } });
      toast('Pago registrado'); setPago(null); load();
    } catch (e) { toast(e.message, true); }
  }
  async function registrarEntrega() {
    try {
      // Viaja como formulario para poder adjuntar el acta firmada.
      const fd = new FormData();
      fd.append('guia_folio', entrega.guia ?? '');
      for (const a of entrega.acta ?? []) fd.append('acta', a);
      await api(`/adjudicaciones/${entrega.id}/entrega`, { method: 'POST', body: fd });
      toast('Entrega registrada'); setEntrega(null); load();
    } catch (e) { toast(e.message, true); }
  }

  const sumaPesos = Object.values(pesos).reduce((a, v) => a + (Number(v) || 0), 0);

  return (
    <div>
      <PageHead eyebrow={EYEBROW} title="Ofertas y adjudicación"
        sub="Cuadro comparativo y matriz de evaluación ponderada. Los puntajes se recalculan en vivo; la matriz queda congelada en el certificado." />
      <Tabs tabs={[['adjudicar', 'Adjudicar', pubs.length], ['certificados', 'Certificados'], ['matriz', 'Matriz de evaluación']]} active={tab} onChange={setTab} />

      {tab === 'adjudicar' && (<>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-b">
            <Field label="Publicación a evaluar">
              <Select value={pubId} onChange={(e) => { setPubId(e.target.value); setParams(e.target.value ? { pub: e.target.value } : {}); }}>
                <option value="">— Elija una publicación con ofertas —</option>
                {pubs.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.componente} ({p.ofertas} oferta{p.ofertas === 1 ? '' : 's'})</option>)}
              </Select>
            </Field>
          </div>
        </div>

        {pub && ofertas && (<>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-h"><h3>Cuadro comparativo · {pub.componente}</h3><small>{ofertas.length} oferta(s)</small></div>
            <div className="tbl-wrap"><table>
              <thead><tr><th>Oferente</th><th>Due diligence</th><th className="num">Monto ofertado</th><th>Plazo de retiro</th><th>Forma de pago</th></tr></thead>
              <tbody>
                {ofertas.map((o) => {
                  const [tono, txt] = DD[o.dd_estado] ?? ['neutral', '—'];
                  return (
                    <tr key={o.id}>
                      <td><b>{o.oferente}</b>{o.comentarios && <><br /><small style={{ color: 'var(--muted)' }}>{o.comentarios}</small></>}</td>
                      <td><Chip tone={tono}>{txt}</Chip></td>
                      <td className="num">{fmtUSD(o.monto)}</td>
                      <td>{o.plazo_retiro || '—'}</td>
                      <td>{o.forma_pago || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          </div>

          <div className="card">
            <div className="card-h"><h3>Matriz de evaluación</h3><small>puntaje 1–10 por criterio · ponderado en vivo</small></div>
            <div className="tbl-wrap"><table>
              <thead><tr><th>Criterio</th><th className="num">Peso</th>{ofertas.map((o) => <th key={o.id} className="num">{o.oferente}</th>)}</tr></thead>
              <tbody>
                {criterios.map((c) => (
                  <tr key={c.id}>
                    <td>{c.nombre}</td><td className="num">{c.peso}%</td>
                    {ofertas.map((o) => (
                      <td key={o.id} className="num">
                        <input type="number" min="1" max="10" style={{ width: 60 }}
                          value={puntajes[o.id]?.[c.id] ?? ''} onChange={(e) => setPj(o.id, c.id, e.target.value)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 800, borderTop: '2px solid var(--line)' }}>
                  <td>Puntaje ponderado</td><td></td>
                  {ofertas.map((o) => (
                    <td key={o.id} className="num" style={o.id === recomendado ? { color: 'var(--ok-tx, #3E8E5A)' } : undefined}>
                      {totales[o.id]?.toFixed(2) ?? '—'}{o.id === recomendado ? ' ★' : ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table></div>
            <div className="card-b" style={{ borderTop: '1px solid var(--line-2)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <Field label="Adjudicar a">
                <Select value={ganadorSel} onChange={(e) => setGanadorSel(e.target.value)}>
                  <option value="">Recomendado por la matriz{recomendado ? ` · ${ofertas.find((o) => o.id === recomendado)?.oferente}` : ''}</option>
                  {ofertas.map((o) => <option key={o.id} value={o.id}>{o.oferente} · {fmtUSD(o.monto)}</option>)}
                </Select>
              </Field>
              <button className="btn primary" onClick={adjudicar} style={{ alignSelf: 'flex-end' }}>Emitir certificado de adjudicación</button>
            </div>
          </div>
        </>)}
        {pubs.length === 0 && <Empty title="Sin publicaciones con ofertas">Cuando una publicación reciba ofertas, aparecerá aquí para evaluar y adjudicar.</Empty>}
      </>)}

      {tab === 'certificados' && (
        <div className="card"><div className="tbl-wrap"><table>
          <thead><tr><th>Certificado</th><th>Componente</th><th>Comprador</th><th className="num">Monto</th><th className="num">Comisión vendor</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {adjudicaciones.map((a) => {
              const [tono, txt] = EST_ADJ[a.estado] ?? ['neutral', a.estado];
              return (
                <tr key={a.id}>
                  <td className="mono"><button className="btn sm" onClick={() => setCert(a)}>{a.cert_folio}</button></td>
                  <td><b>{a.componente}</b><br /><small className="mono" style={{ color: 'var(--muted)' }}>{a.codigo}</small></td>
                  <td>{a.comprador}</td>
                  <td className="num">{fmtUSD(a.monto)}</td>
                  <td className="num">{fmtUSD(a.comision_monto)}<br /><small style={{ color: 'var(--muted)' }}>{a.comision_pct}%</small></td>
                  <td><Chip tone={tono}>{txt}</Chip></td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    {a.estado === 'adjudicada' && <button className="btn sm primary" onClick={() => setPago({ id: a.id, ref: '' })}>Registrar pago</button>}
                    {a.estado === 'pagada' && <button className="btn sm primary" onClick={() => setEntrega({ id: a.id, guia: '', acta: [] })}>Registrar entrega</button>}
                    {a.estado === 'entregada' && a.entrega_docs > 0 && (
                      <button className="btn sm" onClick={() => verActa(a)}>Acta ({a.entrega_docs})</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
          {adjudicaciones.length === 0 && <Empty title="Sin adjudicaciones">Los certificados de adjudicación aparecerán aquí con su flujo de pago y entrega.</Empty>}
        </div>
      )}

      {tab === 'matriz' && (
        <div className="card">
          <div className="card-h"><h3>Criterios y ponderaciones</h3><small>suman {sumaPesos}% · configurable</small></div>
          <div className="tbl-wrap"><table>
            <thead><tr><th>Criterio</th><th className="num">Peso (%)</th><th className="acc"></th></tr></thead>
            <tbody>
              {criterios.map((c) => (
                <tr key={c.id}>
                  <td><input value={nombres[c.id] ?? c.nombre} style={{ width: '100%' }}
                    onChange={(e) => setNombres({ ...nombres, [c.id]: e.target.value })} /></td>
                  <td className="num"><input type="number" min="0" max="100" style={{ width: 80 }}
                    value={pesos[c.id] ?? ''} onChange={(e) => setPesos({ ...pesos, [c.id]: e.target.value })} /></td>
                  <td className="num">
                    <button className="btn sm danger" onClick={() => quitarCriterio(c)} title="Quitar de la matriz">Quitar</button>
                  </td>
                </tr>
              ))}
              <tr>
                <td><input value={nuevoCrit.nombre} placeholder="Nuevo criterio…" style={{ width: '100%' }}
                  onChange={(e) => setNuevoCrit({ ...nuevoCrit, nombre: e.target.value })} /></td>
                <td className="num"><input type="number" min="0" max="100" style={{ width: 80 }}
                  value={nuevoCrit.peso} placeholder="0"
                  onChange={(e) => setNuevoCrit({ ...nuevoCrit, peso: e.target.value })} /></td>
                <td className="num">
                  <button className="btn sm" onClick={agregarCriterio} disabled={!nuevoCrit.nombre.trim()}>Agregar</button>
                </td>
              </tr>
            </tbody>
          </table></div>
          <div className="card-b" style={{ borderTop: '1px solid var(--line-2)' }}>
            <button className="btn primary" onClick={guardarPesos}>Guardar cambios</button>
            <small style={{ color: 'var(--muted)', marginLeft: 12 }}>
              El puntaje se calcula sobre la suma de pesos, así que no es obligatorio que sumen 100%.
              Cambiar la matriz <b>no altera lo ya adjudicado</b>: cada certificado guarda la suya congelada.
            </small>
          </div>
        </div>
      )}

      <Modal open={!!pago} title="Registrar pago por transferencia" onClose={() => setPago(null)}
        footer={<><button className="btn" onClick={() => setPago(null)}>Cancelar</button><button className="btn primary" onClick={registrarPago}>Registrar pago</button></>}>
        <Field label="Referencia del abono (opcional)" hint="N° de transferencia o comprobante.">
          <input value={pago?.ref ?? ''} onChange={(e) => setPago({ ...pago, ref: e.target.value })} placeholder="TRX-…" />
        </Field>
      </Modal>

      <Modal open={!!entrega} title="Registrar entrega y retiro" onClose={() => setEntrega(null)}
        footer={<><button className="btn" onClick={() => setEntrega(null)}>Cancelar</button><button className="btn primary" onClick={registrarEntrega}>Registrar entrega</button></>}>
        <Field label="N° de guía de despacho (opcional)" hint="La guía física con que se coordina el retiro en terreno.">
          <input value={entrega?.guia ?? ''} onChange={(e) => setEntrega({ ...entrega, guia: e.target.value })} placeholder="458…" />
        </Field>
        <Field label="Acta de entrega firmada"
          hint="PDF o foto del documento que firma el comprador al retirar. Es el respaldo de que el activo salió.">
          <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={(e) => setEntrega({ ...entrega, acta: Array.from(e.target.files).slice(0, 3) })} />
          {entrega?.acta?.length > 0 && (
            <small style={{ color: 'var(--muted)', display: 'block', marginTop: 6 }}>{entrega.acta.length} documento(s) listo(s).</small>
          )}
        </Field>
      </Modal>

      <Modal open={!!cert} title={cert && `Certificado ${cert.cert_folio}`} onClose={() => setCert(null)} ancho>
        {cert && (<>
          <p style={{ marginTop: 0 }}>Componente <b>{cert.componente}</b> (<span className="mono">{cert.codigo}</span>) adjudicado a <b>{cert.comprador}</b> por <b>{fmtUSD(cert.monto)}</b>.</p>
          <p style={{ color: 'var(--ink-2)' }}>Comisión al vendor: {fmtUSD(cert.comision_monto)} ({cert.comision_pct}%). Emitido el {cert.creado_el?.slice(0, 10)} por {cert.creado_por}.</p>
          {cert.matriz?.criterios && (
            <div className="tbl-wrap"><table>
              <thead><tr><th>Criterio</th><th className="num">Peso</th>{cert.matriz.ofertas.map((o) => <th key={o.oferta_id} className="num">{o.oferente}</th>)}</tr></thead>
              <tbody>
                {cert.matriz.criterios.map((c) => (
                  <tr key={c.id}><td>{c.nombre}</td><td className="num">{c.peso}%</td>
                    {cert.matriz.ofertas.map((o) => <td key={o.oferta_id} className="num">{o.puntajes?.[c.id] ?? '—'}</td>)}
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{ fontWeight: 800, borderTop: '2px solid var(--line)' }}>
                <td>Puntaje ponderado</td><td></td>
                {cert.matriz.ofertas.map((o) => <td key={o.oferta_id} className="num">{o.total?.toFixed(2)}{o.oferta_id === cert.matriz.ganador ? ' ★' : ''}</td>)}
              </tr></tfoot>
            </table></div>
          )}
        </>)}
      </Modal>
    </div>
  );
}
