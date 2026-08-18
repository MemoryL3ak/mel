import { useEffect, useState } from 'react';
import { api, fmtCLP, fmtKg } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Chip, Field, Modal, PageHead, useToast } from '../ui.jsx';

const CHIP = {
  en_aprobacion: ['warn', 'En aprobación'], aprobado: ['ok', 'Aprobado'], rechazado: ['bad', 'Rechazado'],
};
const CONC = { conciliado: ['ok', 'Conciliado'], parcial: ['warn', 'Parcial'], pendiente: ['neutral', 'Pendiente'] };

export default function EstadosPago() {
  const [eps, setEps] = useState(null);
  const [sel, setSel] = useState(null);
  const [rechazo, setRechazo] = useState(false);
  const [obs, setObs] = useState('');
  const [pago, setPago] = useState(false);
  const [montoPago, setMontoPago] = useState('');
  const [descuento, setDescuento] = useState(false);
  const [desc, setDesc] = useState({ concepto: '', monto: '' });
  const { user } = useAuth();
  const toast = useToast();

  const load = (keepId) => api('/eps').then((rows) => {
    setEps(rows);
    setSel((s) => rows.find((r) => r.id === (keepId ?? s?.id)) || rows.find((r) => r.estado === 'en_aprobacion') || rows[0]);
  }).catch((e) => toast(e.message, true));
  useEffect(() => { load(); }, []);
  if (!eps) return <div className="loading">Cargando estados de pago…</div>;

  const esCoord = user.role === 'coordinador';
  const esIto = ['ito', 'coordinador'].includes(user.role);
  const esVendor = ['vendor', 'ito', 'coordinador'].includes(user.role);

  async function accion(path, body, msg) {
    try {
      await api(path, { method: 'POST', body });
      toast(msg);
      load(sel?.id);
    } catch (e) { toast(e.message, true); }
  }

  async function generar() {
    try {
      const ep = await api('/eps/generar', { method: 'POST', body: {} });
      toast(`${ep.folio} generado desde ${ep.n_despachos} despachos del período`);
      load(ep.id);
    } catch (e) { toast(e.message, true); }
  }

  const totalDesc = sel ? sel.descuentos.reduce((s, x) => s + x.monto, 0) : 0;
  return (
    <div className="page">
      <PageHead title="Estados de pago" sub="Generados automáticamente desde los despachos valorizados del período. Flujo de aprobación multinivel con trazabilidad completa.">
        {esIto && <button className="btn primary" onClick={generar}>Generar EP del período</button>}
      </PageHead>

      <div className="card" style={{ marginBottom: 16 }}><div className="tbl-wrap"><table>
        <thead><tr><th>Folio</th><th>Período</th><th className="num">Despachos</th><th className="num">Bruto</th><th className="num">Descuentos</th><th className="num">Total</th><th>Estado</th><th>Conciliación</th></tr></thead>
        <tbody>
          {eps.map((ep) => (
            <tr key={ep.id} onClick={() => setSel(ep)} style={{ cursor: 'pointer', background: sel?.id === ep.id ? 'var(--surface-2)' : undefined }}>
              <td className="mono">{ep.folio}</td><td>{ep.periodo}</td>
              <td className="num">{ep.n_despachos || '—'}</td>
              <td className="num">{fmtCLP(ep.bruto)}</td>
              <td className="num">{ep.bruto - ep.total ? '-' + fmtCLP(ep.bruto - ep.total) : '—'}</td>
              <td className="num" style={{ fontWeight: 700 }}>{fmtCLP(ep.total)}</td>
              <td><Chip tone={CHIP[ep.estado][0]}>{CHIP[ep.estado][1]}</Chip></td>
              <td>{ep.conciliacion ? <Chip tone={CONC[ep.conciliacion][0]}>{CONC[ep.conciliacion][1]}{ep.conciliacion === 'parcial' && ` · ${ep.pct_pagado}%`}</Chip> : <Chip tone="neutral">—</Chip>}</td>
            </tr>
          ))}
        </tbody>
      </table></div></div>

      {sel && (
        <div className="grid g23">
          <div className="card">
            <div className="card-h">
              <h3>Detalle · <span className="mono">{sel.folio}</span></h3>
              <small>{sel.n_despachos ? `${sel.n_despachos} despachos` : 'histórico'} · Metarec SpA</small>
            </div>
            <div className="tbl-wrap"><table>
              <thead><tr><th>Concepto</th><th className="num">Kg</th><th className="num">Monto</th></tr></thead>
              <tbody>
                {sel.lineas.map((l) => (
                  <tr key={l.nombre}><td>{l.nombre} ({l.n} despachos)</td><td className="num">{fmtKg(l.kg)}</td><td className="num">{fmtCLP(l.monto)}</td></tr>
                ))}
                {!sel.lineas.length && <tr><td>Total del período (histórico)</td><td /><td className="num">{fmtCLP(sel.bruto)}</td></tr>}
                {sel.descuentos.map((x) => (
                  <tr key={x.id}><td style={{ color: 'var(--bad-tx)' }}>Descuento: {x.concepto}</td><td /><td className="num" style={{ color: 'var(--bad-tx)' }}>-{fmtCLP(x.monto)}</td></tr>
                ))}
                <tr style={{ fontWeight: 800 }}><td>Total a pagar por vendor</td><td /><td className="num">{fmtCLP(sel.total)}</td></tr>
              </tbody>
            </table></div>
            <div className="card-b" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--line-2)' }}>
              {sel.estado === 'en_aprobacion' && esCoord && (
                <>
                  <button className="btn primary" onClick={() => accion(`/eps/${sel.id}/aprobar`, {}, `${sel.folio} aprobado — vendor notificado`)}>Aprobar estado de pago</button>
                  <button className="btn danger" onClick={() => setRechazo(true)}>Rechazar con observación</button>
                </>
              )}
              {sel.estado === 'en_aprobacion' && esIto && (
                <button className="btn" onClick={() => setDescuento(true)}>+ Agregar descuento</button>
              )}
              {sel.estado === 'aprobado' && sel.conciliacion !== 'conciliado' && esVendor && (
                <button className="btn primary" onClick={() => { setPago(true); setMontoPago(String(sel.total - sel.pagado)); }}>Registrar pago recibido</button>
              )}
              {sel.estado === 'rechazado' && <Chip tone="bad">Devuelto al ITO: “{sel.observacion}”</Chip>}
            </div>
          </div>

          <div className="card">
            <div className="card-h"><h3>Flujo de aprobación</h3><small>trazabilidad</small></div>
            <div className="card-b">
              <ul className="flow">
                <li className="done"><span className="dot">✓</span><div><b>Generación automática</b><small>Sistema · despachos valorizados del período {sel.periodo}</small></div></li>
                <li className="done"><span className="dot">✓</span><div><b>Preparado y validado por ITO</b><small>C. Fuentes · descuentos: {totalDesc ? '-' + fmtCLP(totalDesc) : 'sin descuentos'}</small></div></li>
                <li className={sel.estado === 'aprobado' ? 'done' : sel.estado === 'rechazado' ? 'rej' : 'now'}>
                  <span className="dot">{sel.estado === 'aprobado' ? '✓' : sel.estado === 'rechazado' ? '✕' : '3'}</span>
                  <div><b>Aprobación Coordinador Logístico</b>
                    <small>{sel.estado === 'aprobado' ? `Aprobado por ${sel.aprobado_por} · ${sel.fecha_aprobacion}`
                      : sel.estado === 'rechazado' ? `Rechazado · "${sel.observacion}" — devuelto al ITO`
                      : 'Pendiente — asignado a R. Miranda'}</small></div>
                </li>
                <li className={sel.estado === 'aprobado' ? 'done' : ''}><span className="dot">4</span><div><b>Notificación al vendor y facturación</b><small>Se emite automáticamente al aprobar</small></div></li>
                <li className={sel.conciliacion === 'conciliado' ? 'done' : sel.conciliacion === 'parcial' ? 'now' : ''}>
                  <span className="dot">{sel.conciliacion === 'conciliado' ? '✓' : '5'}</span>
                  <div><b>Conciliación de pagos recibidos</b>
                    <small>{sel.pagado ? `Pagado ${fmtCLP(sel.pagado)} de ${fmtCLP(sel.total)} (${sel.pct_pagado}%)` : 'Comprobantes cargados por el vendor'}</small></div>
                </li>
              </ul>
              <div className="audit-note">🔒 Cada transición queda en la bitácora de auditoría inmutable.</div>
            </div>
          </div>
        </div>
      )}

      <Modal open={rechazo} title={`Rechazar ${sel?.folio}`} onClose={() => setRechazo(false)}
        footer={<>
          <button className="btn" onClick={() => setRechazo(false)}>Cancelar</button>
          <button className="btn danger" onClick={() => {
            if (!obs.trim()) return toast('La observación es obligatoria para rechazar', true);
            accion(`/eps/${sel.id}/rechazar`, { observacion: obs }, `${sel.folio} rechazado y devuelto al ITO`);
            setRechazo(false); setObs('');
          }}>Confirmar rechazo</button>
        </>}>
        <Field label="Observación del rechazo (obligatoria — vuelve al ITO)">
          <textarea rows="3" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej.: la diferencia de peso de GD-4527 no está justificada…" />
        </Field>
      </Modal>

      <Modal open={pago} title={`Registrar pago recibido · ${sel?.folio}`} onClose={() => setPago(false)}
        footer={<>
          <button className="btn" onClick={() => setPago(false)}>Cancelar</button>
          <button className="btn primary" onClick={() => {
            accion(`/eps/${sel.id}/pagos`, { monto: +montoPago, comprobante: 'TRF-Metarec.pdf' }, 'Pago registrado y conciliado contra el EP');
            setPago(false);
          }}>Registrar y conciliar</button>
        </>}>
        <Field label={`Monto transferido (saldo: ${sel && fmtCLP(sel.total - sel.pagado)})`}>
          <input type="number" value={montoPago} onChange={(e) => setMontoPago(e.target.value)} />
        </Field>
        <Field label="Comprobante de transferencia"><input type="file" /></Field>
      </Modal>

      <Modal open={descuento} title={`Agregar descuento · ${sel?.folio}`} onClose={() => setDescuento(false)}
        footer={<>
          <button className="btn" onClick={() => setDescuento(false)}>Cancelar</button>
          <button className="btn primary" onClick={() => {
            if (!desc.concepto || !desc.monto) return toast('Concepto y monto son obligatorios', true);
            accion(`/eps/${sel.id}/descuentos`, { concepto: desc.concepto, monto: +desc.monto }, 'Descuento aplicado; total recalculado');
            setDescuento(false); setDesc({ concepto: '', monto: '' });
          }}>Aplicar descuento</button>
        </>}>
        <Field label="Concepto">
          <input value={desc.concepto} onChange={(e) => setDesc({ ...desc, concepto: e.target.value })} placeholder="Ej.: flete asumido por MEL" />
        </Field>
        <Field label="Monto (CLP)">
          <input type="number" value={desc.monto} onChange={(e) => setDesc({ ...desc, monto: e.target.value })} />
        </Field>
      </Modal>
    </div>
  );
}
