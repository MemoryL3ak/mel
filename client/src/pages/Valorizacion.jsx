import { useEffect, useState } from 'react';
import { api, fmtCLP, fmtKg } from '../api.js';
import { PageHead } from '../ui.jsx';
import { HBarChart } from '../charts.jsx';

export default function Valorizacion() {
  const [d, setD] = useState(null);
  useEffect(() => { api('/valorizacion').then(setD).catch(() => {}); }, []);
  if (!d) return <div className="loading">Cargando valorización…</div>;

  const total = d.resumen.reduce((s, r) => s + r.valor, 0);
  const totalKg = d.resumen.reduce((s, r) => s + r.kg, 0);
  const conValor = d.resumen.filter((r) => r.valor > 0);

  return (
    <div className="page">
      <PageHead title="Valorización y tabla de precios"
        sub={<>Precios por categoría según contrato <span className="mono">{d.contrato}</span> con {d.vendor} · vigencia hasta {d.vigencia}.</>} />
      <div className="grid g23">
        <div className="card">
          <div className="card-h"><h3>Resumen del período · {d.mes}</h3><small>despachos valorizados en vivo</small></div>
          <div className="tbl-wrap"><table>
            <thead><tr><th>Categoría</th><th className="num">Precio (CLP/kg)</th><th className="num">Kg del mes</th><th className="num">Valorizado</th></tr></thead>
            <tbody>
              {d.resumen.map((r) => (
                <tr key={r.nombre}>
                  <td>{r.nombre}</td>
                  <td className="num">{fmtCLP(r.precio_kg)}</td>
                  <td className="num">{r.kg ? fmtKg(r.kg) : '—'}</td>
                  <td className="num">{r.valor ? fmtCLP(r.valor) : '—'}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700 }}>
                <td>Total</td><td /><td className="num">{fmtKg(totalKg)}</td><td className="num">{fmtCLP(total)}</td>
              </tr>
            </tbody>
          </table></div>
        </div>
        <div className="card">
          <div className="card-h"><h3>Participación por categoría</h3><small>valor del mes</small></div>
          <div className="card-b">
            <HBarChart rows={conValor.map((r) => ({ k: r.nombre, v: r.valor, lbl: fmtCLP(r.valor), tono: 'copper' }))} />
          </div>
        </div>
      </div>
    </div>
  );
}
