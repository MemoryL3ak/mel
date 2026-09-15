import { useEffect, useState } from 'react';
import { api, fmtCLP, fmtKg } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Chip, Empty, Field, Modal, PageHead, useToast } from '../ui.jsx';
import DocumentoEP from '../DocumentoEP.jsx';

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
  const [contrato, setContrato] = useState(null);
  const [sel, setSel] = useState(null);
  const [modal, setModal] = useState(null);   // generar | descuento | encabezado | ajustar | factura | pago | conciliar | documento
  const [f, setF] = useState({});
  const [verGuias, setVerGuias] = useState(false);
  const { user } = useAuth();
  const toast = useToast();

  const load = async (keepId) => {
    try {
      const { eps: rows, contrato: cfg } = await api('/eps');
      setEps(rows);
      setContrato(cfg);
      if (keepId) setSel(rows.find((e) => e.id === keepId) ?? rows[0] ?? null);
      else setSel((s) => rows.find((e) => e.id === s?.id) ?? rows[0] ?? null);
    } catch (e) { toast(e.message, true); }
  };
  useEffect(() => { load(); }, []);
  if (!eps) return <div className="loading">Cargando estados de pago…</div>;

  const esIto = ['ito', 'coordinador'].includes(user.role);
  const esCoord = user.role === 'coordinador';
  const esVendor = ['vendor', 'coordinador'].includes(user.role);
  const editable = sel && ['generado', 'con_ajustes'].includes(sel.estado);

  const accion = (path, body, ok, metodo = 'POST') => async () => {
    try {
      const r = await api(path, { method: metodo, body });
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
        sub="Ciclo completo del EP del período: generación desde los despachos valorizados, revisión y firma del Coordinador, factura del vendor, pago en menos de 15 días y conciliación.">
        {esIto && <button className="btn primary" onClick={() => { setF({ periodo: mesAnterior() }); setModal('generar'); }}>+ Generar EP del período</button>}
      </PageHead>

      <div className="grid" style={{ gridTemplateColumns: '340px 1fr', alignItems: 'start' }}>
        <div className="card">
          <div className="card-h"><h3>Períodos</h3><small>{eps.length} EP</small></div>
          {eps.length === 0 && <Empty title="Sin estados de pago">El ITO genera el primer EP al cierre del período con despachos recepcionados.</Empty>}
          {eps.map((ep) => (
            <div key={ep.id} className="pend" style={{ cursor: 'pointer', background: sel?.id === ep.id ? 'var(--copper-tint)' : undefined }}
              onClick={() => { setSel(ep); setVerGuias(false); }}>
              <span className="mono">EP N° {ep.numero ?? '—'}</span>
              <Chip tone={CHIP[ep.estado][0]}>{CHIP[ep.estado][1]}</Chip>
              <span className="go" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtCLP(ep.total)}</span>
            </div>
          ))}
        </div>

        {sel ? (
          <div className="card">
            <div className="card-h">
              <div>
                <h3>EP N° {sel.numero ?? '—'} {sel.revision > 0 && <span style={{ color: 'var(--warn-tx)' }}>· Rev. {sel.revision}</span>}</h3>
                <small className="mono" style={{ color: 'var(--muted)' }}>
                  {sel.desde && sel.hasta ? `${sel.desde} al ${sel.hasta}` : sel.periodo}
                </small>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn sm" onClick={() => setModal('documento')}>Ver documento EP</button>
                {esIto && editable && (
                  <>
                    <button className="btn sm" onClick={() => { setF({ presentado_el: sel.presentado_el ?? '', no_afecto_iva: sel.no_afecto_iva, anticipo: sel.anticipo }); setModal('encabezado'); }}>Encabezado</button>
                    {/* El botón de descuentos vive junto a la sección que afecta, no aquí. */}
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
                {/* El monto del pago parte vacío: un pago parcial no debe
                    poder registrarse como completo por venir precargado. */}
                {esVendor && sel.estado === 'facturado' && (
                  <button className="btn sm primary" onClick={() => { setF({ monto: '', fecha: new Date().toISOString().slice(0, 10) }); setModal('pago'); }}>Registrar pago</button>
                )}
                {esCoord && sel.estado === 'pagado' && (
                  <button className="btn sm primary" onClick={() => { setF({}); setModal('conciliar'); }}>Revisar y conciliar</button>
                )}
              </div>
            </div>
            <div className="card-b">
              <Pasos estado={sel.estado} />
              {sel.estado === 'facturado' && sel.factura_fecha && (() => {
                const dias = Math.floor((Date.now() - new Date(sel.factura_fecha + 'T12:00:00')) / 86400000);
                const restan = 15 - dias;
                return (
                  <div style={{ marginTop: 10 }}>
                    <Chip tone={restan < 0 ? 'bad' : restan <= 3 ? 'warn' : 'info'}>
                      {restan < 0 ? `Plazo de pago vencido hace ${-restan} día(s)` : `Pago contractual: quedan ${restan} de 15 días`}
                    </Chip>
                  </div>
                );
              })()}
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
                  <tr className="tot">
                    <td>Bruto del período</td><td />
                    <td className="num">{sel.n_guias}</td>
                    <td className="num">{fmtKg(sel.kg_total)}</td>
                    <td className="num">{fmtCLP(sel.bruto)}</td>
                  </tr>
                </tbody>
              </table></div>

              {/* Los descuentos solo se pueden tocar mientras el EP está en
                  Generado o Con ajustes. Antes el botón simplemente desaparecía
                  y no quedaba forma de saber dónde se ingresaban: la sección
                  está siempre a la vista y dice en qué estado se editan. */}
              {(esIto || (sel.descuentos_lineas ?? []).length > 0) && (
                <>
                  <div className="ev-tit" style={{ marginTop: 14 }}>
                    <span>Descuentos del período</span>
                    {esIto && editable && (
                      <button className="btn sm" onClick={() => { setF({}); setModal('descuento'); }}>+ Agregar descuento</button>
                    )}
                  </div>
                  {esIto && !editable && (
                    <div className="audit-note" style={{ marginTop: 0 }}>
                      Los descuentos se agregan con el botón <b>+ Agregar descuento</b> que aparece en esta
                      misma sección, y solo mientras el EP está en <b>Generado</b> o <b>Con ajustes</b>.
                      Este ya está <b>{CHIP[sel.estado][1].toLowerCase()}</b>: un EP firmado, facturado o
                      pagado no admite descuentos retroactivos.
                    </div>
                  )}
                  {(sel.descuentos_lineas ?? []).length === 0 ? (
                    <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                      Sin descuentos en este período: se factura el bruto completo.
                    </div>
                  ) : sel.descuentos_lineas.map((d) => (
                    <div className="pend" key={d.id}>
                      <Chip tone="bad">Descuento</Chip>
                      <span>{d.glosa} <small style={{ color: 'var(--muted)' }}>· {d.creado_por}</small></span>
                      <span className="go" style={{ fontVariantNumeric: 'tabular-nums' }}>-{fmtCLP(d.monto)}</span>
                      {esIto && editable && (
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
                </>
              )}

              <div className="ep-tot">
                <span>Bruto <b>{fmtCLP(sel.bruto)}</b></span>
                <span>Descuentos <b style={{ color: sel.descuentos ? 'var(--bad-tx)' : undefined }}>-{fmtCLP(sel.descuentos)}</b></span>
                <span>Neto a facturar <b>{fmtCLP(sel.total)}</b></span>
                <span>IVA {Number(sel.iva_pct)}% <b>{fmtCLP(sel.iva)}</b></span>
                <span className="gr">Total con IVA <b>{fmtCLP(sel.total_con_iva)}</b></span>
              </div>

              <button className="btn sm" style={{ marginTop: 14 }} onClick={() => setVerGuias(!verGuias)}>
                {verGuias ? 'Ocultar' : 'Ver'} detalle de las {sel.n_guias} guías
              </button>
              {verGuias && (
                <div className="tbl-wrap" style={{ marginTop: 10, maxHeight: 340, overflowY: 'auto' }}><table>
                  <thead><tr><th>Guía</th><th>Guía MEL</th><th>Fecha</th><th>Categoría</th><th className="num">Kg</th><th className="num">$/kg</th><th className="num">Valor</th></tr></thead>
                  <tbody>
                    {sel.guias.map((g) => (
                      <tr key={g.id}>
                        <td className="mono">{g.guia}</td>
                        <td className="mono">{g.guia_mel || '—'}</td>
                        <td className="mono">{g.fecha}</td>
                        <td>{g.categoria}</td>
                        <td className="num">{fmtKg(g.kg)}</td>
                        <td className="num mono">{g.precio_kg != null ? `$ ${g.precio_kg}` : '—'}</td>
                        <td className="num">{fmtCLP(g.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}

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
      <Modal open={modal === 'documento'} title={sel && `Estado de pago N° ${sel.numero ?? '—'}`} onClose={() => setModal(null)}
        footer={<>
          <button className="btn" onClick={() => setModal(null)}>Cerrar</button>
          <button className="btn primary" onClick={() => window.print()}>Imprimir</button>
        </>}>
        {sel && contrato && <DocumentoEP ep={sel} contrato={contrato} />}
      </Modal>

      <Modal open={modal === 'generar'} title="Generar estado de pago del período" onClose={() => setModal(null)}
        footer={<>
          <button className="btn" onClick={() => setModal(null)}>Cancelar</button>
          <button className="btn primary" onClick={accion('/eps/generar', { periodo: f.periodo }, 'EP generado con los despachos del período')}>Generar</button>
        </>}>
        <Field label="Período (AAAA-MM)"
          hint={contrato ? `El período corta el día ${contrato.dia_corte}: el EP irá del ${contrato.dia_corte + 1} del mes anterior al ${contrato.dia_corte} del mes indicado.` : ''}>
          <input value={f.periodo || ''} onChange={(e) => setF({ ...f, periodo: e.target.value })} placeholder="2026-09" />
        </Field>
      </Modal>

      <Modal open={modal === 'encabezado'} title={sel && `Encabezado del EP N° ${sel.numero ?? ''}`} onClose={() => setModal(null)}
        footer={<>
          <button className="btn" onClick={() => setModal(null)}>Cancelar</button>
          <button className="btn primary" onClick={accion(`/eps/${sel?.id}`,
            { presentado_el: f.presentado_el || null, no_afecto_iva: Number(f.no_afecto_iva) || 0, anticipo: Number(f.anticipo) || 0 },
            'Encabezado actualizado', 'PATCH')}>Guardar</button>
        </>}>
        <Field label="Fecha de presentación" hint="Si se deja vacía, se completa sola al enviar el EP a revisión.">
          <input type="date" value={f.presentado_el || ''} onChange={(e) => setF({ ...f, presentado_el: e.target.value })} />
        </Field>
        <Field label="Valor no afecto a IVA (CLP)" hint="Parte del neto que no paga IVA. Normalmente 0.">
          <input type="number" min="0" value={f.no_afecto_iva ?? 0} onChange={(e) => setF({ ...f, no_afecto_iva: e.target.value })} />
        </Field>
        <Field label="Devolución de anticipo del período (CLP)">
          <input type="number" min="0" value={f.anticipo ?? 0} onChange={(e) => setF({ ...f, anticipo: e.target.value })} />
        </Field>
      </Modal>

      <Modal open={modal === 'descuento'} title={sel && `Registrar descuento · EP N° ${sel.numero ?? ''}`} onClose={() => setModal(null)}
        footer={<>
          <button className="btn" onClick={() => setModal(null)}>Cancelar</button>
          <button className="btn primary" onClick={accion(`/eps/${sel?.id}/descuentos`, { glosa: f.glosa, monto: +f.monto }, 'Descuento registrado')}>Registrar</button>
        </>}>
        <Field label="Glosa" hint="Queda visible en el EP y en la bitácora de auditoría.">
          <input value={f.glosa || ''} onChange={(e) => setF({ ...f, glosa: e.target.value })} placeholder="Ej.: merma guía GD-1007" />
        </Field>
        <Field label="Monto a descontar (CLP)">
          <input type="number" min="1" value={f.monto || ''} onChange={(e) => setF({ ...f, monto: e.target.value })} />
        </Field>
      </Modal>

      <Modal open={modal === 'ajustar'} title={sel && `Devolver con ajustes · EP N° ${sel.numero ?? ''}`} onClose={() => setModal(null)}
        footer={<>
          <button className="btn" onClick={() => setModal(null)}>Cancelar</button>
          <button className="btn primary" onClick={accion(`/eps/${sel?.id}/ajustar`, { observacion: f.observacion }, 'EP devuelto al ITO con ajustes')}>Devolver</button>
        </>}>
        <Field label="Observación (obligatoria)" hint="El ITO corrige y vuelve a enviar; el documento sube de revisión (Rev. 1, 2…). Todo queda en la bitácora.">
          <textarea rows="3" value={f.observacion || ''} onChange={(e) => setF({ ...f, observacion: e.target.value })} placeholder="Qué debe corregirse y por qué." />
        </Field>
      </Modal>

      <Modal open={modal === 'factura'} title={sel && `Registrar factura de compra · EP N° ${sel.numero ?? ''}`} onClose={() => setModal(null)}
        footer={<>
          <button className="btn" onClick={() => setModal(null)}>Cancelar</button>
          <button className="btn primary" onClick={accion(`/eps/${sel?.id}/factura`, { numero: f.numero, fecha: f.fecha }, 'Factura registrada')}>Registrar factura</button>
        </>}>
        <Field label="Número de factura"><input value={f.numero || ''} onChange={(e) => setF({ ...f, numero: e.target.value })} placeholder="F-000123" /></Field>
        <Field label="Fecha de emisión" hint="Desde esta fecha corre el plazo de pago de 15 días del contrato.">
          <input type="date" value={f.fecha || ''} onChange={(e) => setF({ ...f, fecha: e.target.value })} />
        </Field>
      </Modal>

      <Modal open={modal === 'pago'} title={sel && `Registrar transferencia · EP N° ${sel.numero ?? ''}`} onClose={() => setModal(null)}
        footer={<>
          <button className="btn" onClick={() => setModal(null)}>Cancelar</button>
          <button className="btn primary" onClick={accion(`/eps/${sel?.id}/pago`, { monto: +f.monto, fecha: f.fecha, referencia: f.referencia }, 'Pago registrado; queda a revisión del Coordinador')}>Registrar pago</button>
        </>}>
        {sel && (() => {
          const monto = Number(f.monto);
          const dif = monto > 0 ? monto - Number(sel.total_con_iva) : null;
          return (
            <>
              <div className="cotejo">
                <span><small>Total con IVA del EP</small><b className="mono">{fmtCLP(sel.total_con_iva)}</b></span>
                <span className="vs">frente a</span>
                <span><small>Transferido</small><b className="mono">{monto > 0 ? fmtCLP(monto) : '— pendiente —'}</b></span>
              </div>
              {dif != null && dif !== 0 && (
                <div className={`dif-live ${dif < 0 ? 'bad' : 'ok'}`}>
                  Diferencia: <b>{dif > 0 ? '+' : ''}{fmtCLP(dif)}</b>
                  {dif < 0 ? ' — el pago no cubre el total: el Coordinador exigirá una explicación al conciliar.' : ' — se transfirió más que el total del EP.'}
                </div>
              )}
            </>
          );
        })()}
        <Field label="Monto efectivamente transferido (CLP)"
          hint="Escriba lo que salió del banco. El campo parte vacío a propósito.">
          <input type="number" min="1" value={f.monto || ''} onChange={(e) => setF({ ...f, monto: e.target.value })} placeholder="0" />
        </Field>
        <Field label="Fecha de transferencia"><input type="date" value={f.fecha || ''} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></Field>
        <Field label="Referencia (opcional)"><input value={f.referencia || ''} onChange={(e) => setF({ ...f, referencia: e.target.value })} placeholder="N° de operación bancaria" /></Field>
      </Modal>

      <Modal open={modal === 'conciliar'} title={sel && `Conciliar · EP N° ${sel.numero ?? ''}`} onClose={() => setModal(null)}
        footer={<>
          <button className="btn" onClick={() => setModal(null)}>Cancelar</button>
          <button className="btn primary" onClick={accion(`/eps/${sel?.id}/conciliar`, { observacion: f.observacion }, 'EP conciliado: ciclo cerrado')}>Conciliar</button>
        </>}>
        <p style={{ marginTop: 0, color: 'var(--ink-2)' }}>
          Transferencia registrada: <b>{sel && fmtCLP(sel.pago_monto)}</b> contra un neto de <b>{sel && fmtCLP(sel.total)}</b>.
          {sel && Number(sel.pago_monto) < Number(sel.total) && ' El pago no cubre el total: la observación es obligatoria.'}
        </p>
        <Field label="Observación">
          <textarea rows="2" value={f.observacion || ''} onChange={(e) => setF({ ...f, observacion: e.target.value })} placeholder="Ej.: diferencia en revisión con vendor." />
        </Field>
      </Modal>
    </div>
  );
}
