import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fmtUSD, fmtCLP } from '../api.js';
import { Select, Chip, Empty, Field, Modal, PageHead, Tabs, DateField, hoyISO, useToast } from '../ui.jsx';
import BotonDocs from '../BotonDocs.jsx';

const EYEBROW = 'Venta de obsoletos';
const DD = { aprobada: ['ok', 'Aprobada'], pendiente: ['warn', 'En revisión'], rechazada: ['bad', 'Rechazada'] };
// Un monto en la moneda en que se ofertó: las ofertas llegan en dólares o en pesos.
const dinero = (monto, moneda) => (moneda === 'CLP' ? fmtCLP(monto) : fmtUSD(monto));
const EST_ADJ = { adjudicada: ['info', 'Adjudicada'], pagada: ['warn', 'Pagada'], entregada: ['ok', 'Entregada'] };

// Documentos que se adjuntan al registrar la entrega: [campo, etiqueta, ayuda].
// Los tres son obligatorios; el servidor también los exige.
const DOCS_ENTREGA = [
  ['guia', 'Guía de despacho', 'PDF o foto de la guía con que el componente sale de MEL.'],
  ['factura', 'Factura de venta', 'PDF de la factura emitida al comprador.'],
  ['acta', 'Documento firmado de entrega', 'PDF o foto del documento que firma el comprador al retirar.'],
];

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
  const [docsEntrega, setDocsEntrega] = useState(null);
  const [cert, setCert] = useState(null);
  const [activas, setActivas] = useState([]);       // publicaciones vigentes, tengan o no ofertas
  const [compradores, setCompradores] = useState([]);
  const [manual, setManual] = useState(null);       // oferta que se ingresa a mano
  const [guardando, setGuardando] = useState(false);
  const [recarga, setRecarga] = useState(0);        // vuelve a leer las ofertas de la publicación abierta
  const toast = useToast();

  const load = () => {
    api('/publicaciones').then((r) => {
      setPubs(r.filter((p) => p.estado === 'activa' && p.ofertas > 0));
      setActivas(r.filter((p) => p.estado === 'activa' && !p.vencido));
    }).catch((e) => toast(e.message, true));
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
  }, [pubId, criterios.length, recarga]);

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

  // Oferta recibida fuera del portal (correo, plataforma de venta): la ingresa
  // la administración para poder compararla y adjudicar igual que las demás.
  const manualVacia = (pub = '') => ({
    publicacion_id: pub, comprador_id: '', razon_social: '', rut: '', email: '', telefono: '',
    monto: '', moneda: 'USD', recibida_el: hoyISO(), plazo_retiro: '', forma_pago: '', comentarios: '', respaldo: [],
  });
  function abrirManual() {
    setManual(manualVacia(activas.some((p) => String(p.id) === String(pubId)) ? String(pubId) : ''));
    api('/compradores').then(setCompradores).catch(() => {});
  }
  async function guardarManual() {
    const m = manual;
    if (!m.publicacion_id) return toast('Elija la publicación a la que corresponde la oferta', true);
    if (!m.comprador_id && !m.razon_social.trim()) return toast('Indique quién presenta la oferta', true);
    if (!m.comprador_id && m.rut.replace(/[.\s]/g, '').length < 8) return toast('Ingrese el RUT del oferente', true);
    if (!(Number(m.monto) > 0)) return toast('Ingrese el monto de la oferta', true);
    setGuardando(true);
    try {
      // Viaja como formulario porque puede traer el respaldo de la oferta.
      const fd = new FormData();
      for (const k of ['comprador_id', 'razon_social', 'rut', 'email', 'telefono', 'monto', 'moneda', 'recibida_el', 'plazo_retiro', 'forma_pago', 'comentarios']) {
        fd.append(k, String(m[k] ?? '').trim());
      }
      for (const a of m.respaldo) fd.append('respaldo', a);
      const r = await api(`/publicaciones/${m.publicacion_id}/ofertas`, { method: 'POST', body: fd });
      toast(`Oferta de ${r.comprador} ingresada`);
      setManual(null);
      // Queda lista para evaluar: se abre la publicación en el cuadro comparativo.
      setTab('adjudicar'); setPubId(String(m.publicacion_id)); setParams({ pub: String(m.publicacion_id) });
      setRecarga((n) => n + 1); load();
    } catch (e) { toast(e.message, true); }
    finally { setGuardando(false); }
  }

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

  // Documentos de la entrega en un modal con enlaces rotulados: abrir varias
  // pestañas a la vez lo bloquea el navegador.
  async function verActa(a) {
    try {
      const r = await api(`/adjudicaciones/${a.id}/acta`);
      if (!r.archivos?.length) return toast('Esta entrega no tiene documentos adjuntos', true);
      setDocsEntrega({ cert_folio: a.cert_folio, archivos: r.archivos });
    } catch (e) { toast(e.message, true); }
  }

  async function registrarPago() {
    try {
      // Viaja como formulario porque puede traer el respaldo de la transferencia.
      const fd = new FormData();
      fd.append('pago_ref', pago.ref ?? '');
      for (const a of pago.docs ?? []) fd.append('pago', a);
      await api(`/adjudicaciones/${pago.id}/pago`, { method: 'POST', body: fd });
      toast(pago.docs?.length ? 'Pago registrado con su respaldo' : 'Pago registrado'); setPago(null); load();
    } catch (e) { toast(e.message, true); }
  }
  async function registrarEntrega() {
    const faltan = DOCS_ENTREGA.filter(([k]) => !entrega.docs?.[k]?.length).map(([, etiqueta]) => etiqueta.toLowerCase());
    if (faltan.length) return toast(`Para registrar la entrega adjunte: ${faltan.join(', ')}`, true);
    try {
      // Viaja como formulario con los tres documentos de la entrega.
      const fd = new FormData();
      fd.append('guia_folio', entrega.guia ?? '');
      for (const [k] of DOCS_ENTREGA) for (const a of entrega.docs[k]) fd.append(k, a);
      await api(`/adjudicaciones/${entrega.id}/entrega`, { method: 'POST', body: fd });
      toast('Entrega registrada'); setEntrega(null); load();
    } catch (e) { toast(e.message, true); }
  }

  const sumaPesos = Object.values(pesos).reduce((a, v) => a + (Number(v) || 0), 0);

  return (
    <div>
      <PageHead eyebrow={EYEBROW} title="Ofertas y adjudicación"
        sub="Cuadro comparativo y matriz de evaluación ponderada. Los puntajes se recalculan en vivo; la matriz queda congelada en el certificado.">
        <button className="btn primary" onClick={abrirManual}
          title="Para ofertas que llegan por correo o por la plataforma de venta, mientras no se oferte por el portal">+ Ingresar oferta recibida</button>
      </PageHead>
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
                      <td><b>{o.oferente}</b>{o.comentarios && <><br /><small style={{ color: 'var(--muted)' }}>{o.comentarios}</small></>}
                        {o.ingresada_por && <><br /><small style={{ color: 'var(--muted)' }}>Ingresada a mano por {o.ingresada_por}{o.recibida_el ? ` · recibida el ${o.recibida_el}` : ''}</small></>}</td>
                      <td><Chip tone={tono}>{txt}</Chip></td>
                      <td className="num">{dinero(o.monto, o.moneda)}
                        {o.moneda === 'CLP' && <><br /><small style={{ color: 'var(--muted)' }}>{fmtUSD(o.monto_usd)}</small></>}</td>
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
                  {ofertas.map((o) => <option key={o.id} value={o.id}>{o.oferente} · {dinero(o.monto, o.moneda)}</option>)}
                </Select>
              </Field>
              <button className="btn primary" onClick={adjudicar} style={{ alignSelf: 'flex-end' }}>Emitir certificado de adjudicación</button>
            </div>
          </div>
        </>)}
        {pubs.length === 0 && <Empty title="Sin publicaciones con ofertas">Cuando una publicación reciba ofertas, aparecerá aquí para evaluar y adjudicar. Si la oferta llegó por correo o por la plataforma de venta, ingrésela con «Ingresar oferta recibida».</Empty>}
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
                  <td className="num">{dinero(a.monto, a.moneda)}</td>
                  <td className="num">{dinero(a.comision_monto, a.moneda)}<br /><small style={{ color: 'var(--muted)' }}>{a.comision_pct}%</small></td>
                  <td><Chip tone={tono}>{txt}</Chip></td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    {a.estado === 'adjudicada' && <button className="btn sm primary" onClick={() => setPago({ id: a.id, cert_folio: a.cert_folio, ref: '', docs: [] })}>Registrar pago</button>}
                    {a.estado === 'pagada' && <button className="btn sm primary" onClick={() => setEntrega({ id: a.id, cert_folio: a.cert_folio, guia: '', docs: {} })}>Registrar entrega</button>}
                    {a.estado === 'entregada' && a.entrega_docs > 0 && (
                      <button className="btn sm" onClick={() => verActa(a)}
                        title="Guía de despacho, factura de venta, documento firmado de entrega y respaldo de transferencia">Entrega ({a.entrega_docs})</button>
                    )}{' '}
                    <BotonDocs hito="adjudicacion" refId={a.id} />
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
                  <td className="num acc">
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

      <Modal open={!!manual} title="Ingresar oferta recibida fuera del portal" onClose={() => setManual(null)} ancho
        footer={<>
          <button className="btn" onClick={() => setManual(null)} disabled={guardando}>Cancelar</button>
          <button className="btn primary" onClick={guardarManual} disabled={guardando}>{guardando ? 'Guardando…' : 'Ingresar oferta'}</button>
        </>}>
        {manual && (<>
          <p style={{ marginTop: 0, color: 'var(--ink-2)', fontSize: 13.5 }}>
            Para las ofertas que llegan por correo o por la plataforma de venta. Queda en el cuadro comparativo junto a las
            del portal, y en la bitácora quién la ingresó.
          </p>
          <Field label="Publicación">
            <Select value={manual.publicacion_id} onChange={(e) => setManual({ ...manual, publicacion_id: e.target.value })}>
              <option value="">— Elija la publicación —</option>
              {activas.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.componente}{p.ofertas ? ` (${p.ofertas} oferta${p.ofertas === 1 ? '' : 's'})` : ''}</option>)}
            </Select>
          </Field>
          {activas.length === 0 && (
            <small style={{ color: 'var(--muted)', display: 'block', marginTop: -6, marginBottom: 12 }}>No hay publicaciones vigentes. Publique el componente primero, o amplíe el plazo si ya se cumplió.</small>
          )}
          <Field label="Oferente" hint="Elija un comprador ya registrado o ingrese uno nuevo. El nuevo queda sin cuenta de portal y con la due diligence en revisión.">
            <Select value={manual.comprador_id} onChange={(e) => setManual({ ...manual, comprador_id: e.target.value })}>
              <option value="">— Nuevo oferente —</option>
              {compradores.filter((c) => c.dd_estado !== 'rechazada').map((c) => <option key={c.id} value={c.id}>{c.razon_social} · {c.rut}</option>)}
            </Select>
          </Field>
          {!manual.comprador_id && (<>
            <div className="grid g2" style={{ gap: 0, columnGap: 14 }}>
              <Field label="Razón social o nombre">
                <input value={manual.razon_social} onChange={(e) => setManual({ ...manual, razon_social: e.target.value })} placeholder="Comercial Ejemplo SpA" />
              </Field>
              <Field label="RUT">
                <input value={manual.rut} onChange={(e) => setManual({ ...manual, rut: e.target.value })} placeholder="76.123.456-7" />
              </Field>
              <Field label="Correo (opcional)">
                <input type="email" value={manual.email} onChange={(e) => setManual({ ...manual, email: e.target.value })} placeholder="contacto@empresa.cl" />
              </Field>
              <Field label="Teléfono (opcional)">
                <input value={manual.telefono} onChange={(e) => setManual({ ...manual, telefono: e.target.value })} placeholder="+56 9 …" />
              </Field>
            </div>
          </>)}
          <div className="grid g2" style={{ gap: 0, columnGap: 14 }}>
            <Field label="Monto ofertado">
              <input type="number" min="0" value={manual.monto} onChange={(e) => setManual({ ...manual, monto: e.target.value })} placeholder="28500" />
            </Field>
            <Field label="Moneda" hint="Una oferta en pesos se compara en dólares, al tipo de cambio del día en que se recibió.">
              <Select value={manual.moneda} onChange={(e) => setManual({ ...manual, moneda: e.target.value })}>
                <option value="USD">Dólares (USD)</option>
                <option value="CLP">Pesos (CLP)</option>
              </Select>
            </Field>
            <Field label="Fecha en que se recibió">
              <DateField value={manual.recibida_el} onChange={(e) => setManual({ ...manual, recibida_el: e.target.value })} />
            </Field>
            <Field label="Plazo de retiro (opcional)">
              <input value={manual.plazo_retiro} onChange={(e) => setManual({ ...manual, plazo_retiro: e.target.value })} placeholder="10 días hábiles" />
            </Field>
          </div>
          <Field label="Forma de pago (opcional)">
            <input value={manual.forma_pago} onChange={(e) => setManual({ ...manual, forma_pago: e.target.value })} placeholder="Transferencia al contado" />
          </Field>
          <Field label="Comentarios (opcional)">
            <textarea rows="2" value={manual.comentarios} onChange={(e) => setManual({ ...manual, comentarios: e.target.value })}
              placeholder="Por dónde llegó la oferta, condiciones, observaciones…" />
          </Field>
          <Field label="Respaldo de la oferta (opcional)" hint="El correo o la cotización recibida, en PDF o imagen. Queda en el repositorio documental de la publicación.">
            <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => setManual({ ...manual, respaldo: Array.from(e.target.files).slice(0, 3) })} />
            {manual.respaldo.length > 0 && (
              <small style={{ color: 'var(--ok-tx)', display: 'block', marginTop: 6 }}>✓ {manual.respaldo.map((f) => f.name).join(', ')}</small>
            )}
          </Field>
        </>)}
      </Modal>

      <Modal open={!!pago} title={pago?.cert_folio ? `Registrar pago por transferencia · ${pago.cert_folio}` : 'Registrar pago por transferencia'} onClose={() => setPago(null)}
        footer={<><button className="btn" onClick={() => setPago(null)}>Cancelar</button><button className="btn primary" onClick={registrarPago}>Registrar pago</button></>}>
        <Field label="Referencia del abono (opcional)" hint="N° de transferencia o comprobante.">
          <input value={pago?.ref ?? ''} onChange={(e) => setPago({ ...pago, ref: e.target.value })} placeholder="TRX-…" />
        </Field>
        <Field label="Respaldo de la transferencia" hint="PDF o imagen del comprobante. Queda con los documentos de la adjudicación y en el repositorio documental.">
          <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={(e) => setPago({ ...pago, docs: Array.from(e.target.files).slice(0, 3) })} />
          {pago?.docs?.length > 0 && (
            <small style={{ color: 'var(--ok-tx)', display: 'block', marginTop: 6 }}>✓ {pago.docs.map((f) => f.name).join(', ')}</small>
          )}
        </Field>
      </Modal>

      <Modal open={!!entrega} title={entrega && `Registrar entrega y retiro · ${entrega.cert_folio}`} onClose={() => setEntrega(null)}
        footer={<>
          <button className="btn" onClick={() => setEntrega(null)}>Cancelar</button>
          <button className="btn primary" onClick={registrarEntrega}
            disabled={!entrega || DOCS_ENTREGA.some(([k]) => !entrega.docs?.[k]?.length)}>Registrar entrega</button>
        </>}>
        <p style={{ marginTop: 0, color: 'var(--ink-2)', fontSize: 13.5 }}>
          Para cerrar la adjudicación se adjuntan los tres documentos del retiro. Quedan también en el repositorio documental.
        </p>
        <Field label="N° de guía de despacho" hint="Opcional: el número de la guía física con que sale el componente.">
          <input value={entrega?.guia ?? ''} onChange={(e) => setEntrega({ ...entrega, guia: e.target.value })} placeholder="458…" />
        </Field>
        {DOCS_ENTREGA.map(([k, etiqueta, ayuda]) => (
          <Field key={k} label={`${etiqueta} · obligatorio`} hint={ayuda}>
            <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => setEntrega({ ...entrega, docs: { ...entrega.docs, [k]: Array.from(e.target.files).slice(0, 3) } })} />
            {entrega?.docs?.[k]?.length > 0 && (
              <small style={{ color: 'var(--ok-tx)', display: 'block', marginTop: 6 }}>✓ {entrega.docs[k].map((f) => f.name).join(', ')}</small>
            )}
          </Field>
        ))}
      </Modal>

      <Modal open={!!docsEntrega} title={docsEntrega && `Documentos de entrega · ${docsEntrega.cert_folio}`} onClose={() => setDocsEntrega(null)}>
        {docsEntrega && (
          <ul className="doc-files">
            {docsEntrega.archivos.map((x, i) => (
              <li key={i}><a href={x.url} target="_blank" rel="noreferrer">📄 {x.etiqueta}</a></li>
            ))}
          </ul>
        )}
      </Modal>

      <Modal open={!!cert} title={cert && `Certificado ${cert.cert_folio}`} onClose={() => setCert(null)} ancho>
        {cert && (<>
          <p style={{ marginTop: 0 }}>Componente <b>{cert.componente}</b> (<span className="mono">{cert.codigo}</span>) adjudicado a <b>{cert.comprador}</b> por <b>{dinero(cert.monto, cert.moneda)}</b>.</p>
          <p style={{ color: 'var(--ink-2)' }}>Comisión al vendor: {dinero(cert.comision_monto, cert.moneda)} ({cert.comision_pct}%). Emitido el {cert.creado_el?.slice(0, 10)} por {cert.creado_por}.</p>
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
