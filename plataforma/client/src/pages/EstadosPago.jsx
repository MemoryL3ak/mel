import { useEffect, useState } from 'react';
import { api, fmtCLP, fmtKg } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Chip, Empty, Field, Modal, PageHead, useToast } from '../ui.jsx';

const CHIP = {
  generado: ['neutral', 'Generado'], en_revision: ['warn', 'En revisión'], con_ajustes: ['bad', 'Con ajustes'],
  firmado: ['info', 'Firmado'], facturado: ['info', 'Facturado'], pagado: ['warn', 'Pagado'], conciliado: ['ok', 'Conciliado'],
};
const CICLO = ['generado', 'en_revision', 'firmado', 'facturado', 'pagado', 'conciliado'];
const CICLO_LBL = { generado: 'Generado', en_revision: 'Revisión', firmado: 'Firmado', facturado: 'Facturado', pagado: 'Pagado', conciliado: 'Conciliado' };

function Pasos({ estado }) {
  const idx = estado === 'con_ajustes' ? 1 : CICLO.indexOf(estado);
  return (
    <div className="steps">
      {CICLO.map((s, i) => (
        <span key={s} style={{ display: 'contents' }}>
          {i > 0 && <span className="step-sep" />}
          <span className={`step ${i < idx ? 'done' : i === idx ? 'now' : ''}`}>
            <i>{i < idx ? '✓' : i + 1}</i>{CICLO_LBL[s]}
          </span>
        </span>
      ))}
    </div>
  );
}

