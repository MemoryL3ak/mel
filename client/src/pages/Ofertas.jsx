import { useEffect, useMemo, useState } from 'react';
import { api, fmtCLP } from '../api.js';
import { BrandHex, Chip, Modal, PageHead, useToast } from '../ui.jsx';

const DD = { aprobada: ['ok', 'Aprobada'], en_revision: ['warn', 'En revisión'] };

// Puntajes iniciales sugeridos desde los datos de la oferta (editables)
function sugerir(ofertas, criterio) {
  return ofertas.map((o) => {
    if (criterio.includes('Precio')) {
      const max = Math.max(...ofertas.map((x) => x.monto));
      return Math.max(1, Math.round((o.monto / max) * 10));
    }
    if (criterio.includes('Plazo')) {
      const dias = parseInt(o.plazo_retiro) || 15;
      return dias <= 5 ? 10 : dias <= 10 ? 7 : 5;
    }
    if (criterio.includes('diligence')) return o.due_diligence === 'aprobada' ? 9 : 5;
    return (o.forma_pago || '').includes('100%') ? 10 : 6;
  });
}

export default function Ofertas() {
  const [comps, setComps] = useState(null);
  const [sel, setSel] = useState(null);
  const [ofertas, setOfertas] = useState([]);
  const [matriz, setMatriz] = useState([]);
  const [scores, setScores] = useState({});
  const [cert, setCert] = useState(null);
  const toast = useToast();

  useEffect(() => {
    Promise.all([api('/componentes'), api('/matriz')]).then(([c, m]) => {
      const pubs = c.filter((x) => x.estado === 'publicado' && x.n_ofertas > 0);
      setComps(c); setMatriz(m);
      if (pubs.length) setSel(pubs[0]);
    }).catch((e) => toast(e.message, true));
  }, []);

  useEffect(() => {
    if (!sel) return;
    api(`/componentes/${sel.id}/ofertas`).then((rows) => {
      setOfertas(rows);
      const init = {};
      matriz.forEach((cr) => { init[cr.id] = sugerir(rows, cr.nombre); });
      setScores(init);
    }).catch((e) => toast(e.message, true));
  }, [sel, matriz]);

  const totales = useMemo(() => ofertas.map((_, i) =>
    matriz.reduce((s, cr) => s + ((scores[cr.id]?.[i] ?? 0) * cr.peso) / 100, 0)
  ), [ofertas, matriz, scores]);
  const maxTotal = Math.max(0, ...totales);
  const winIdx = totales.indexOf(maxTotal);

  async function adjudicar() {
    const o = ofertas[winIdx];
    try {
      const r = await api(`/componentes/${sel.id}/adjudicar`, {
        method: 'POST', body: { oferta_id: o.id, puntaje: Math.round(maxTotal * 100) / 100 },
      });
      setCert(r);
    } catch (e) { toast(e.message, true); }
  }

  if (!comps) return <div className="loading">Cargando ofertas…</div>;
  const seleccionables = comps.filter((x) => x.estado === 'publicado' && x.n_ofertas > 0);

  return (
    <div className="page">
      <PageHead title="Ofertas y adjudicación" sub="Cuadro comparativo y matriz de evaluación configurable. Ajuste los puntajes: el ponderado se recalcula y la adjudicación se emite contra la API.">
        {seleccionables.map((c) => (
          <button key={c.id} className={`btn ${sel?.id === c.id ? 'primary' : ''}`} onClick={() => setSel(c)}>{c.nombre}</button>
        ))}
      </PageHead>

      {!sel && <div className="card"><div className="card-b loading">No hay publicaciones con ofertas para evaluar.</div></div>}

      {sel && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-h"><h3>Cuadro comparativo · {sel.nombre}</h3><small>{ofertas.length} ofertas · {sel.codigo}</small></div>
            <div className="tbl-wrap"><table>
              <thead><tr><th>Oferente</th><th>Due diligence</th><th className="num">Monto ofertado</th><th>Plazo de retiro</th><th>Forma de pago</th></tr></thead>
              <tbody>
                {ofertas.map((o) => (
                  <tr key={o.id}>
                    <td><b>{o.razon_social}</b></td>
                    <td><Chip tone={DD[o.due_diligence][0]}>{DD[o.due_diligence][1]}</Chip></td>
                    <td className="num">{fmtCLP(o.monto)}</td>
                    <td>{o.plazo_retiro || '—'}</td><td>{o.forma_pago || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>

          <div className="grid g23">
            <div className="card">
              <div className="card-h"><h3>Matriz de evaluación</h3><small>criterios y ponderaciones configurables</small></div>
              <div className="tbl-wrap"><table>
                <thead><tr><th>Criterio</th><th className="num">Peso</th>{ofertas.map((o) => <th key={o.id} className="num">{o.razon_social.split(' ')[0]}</th>)}</tr></thead>
                <tbody>
                  {matriz.map((cr) => (
                    <tr key={cr.id}>
                      <td>{cr.nombre}</td><td className="num">{cr.peso}%</td>
                      {ofertas.map((o, i) => (
                        <td key={o.id} className="num">
                          <input className="score-in" type="number" min="1" max="10" value={scores[cr.id]?.[i] ?? ''}
                            onChange={(e) => {
                              const v = Math.min(10, Math.max(0, +e.target.value || 0));
                              setScores((s) => ({ ...s, [cr.id]: s[cr.id].map((x, j) => (j === i ? v : x)) }));
                            }} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 800, borderTop: '2px solid var(--line)' }}>
                    <td>Puntaje ponderado</td><td />
                    {totales.map((t, i) => (
                      <td key={i} className={`num ${i === winIdx ? 'win' : ''}`}>
                        {t.toFixed(2)}{i === winIdx && <><br /><span className="winner-tag">Adjudicar</span></>}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table></div>
              <div className="card-b" style={{ borderTop: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <button className="btn primary" onClick={adjudicar}>Emitir certificado de adjudicación</button>
                {ofertas[winIdx] && <small style={{ color: 'var(--ink-2)' }}>Mejor evaluado: {ofertas[winIdx].razon_social} ({maxTotal.toFixed(2)} pts)</small>}
              </div>
            </div>

            <div className="card">
              <div className="card-h"><h3>Después de adjudicar</h3><small>flujo automático en el servidor</small></div>
              <div className="card-b">
                <ul className="flow">
                  <li className="done"><span className="dot">1</span><div><b>Certificado de adjudicación</b><small>Se emite, folia y notifica a los oferentes</small></div></li>
                  <li className="done"><span className="dot">2</span><div><b>Pago por transferencia</b><small>Registro y verificación del abono</small></div></li>
                  <li className="done"><span className="dot">3</span><div><b>Comisión de venta al vendor</b><small>Cálculo automático según contrato</small></div></li>
                  <li className="done"><span className="dot">4</span><div><b>Guía de despacho + certificado de entrega</b><small>Retiro coordinado en terreno (bandeja de entregas)</small></div></li>
                  <li className="done"><span className="dot">5</span><div><b>Baja del activo fijo</b><small>Comprobante al repositorio documental</small></div></li>
                </ul>
              </div>
            </div>
          </div>
        </>
      )}

      <Modal open={!!cert} title="Certificado de adjudicación" onClose={() => { setCert(null); window.location.reload(); }}
        footer={<button className="btn primary" onClick={() => { setCert(null); window.location.reload(); }}>Cerrar y notificar oferentes</button>}>
        {cert && (
          <div className="cert">
            <BrandHex stroke="#A4562E" size={36} />
            <h4>Certificado de adjudicación</h4>
            <p className="mono">{cert.certificado} · emitido hoy</p>
            <p>Se certifica que la venta del componente <b>{sel?.nombre}</b> ({sel?.codigo}) ha sido adjudicada a</p>
            <p style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>{cert.comprador}</p>
            <p>Monto adjudicado {fmtCLP(cert.monto)}{cert.puntaje ? ` · puntaje ponderado ${cert.puntaje} / 10` : ''}</p>
            <p style={{ fontSize: 11, color: 'var(--muted)' }}>Registrado en la bitácora · pasa a la bandeja de pendientes de entrega</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
