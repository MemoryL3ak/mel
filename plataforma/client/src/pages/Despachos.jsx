import { useEffect, useState } from 'react';
import { api, fmtCLP, fmtKg } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Chip, Empty, Field, Modal, PageHead, Tabs, useToast } from '../ui.jsx';

const CHIP = {
  en_transito: ['info', 'En tránsito'], recepcionado: ['ok', 'Recepcionado'], observado: ['warn', 'Difer. de peso'],
};

export default function Despachos() {
  const [rows, setRows] = useState(null);
  const [traslados, setTraslados] = useState([]);
  const [maestros, setMaestros] = useState(null);
  const [tab, setTab] = useState('d1');
  const [nuevo, setNuevo] = useState(false);
  const [recep, setRecep] = useState(null);
  const [resolver, setResolver] = useState(null);
  const [nuevoTras, setNuevoTras] = useState(false);
  const [recepTras, setRecepTras] = useState(null);
  const [form, setForm] = useState({ patio_id: 1, categoria_id: 1, kg_origen: '', archivos: [] });
  const [detalle, setDetalle] = useState(null);
  const [evidencia, setEvidencia] = useState(null);   // urls firmadas del detalle abierto
  const [rForm, setRForm] = useState({ kg_destino: '', categoria_final_id: '', observacion: '' });
  const [tForm, setTForm] = useState({ categoria_id: 1, kg: '' });
  const [kgLampa, setKgLampa] = useState('');
  const [obs, setObs] = useState('');
  const { user } = useAuth();
  const toast = useToast();

  const load = () => {
    api('/despachos').then(setRows).catch((e) => toast(e.message, true));
    api('/traslados').then(setTraslados).catch(() => {});
  };
  useEffect(() => { load(); api('/maestros').then(setMaestros).catch(() => {}); }, []);
  if (!rows) return <div className="loading">Cargando despachos…</div>;

  const puedeCrear = ['limpieza', 'ito', 'coordinador'].includes(user.role);
  const puedeRecep = ['vendor', 'ito', 'coordinador'].includes(user.role);
  const puedeTras = ['vendor', 'coordinador'].includes(user.role);
  const puedeResolver = ['ito', 'coordinador'].includes(user.role);

  const post = (path, body, okMsg, cierra) => async () => {
    try {
      await api(path, { method: 'POST', body });
      toast(okMsg);
      cierra();
      load();
    } catch (e) { toast(e.message, true); }
  };

  async function crearDespacho() {
    try {
      const fd = new FormData();
      fd.append('patio_id', form.patio_id);
      fd.append('categoria_id', form.categoria_id);
      fd.append('kg_origen', form.kg_origen);
      for (const f of form.archivos) fd.append('fotos', f);
      const d = await api('/despachos', { method: 'POST', body: fd });
      toast(`Despacho ${d.guia} registrado con ${form.archivos.length} foto(s) de evidencia`);
      setNuevo(false); setForm({ patio_id: 1, categoria_id: 1, kg_origen: '', archivos: [] });
      load();
    } catch (e) { toast(e.message, true); }
  }

  function abrirDetalle(d) {
    setDetalle(d);
    setEvidencia(null);
    if (d.fotos > 0) {
      api(`/despachos/${d.id}/evidencia`).then((r) => setEvidencia(r.urls)).catch(() => setEvidencia([]));
    } else {
      setEvidencia([]);
    }
  }

  const enTransito = rows.filter((d) => d.estado === 'en_transito').length;
  const observados = rows.filter((d) => d.estado === 'observado').length;
  const trasTransito = traslados.filter((t) => t.estado === 'en_transito').length;
  const certificados = traslados.filter((t) => t.cert_folio);

  return (
    <div>
      <PageHead title="Despachos y recepciones"
        sub="La cadena completa del material: pesaje en patio MEL, recepción y clasificación en La Negra, traslado a Lampa y certificado de disposición final.">
        {puedeCrear && <button className="btn primary" onClick={() => setNuevo(true)}>+ Registrar despacho</button>}
        {puedeTras && <button className="btn" onClick={() => setNuevoTras(true)}>+ Traslado a Lampa</button>}
      </PageHead>

      {(() => {
        const mesActual = new Date().toISOString().slice(0, 7);
        const dMes = rows.filter((d) => d.fecha?.startsWith(mesActual));
        const tMes = traslados.filter((t) => t.fecha?.startsWith(mesActual));
        return (
          <div className="flow-mini" aria-label="Resumen del flujo del mes">
            <span className="fm"><span className="k">Patios · mes</span><span className="v display">{fmtKg(dMes.reduce((a, d) => a + d.kg_origen, 0))} <small>kg</small></span></span>
            <span className="fm-sep">→</span>
            <span className="fm"><span className="k">La Negra</span><span className="v display">{fmtKg(dMes.reduce((a, d) => a + (d.kg_destino ?? 0), 0))} <small>kg</small></span></span>
            <span className="fm-sep">→</span>
            <span className="fm"><span className="k">Lampa</span><span className="v display">{fmtKg(tMes.reduce((a, t) => a + (t.kg_lampa ?? 0), 0))} <small>kg</small></span></span>
            <span className="fm" style={{ marginLeft: 'auto' }}><span className="k">Certificados</span><span className="v display">{tMes.filter((t) => t.cert_folio).length}</span></span>
          </div>
        );
      })()}

      <Tabs active={tab} onChange={setTab} tabs={[
        ['d1', 'MEL → La Negra', enTransito + observados],
        ['d2', 'Recepciones La Negra'],
        ['d3', 'La Negra → Lampa', trasTransito],
        ['d4', 'Certificados disposición final'],
      ]} />

      {tab === 'd1' && (
        <div className="card"><div className="tbl-wrap"><table>
          <thead><tr><th>Guía</th><th>Fecha</th><th>Patio</th><th>Categoría</th><th className="num">Kg MEL</th><th className="num">Kg La Negra</th><th className="num">Valorización</th><th>Evidencia</th><th>Estado</th><th>EP</th><th></th></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td className="mono">{d.guia}</td><td className="mono">{d.fecha}</td><td>{d.patio}</td>
                <td>{d.categoria}{d.categoria_final && <span style={{ color: 'var(--warn-tx)' }}> → {d.categoria_final}</span>}</td>
                <td className="num">{fmtKg(d.kg_origen)}</td>
                <td className="num">{d.kg_destino != null ? fmtKg(d.kg_destino) : '—'}</td>
                <td className="num">{fmtCLP(d.valor)}</td>
                <td><div className="thumbs">{Array.from({ length: Math.min(d.fotos, 3) }).map((_, i) => <i key={i} />)}</div></td>
                <td><Chip tone={CHIP[d.estado][0]}>{CHIP[d.estado][1]}</Chip></td>
                <td className="mono">{d.ep_folio || '—'}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn sm" onClick={() => abrirDetalle(d)}>Detalle</button>{' '}
                  {d.estado === 'en_transito' && puedeRecep && (
                    <button className="btn sm primary" onClick={() => { setRecep(d); setRForm({ kg_destino: String(d.kg_origen), categoria_final_id: '', observacion: '' }); }}>Recepcionar</button>
                  )}
                  {d.estado === 'observado' && puedeResolver && (
                    <button className="btn sm" onClick={() => { setResolver(d); setObs(''); }}>Resolver</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
          {rows.length === 0 && <Empty title="Sin despachos registrados">El primer despacho desde patios MEL aparecerá aquí con su guía foliada.</Empty>}
        </div>
      )}

      {tab === 'd2' && (
        <div className="card"><div className="tbl-wrap"><table>
          <thead><tr><th>Guía</th><th>Recepción</th><th className="num">Kg MEL</th><th className="num">Kg La Negra</th><th className="num">Diferencia</th><th>Clasificación</th><th>Validación</th><th>Observación</th></tr></thead>
          <tbody>
            {rows.filter((d) => d.kg_destino != null).map((d) => (
              <tr key={d.id}>
                <td className="mono">{d.guia}</td>
                <td>{d.recepcionado_el}</td>
                <td className="num">{fmtKg(d.kg_origen)}</td>
                <td className="num">{fmtKg(d.kg_destino)}</td>
                <td className="num" style={Math.abs(d.dif_pct) > 2 ? { color: 'var(--bad-tx)', fontWeight: 700 } : {}}>{d.dif_pct?.toFixed(2)} %</td>
                <td>{d.categoria_final ? <Chip tone="warn">Reclasificado · {d.categoria_final}</Chip> : d.categoria}</td>
                <td><Chip tone={d.estado === 'observado' ? 'warn' : 'ok'}>{d.estado === 'observado' ? 'Observada' : 'Validada'}</Chip></td>
                <td style={{ color: 'var(--ink-2)', maxWidth: 240 }}>{d.obs_recepcion || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
          {rows.filter((d) => d.kg_destino != null).length === 0 && <Empty title="Sin recepciones">Cuando el vendor recepcione en La Negra, el pesaje validado aparecerá aquí.</Empty>}
        </div>
      )}

      {tab === 'd3' && (
        <div className="card"><div className="tbl-wrap"><table>
          <thead><tr><th>Guía</th><th>Fecha</th><th>Categoría</th><th className="num">Kg despachados</th><th className="num">Kg Lampa</th><th>Estado</th><th>Certificado</th><th></th></tr></thead>
          <tbody>
            {traslados.map((t) => (
              <tr key={t.id}>
                <td className="mono">{t.guia}</td><td className="mono">{t.fecha}</td><td>{t.categoria}</td>
                <td className="num">{fmtKg(t.kg)}</td>
                <td className="num">{t.kg_lampa != null ? fmtKg(t.kg_lampa) : '—'}</td>
                <td><Chip tone={t.estado === 'recepcionado' ? 'ok' : 'info'}>{t.estado === 'recepcionado' ? 'Recepcionado' : 'En tránsito'}</Chip></td>
                <td className="mono">{t.cert_folio || '—'}</td>
                <td className="num">
                  {t.estado === 'en_transito' && puedeTras && (
                    <button className="btn sm primary" onClick={() => { setRecepTras(t); setKgLampa(String(t.kg)); }}>Recepcionar en Lampa</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
          {traslados.length === 0 && <Empty title="Sin traslados a Lampa">El vendor consolida el material en La Negra y lo re-despacha a Lampa con guía GT.</Empty>}
        </div>
      )}

      {tab === 'd4' && (
        <div className="card"><div className="tbl-wrap"><table>
          <thead><tr><th>Certificado</th><th>Guía traslado</th><th>Categoría</th><th className="num">Kg certificados</th><th>Emisión</th></tr></thead>
          <tbody>
            {certificados.map((t) => (
              <tr key={t.id}>
                <td className="mono">{t.cert_folio}</td>
                <td className="mono">{t.guia}</td>
                <td>{t.categoria}</td>
                <td className="num">{fmtKg(t.kg_lampa)}</td>
                <td>{t.recepcionado_el}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
          {certificados.length === 0 && <Empty title="Sin certificados emitidos">Cada recepción en Lampa emite automáticamente su certificado de disposición final foliado.</Empty>}
        </div>
      )}

      {/* ---- modales ---- */}
      <Modal open={!!detalle} title={detalle && `Guía ${detalle.guia}`} onClose={() => setDetalle(null)}
        footer={<button className="btn" onClick={() => setDetalle(null)}>Cerrar</button>}>
        {detalle && (
          <>
            <div className="grid g2" style={{ gap: 10, marginBottom: 4 }}>
              <div><small style={{ color: 'var(--muted)' }}>Patio de origen</small><br /><b>{detalle.patio} · {detalle.patio_nombre}</b></div>
              <div><small style={{ color: 'var(--muted)' }}>Categoría</small><br />
                <b>{detalle.categoria}</b>{detalle.categoria_final && <span style={{ color: 'var(--warn-tx)' }}> → {detalle.categoria_final}</span>}</div>
              <div><small style={{ color: 'var(--muted)' }}>Pesaje MEL</small><br /><b>{fmtKg(detalle.kg_origen)} kg</b></div>
              <div><small style={{ color: 'var(--muted)' }}>Pesaje La Negra</small><br />
                <b>{detalle.kg_destino != null ? `${fmtKg(detalle.kg_destino)} kg` : 'pendiente'}</b>
                {detalle.dif_pct != null && <span style={{ color: Math.abs(detalle.dif_pct) > 2 ? 'var(--bad-tx)' : 'var(--muted)', fontSize: 12 }}> ({detalle.dif_pct.toFixed(2)}%)</span>}</div>
              <div><small style={{ color: 'var(--muted)' }}>Precio congelado</small><br /><b>{detalle.precio_kg != null ? `$ ${detalle.precio_kg}/kg` : '—'}</b></div>
              <div><small style={{ color: 'var(--muted)' }}>Valorización</small><br /><b>{fmtCLP(detalle.valor)}</b></div>
            </div>
            {detalle.obs_recepcion && <div className="audit-note">Observación: {detalle.obs_recepcion}</div>}
            <small style={{ display: 'block', color: 'var(--muted)', margin: '14px 0 6px' }}>
              Evidencia fotográfica ({detalle.fotos})
            </small>
            {evidencia == null && <div className="loading" style={{ padding: '18px 0' }}>Cargando evidencia…</div>}
            {evidencia?.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13 }}>Sin fotografías adjuntas.</div>}
            {evidencia?.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                {evidencia.map((u) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer">
                    <img src={u} alt="Evidencia del despacho" style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)' }} />
                  </a>
                ))}
              </div>
            )}
            {detalle.ep_folio && <div className="audit-note">Incluido en el estado de pago <b>&nbsp;{detalle.ep_folio}</b></div>}
          </>
        )}
      </Modal>

      <Modal open={nuevo} title="Registrar despacho MEL → La Negra" onClose={() => setNuevo(false)}
        footer={<>
          <button className="btn" onClick={() => setNuevo(false)}>Cancelar</button>
          <button className="btn primary" onClick={crearDespacho}>Registrar despacho</button>
        </>}>
        <Field label="Patio de origen">
          <select value={form.patio_id} onChange={(e) => setForm({ ...form, patio_id: +e.target.value })}>
            {maestros?.patios.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>)}
          </select>
        </Field>
        <Field label="Categoría de material">
          <select value={form.categoria_id} onChange={(e) => setForm({ ...form, categoria_id: +e.target.value })}>
            {maestros?.categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.precio_kg ? ` · $${c.precio_kg}/kg` : ''}</option>)}
          </select>
        </Field>
        <Field label="Peso en báscula MEL (kg)">
          <input type="number" min="1" value={form.kg_origen} onChange={(e) => setForm({ ...form, kg_origen: e.target.value })} placeholder="0" />
        </Field>
        <Field label={`Evidencia fotográfica${form.archivos.length ? ` · ${form.archivos.length} seleccionada(s)` : ''}`}
          hint="Hasta 6 imágenes (JPG/PNG/WebP, máx. 5 MB c/u). La guía se folia automáticamente (GD-####).">
          <input type="file" multiple accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setForm({ ...form, archivos: Array.from(e.target.files).slice(0, 6) })} />
        </Field>
        {form.archivos.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: -6, marginBottom: 10 }}>
            {form.archivos.map((f) => (
              <img key={f.name} src={URL.createObjectURL(f)} alt={f.name}
                style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--line)' }} />
            ))}
          </div>
        )}
      </Modal>

      <Modal open={!!recep} title={recep && `Recepcionar ${recep.guia} en La Negra`} onClose={() => setRecep(null)}
        footer={<>
          <button className="btn" onClick={() => setRecep(null)}>Cancelar</button>
          <button className="btn primary" onClick={post(`/despachos/${recep?.id}/recepcionar`,
            { kg_destino: +rForm.kg_destino, categoria_final_id: rForm.categoria_final_id || undefined, observacion: rForm.observacion || undefined },
            'Recepción registrada', () => setRecep(null))}>Validar recepción</button>
        </>}>
        <Field label={`Peso validado en báscula La Negra (origen MEL: ${recep && fmtKg(recep.kg_origen)} kg)`}>
          <input type="number" min="1" value={rForm.kg_destino} onChange={(e) => setRForm({ ...rForm, kg_destino: e.target.value })} />
        </Field>
        <Field label="Reclasificación (solo si el material se reduce)" hint="El precio se congela con la categoría final al momento de esta recepción.">
          <select value={rForm.categoria_final_id} onChange={(e) => setRForm({ ...rForm, categoria_final_id: e.target.value ? +e.target.value : '' })}>
            <option value="">Mantener {recep?.categoria}</option>
            {maestros?.categorias.filter((c) => c.nombre !== recep?.categoria).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </Field>
        <Field label="Observación (opcional)">
          <input value={rForm.observacion} onChange={(e) => setRForm({ ...rForm, observacion: e.target.value })} placeholder="Condición de la carga, mermas, etc." />
        </Field>
        <small style={{ color: 'var(--muted)' }}>Una diferencia de peso mayor al 2% deja la recepción observada para revisión del ITO.</small>
      </Modal>

      <Modal open={!!resolver} title={resolver && `Resolver observación · ${resolver.guia}`} onClose={() => setResolver(null)}
        footer={<>
          <button className="btn" onClick={() => setResolver(null)}>Cancelar</button>
          <button className="btn primary" onClick={post(`/despachos/${resolver?.id}/resolver`, { observacion: obs }, 'Observación resuelta', () => setResolver(null))}>Validar recepción</button>
        </>}>
        <p style={{ marginTop: 0, color: 'var(--ink-2)' }}>{resolver?.obs_recepcion}</p>
        <Field label="Resolución del ITO (obligatoria)" hint="Queda en la guía y en la bitácora de auditoría.">
          <textarea rows="2" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej.: diferencia justificada por humedad; se valida el peso de destino." />
        </Field>
      </Modal>

      <Modal open={nuevoTras} title="Despachar traslado La Negra → Lampa" onClose={() => setNuevoTras(false)}
        footer={<>
          <button className="btn" onClick={() => setNuevoTras(false)}>Cancelar</button>
          <button className="btn primary" onClick={post('/traslados', { ...tForm, kg: +tForm.kg }, 'Traslado despachado con guía foliada', () => { setNuevoTras(false); setTForm({ ...tForm, kg: '' }); })}>Despachar</button>
        </>}>
        <Field label="Categoría de material">
          <select value={tForm.categoria_id} onChange={(e) => setTForm({ ...tForm, categoria_id: +e.target.value })}>
            {maestros?.categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </Field>
        <Field label="Kilos despachados desde La Negra" hint="La guía se folia automáticamente (GT-####).">
          <input type="number" min="1" value={tForm.kg} onChange={(e) => setTForm({ ...tForm, kg: e.target.value })} placeholder="0" />
        </Field>
      </Modal>

      <Modal open={!!recepTras} title={recepTras && `Recepcionar ${recepTras.guia} en Lampa`} onClose={() => setRecepTras(null)}
        footer={<>
          <button className="btn" onClick={() => setRecepTras(null)}>Cancelar</button>
          <button className="btn primary" onClick={post(`/traslados/${recepTras?.id}/recepcionar`, { kg_lampa: +kgLampa }, 'Recepción en Lampa registrada; certificado emitido', () => setRecepTras(null))}>Recepcionar y emitir CDF</button>
        </>}>
        <Field label={`Peso validado en báscula Lampa (despachado: ${recepTras && fmtKg(recepTras.kg)} kg)`}
          hint="Al validar se emite automáticamente el certificado de disposición final foliado (CDF-####).">
          <input type="number" min="1" value={kgLampa} onChange={(e) => setKgLampa(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}
