import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Select, Chip, Empty, Field, Modal, PageHead, useToast } from '../ui.jsx';
import BotonDocs from '../BotonDocs.jsx';

const EYEBROW = 'Fase 2 · Venta de obsoletos';
const DD = { aprobada: ['ok', 'Aprobada'], pendiente: ['warn', 'En revisión'], rechazada: ['bad', 'Rechazada'] };

export default function Compradores() {
  const [rows, setRows] = useState(null);
  const [rev, setRev] = useState(null);   // { comprador, dd_estado, dd_nota }
  const toast = useToast();

  const load = () => api('/compradores').then(setRows).catch((e) => toast(e.message, true));
  useEffect(() => { load(); }, []);
  if (!rows) return <div className="loading">Cargando compradores…</div>;

  async function guardar() {
    try {
      await api(`/compradores/${rev.c.id}/dd`, { method: 'POST', body: { dd_estado: rev.estado, dd_nota: rev.nota } });
      toast(`Due diligence ${rev.estado}`);
      setRev(null); load();
    } catch (e) { toast(e.message, true); }
  }

  const pendientes = rows.filter((c) => c.dd_estado === 'pendiente').length;

  return (
    <div>
      <PageHead eyebrow={EYEBROW} title="Compradores y due diligence"
        sub="Empresas registradas en el portal público. Solo las aprobadas pueden presentar ofertas." />
      {pendientes > 0 && <div className="audit-note" style={{ marginBottom: 12 }}>⚠ {pendientes} registro(s) esperando revisión de due diligence.</div>}

      <div className="card"><div className="tbl-wrap"><table>
        <thead><tr><th>Razón social</th><th>RUT</th><th>Contacto</th><th className="num">Ofertas</th><th>Due diligence</th><th></th></tr></thead>
        <tbody>
          {rows.map((c) => {
            const [tono, txt] = DD[c.dd_estado] ?? ['neutral', c.dd_estado];
            return (
              <tr key={c.id}>
                <td><b>{c.razon_social}</b></td>
                <td className="mono">{c.rut}</td>
                <td>{c.email}{c.telefono && <><br /><small style={{ color: 'var(--muted)' }}>{c.telefono}</small></>}</td>
                <td className="num">{c.ofertas}</td>
                <td><Chip tone={tono}>{txt}</Chip>{c.dd_nota && <><br /><small style={{ color: 'var(--muted)' }}>{c.dd_nota}</small></>}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn sm" onClick={() => setRev({ c, estado: c.dd_estado, nota: c.dd_nota ?? '' })}>Revisar</button>{' '}
                  <BotonDocs hito="comprador" refId={c.id} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
        {rows.length === 0 && <Empty title="Sin compradores registrados">Los registros del portal público aparecerán aquí para su due diligence.</Empty>}
      </div>

      <Modal open={!!rev} title={rev && `Due diligence · ${rev.c.razon_social}`} onClose={() => setRev(null)}
        footer={<>
          <button className="btn" onClick={() => setRev(null)}>Cancelar</button>
          <button className="btn primary" onClick={guardar}>Guardar decisión</button>
        </>}>
        {rev && (<>
          <p style={{ marginTop: 0, color: 'var(--ink-2)' }}>{rev.c.razon_social} · {rev.c.rut} · {rev.c.email}</p>
          <Field label="Decisión">
            <Select value={rev.estado} onChange={(e) => setRev({ ...rev, estado: e.target.value })}>
              <option value="pendiente">En revisión</option>
              <option value="aprobada">Aprobar — habilitar para ofertar</option>
              <option value="rechazada">Rechazar</option>
            </Select>
          </Field>
          <Field label="Nota (opcional)" hint="Queda registrada junto al comprador y en la bitácora.">
            <textarea rows="2" value={rev.nota} onChange={(e) => setRev({ ...rev, nota: e.target.value })} placeholder="Verificación de antecedentes, observaciones…" />
          </Field>
        </>)}
      </Modal>
    </div>
  );
}