export default function EstadosPago() {
  const [eps, setEps] = useState(null);
  const [sel, setSel] = useState(null);
  const [modal, setModal] = useState(null);   // generar | descuento | ajustar | factura | pago | conciliar
  const [f, setF] = useState({});
  const { user } = useAuth();
  const toast = useToast();

  const load = async (keepId) => {
    try {
      const rows = await api('/eps');
      setEps(rows);
      if (keepId) setSel(rows.find((e) => e.id === keepId) ?? rows[0] ?? null);
      else setSel((s) => rows.find((e) => e.id === s?.id) ?? rows[0] ?? null);
    } catch (e) { toast(e.message, true); }
  };
  useEffect(() => { load(); }, []);
  if (!eps) return <div className="loading">Cargando estados de pago…</div>;

  const esIto = ['ito', 'coordinador'].includes(user.role);
  const esCoord = user.role === 'coordinador';
  const esVendor = ['vendor', 'coordinador'].includes(user.role);

  const accion = (path, body, ok) => async () => {
    try {
      const r = await api(path, { method: 'POST', body });
      toast(ok);
      setModal(null); setF({});
      load(r.id);
    } catch (e) { toast(e.message, true); }
  };

  const mesAnterior = () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  return (
    <div>
      <PageHead title="Estados de pago"
        sub="Ciclo completo del EP mensual: generación desde los despachos valorizados, revisión y firma del Coordinador, factura del vendor, pago en menos de 15 días y conciliación.">
        {esIto && <button className="btn primary" onClick={() => { setF({ periodo: mesAnterior() }); setModal('generar'); }}>+ Generar EP de cierre</button>}
      </PageHead>

      <div className="grid" style={{ gridTemplateColumns: '340px 1fr', alignItems: 'start' }}>
        <div className="card">
          <div className="card-h"><h3>Períodos</h3><small>{eps.length} EP</small></div>
          {eps.length === 0 && <Empty title="Sin estados de pago">El ITO genera el primer EP al cierre del mes con despachos recepcionados.</Empty>}
          {eps.map((ep) => (
            <div key={ep.id} className="pend" style={{ cursor: 'pointer', background: sel?.id === ep.id ? 'var(--copper-tint)' : undefined }}
              onClick={() => setSel(ep)}>
              <span className="mono">{ep.folio}</span>
              <Chip tone={CHIP[ep.estado][0]}>{CHIP[ep.estado][1]}</Chip>
              <span className="go" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtCLP(ep.total)}</span>
            </div>
          ))}
        </div>

        {sel ? (
          <div className="card">
            <div className="card-h">
              <h3>{sel.folio} · {sel.periodo}</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {esIto && ['generado', 'con_ajustes'].includes(sel.estado) && (
                  <>
                    <button className="btn sm" onClick={() => { setF({}); setModal('descuento'); }}>+ Descuento</button>
                    <button className="btn sm primary" onClick={accion(`/eps/${sel.id}/enviar`, {}, 'EP enviado a revisión del Coordinador')}>Enviar a revisión</button>
                  </>
                )}
                {esCoord && sel.estado === 'en_revision' && (
                  <>
                    <button className="btn sm" onClick={() => { setF({}); setModal('ajustar'); }}>Devolver con ajustes</button>
                    <button className="btn sm primary" onClick={accion(`/eps/${sel.id}/firmar`, {}, 'EP firmado y enviado a la empresa vendor')}>Firmar y enviar</button>
                  </>
                )}
                {esVendor && sel.estado === 'firmado' && (
                  <button className="btn sm primary" onClick={() => { setF({ fecha: new Date().toISOString().slice(0, 10) }); setModal('factura'); }}>Registrar factura</button>
                )}
                {esVendor && sel.estado === 'facturado' && (
                  <button className="btn sm primary" onClick={() => { setF({ monto: sel.total, fecha: new Date().toISOString().slice(0, 10) }); setModal('pago'); }}>Registrar pago</button>
                )}
                {esCoord && sel.estado === 'pagado' && (
                  <button className="btn sm primary" onClick={() => { setF({}); setModal('conciliar'); }}>Revisar y conciliar</button>
                )}
              </div>
            </div>
            <div className="card-b">
              <Pasos estado={sel.estado} />
              {sel.estado === 'con_ajustes' && (
                <div className="audit-note" style={{ borderColor: 'var(--bad-tx)', color: 'var(--bad-tx)' }}>
                  Devuelto con ajustes: {sel.observacion}
                </div>
              )}

              <div className="tbl-wrap" style={{ marginTop: 14 }}><table>
                <thead><tr><th>Categoría</th><th>Participación</th><th className="num">Guías</th><th className="num">Kg</th><th className="num">Valor</th></tr></thead>
                <tbody>
                  {sel.lineas.map((l) => {
                    const pct = sel.bruto ? Math.round((l.valor / sel.bruto) * 100) : 0;
                    return (
                      <tr key={l.categoria}>
                        <td>{l.categoria}</td>
                        <td><span className="prop"><span className="bar-track"><span className="bar-fill" style={{ width: `${pct}%`, display: 'block' }} /></span><span className="pct">{pct}%</span></span></td>
                        <td className="num">{l.guias}</td>
                        <td className="num">{fmtKg(l.kg)}</td>
                        <td className="num">{fmtCLP(l.valor)}</td>
                      </tr>
                    );
                  })}
                  <tr style={{ fontWeight: 700 }}>
                    <td>Bruto ({sel.n_guias} guías)</td><td /><td /><td />
                    <td className="num">{fmtCLP(sel.bruto)}</td>
                  </tr>
                </tbody>
              </table></div>

              {(sel.descuentos_lineas ?? []).length > 0 && (
                <div style={{ marginTop: 10 }}>
                  {sel.descuentos_lineas.map((d) => (
                    <div className="pend" key={d.id}>
                      <Chip tone="bad">Descuento</Chip>
                      <span>{d.glosa} <small style={{ color: 'var(--muted)' }}>· {d.creado_por}</small></span>
                      <span className="go" style={{ fontVariantNumeric: 'tabular-nums' }}>-{fmtCLP(d.monto)}</span>
                      {esIto && ['generado', 'con_ajustes'].includes(sel.estado) && (
                        <button className="btn sm danger" onClick={async () => {
                          try {
                            await api(`/eps/${sel.id}/descuentos/${d.id}`, { method: 'DELETE' });
                            toast('Descuento eliminado');
                            load(sel.id);
                          } catch (e) { toast(e.message, true); }
                        }}>Quitar</button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 26, marginTop: 14, fontSize: 14 }}>
                <span style={{ color: 'var(--ink-2)' }}>Descuentos <b style={{ color: 'var(--bad-tx)' }}>-{fmtCLP(sel.descuentos)}</b></span>
                <span>Total a pagar <b style={{ fontSize: 17 }}>{fmtCLP(sel.total)}</b></span>
              </div>

              {(sel.factura_numero || sel.pago_monto != null) && (
                <div className="audit-note">
                  {sel.factura_numero && <>Factura de compra <b>N° {sel.factura_numero}</b> del {sel.factura_fecha}. </>}
                  {sel.pago_monto != null && <>Transferencia por <b>{fmtCLP(sel.pago_monto)}</b> el {sel.pago_fecha}{sel.pago_ref ? ` · ref. ${sel.pago_ref}` : ''}.</>}
                  {sel.firmado_por && <> Firmado por {sel.firmado_por} ({sel.firmado_el}).</>}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="card"><Empty title="Seleccione un período">El detalle del estado de pago aparecerá aquí.</Empty></div>
        )}
      </div>

      {/* ---- modales ---- */}
      <Modal open={modal === 'generar'} title="Generar estado de pago de cierre de mes" onClose={() => setModal(null)}
        footer={<>
          <button className="btn" onClick={() => setModal(null)}>Cancelar</button>
          <button className="btn primary" onClick={accion('/eps/generar', { periodo: f.periodo }, 'EP generado con los despachos del período')}>Generar</button>
        </>}>
        <Field label="Período (AAAA-MM)" hint="Toma todos los despachos recepcionados del período que aún no pertenecen a un EP.">
          <input value={f.periodo || ''} onChange={(e) => setF({ ...f, periodo: e.target.value })} placeholder="2026-09" />
        </Field>
      </Modal>

      <Modal open={modal === 'descuento'} title={`Registrar descuento · ${sel?.folio}`} onClose={() => setModal(null)}
        footer={<>
          <button className="btn" onClick={() => setModal(null)}>Cancelar</button>
          <button className="btn primary" onClick={accion(`/eps/${sel?.id}/descuentos`, { glosa: f.glosa, monto: +f.monto }, 'Descuento registrado')}>Registrar</button>
        </>}>
        <Field label="Glosa"><input value={f.glosa || ''} onChange={(e) => setF({ ...f, glosa: e.target.value })} placeholder="Ej.: merma guía GD-1007" /></Field>
        <Field label="Monto (CLP)"><input type="number" min="1" value={f.monto || ''} onChange={(e) => setF({ ...f, monto: e.target.value })} /></Field>
      </Modal>

      <Modal open={modal === 'ajustar'} title={`Devolver con ajustes · ${sel?.folio}`} onClose={() => setModal(null)}
        footer={<>
          <button className="btn" onClick={() => setModal(null)}>Cancelar</button>
          <button className="btn primary" onClick={accion(`/eps/${sel?.id}/ajustar`, { observacion: f.observacion }, 'EP devuelto al ITO con ajustes')}>Devolver</button>
        </>}>
        <Field label="Observación (obligatoria)" hint="El ITO corrige y vuelve a enviar. Todo queda en la bitácora.">
          <textarea rows="3" value={f.observacion || ''} onChange={(e) => setF({ ...f, observacion: e.target.value })} placeholder="Qué debe corregirse y por qué." />
        </Field>
      </Modal>

      <Modal open={modal === 'factura'} title={`Registrar factura de compra · ${sel?.folio}`} onClose={() => setModal(null)}
        footer={<>
          <button className="btn" onClick={() => setModal(null)}>Cancelar</button>
          <button className="btn primary" onClick={accion(`/eps/${sel?.id}/factura`, { numero: f.numero, fecha: f.fecha }, 'Factura registrada')}>Registrar factura</button>
        </>}>
        <Field label="Número de factura"><input value={f.numero || ''} onChange={(e) => setF({ ...f, numero: e.target.value })} placeholder="F-000123" /></Field>
        <Field label="Fecha de emisión" hint="Desde esta fecha corre el plazo de pago de 15 días del contrato.">
          <input type="date" value={f.fecha || ''} onChange={(e) => setF({ ...f, fecha: e.target.value })} />
        </Field>
      </Modal>

      <Modal open={modal === 'pago'} title={`Registrar transferencia · ${sel?.folio}`} onClose={() => setModal(null)}
        footer={<>
          <button className="btn" onClick={() => setModal(null)}>Cancelar</button>
          <button className="btn primary" onClick={accion(`/eps/${sel?.id}/pago`, { monto: +f.monto, fecha: f.fecha, referencia: f.referencia }, 'Pago registrado; queda a revisión del Coordinador')}>Registrar pago</button>
        </>}>
        <Field label={`Monto transferido (total del EP: ${sel && fmtCLP(sel.total)})`}>
          <input type="number" min="1" value={f.monto || ''} onChange={(e) => setF({ ...f, monto: e.target.value })} />
        </Field>
        <Field label="Fecha de transferencia"><input type="date" value={f.fecha || ''} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></Field>
        <Field label="Referencia (opcional)"><input value={f.referencia || ''} onChange={(e) => setF({ ...f, referencia: e.target.value })} placeholder="N° de operación bancaria" /></Field>
      </Modal>

      <Modal open={modal === 'conciliar'} title={`Conciliar · ${sel?.folio}`} onClose={() => setModal(null)}
        footer={<>
          <button className="btn" onClick={() => setModal(null)}>Cancelar</button>
          <button className="btn primary" onClick={accion(`/eps/${sel?.id}/conciliar`, { observacion: f.observacion }, 'EP conciliado: ciclo cerrado')}>Conciliar</button>
        </>}>
        <p style={{ marginTop: 0, color: 'var(--ink-2)' }}>
          Transferencia registrada: <b>{sel && fmtCLP(sel.pago_monto)}</b> contra un total de <b>{sel && fmtCLP(sel.total)}</b>.
          {sel && Number(sel.pago_monto) < Number(sel.total) && ' El pago no cubre el total: la observación es obligatoria.'}
        </p>
        <Field label="Observación">
          <textarea rows="2" value={f.observacion || ''} onChange={(e) => setF({ ...f, observacion: e.target.value })} placeholder="Ej.: diferencia en revisión con vendor." />
        </Field>
      </Modal>
    </div>
  );
}
