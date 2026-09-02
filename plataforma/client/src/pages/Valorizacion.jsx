import { useEffect, useState } from 'react';
import { api, fmtCLP, fmtKg } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Field, Modal, PageHead, useToast } from '../ui.jsx';

export default function Valorizacion() {
  const [data, setData] = useState(null);
  const [nuevo, setNuevo] = useState(null);   // categoría seleccionada
  const [precio, setPrecio] = useState('');
  const { user } = useAuth();
  const toast = useToast();

  const load = () => api('/valorizacion').then(setData).catch((e) => toast(e.message, true));
  useEffect(() => { load(); }, []);
  if (!data) return <div className="loading">Cargando valorización…</div>;

  async function actualizar() {
    try {
      await api('/precios', { method: 'POST', body: { categoria_id: nuevo.id, precio_kg: +precio } });
      toast(`Nuevo precio vigente para ${nuevo.nombre}`);
      setNuevo(null); setPrecio('');
      load();
    } catch (e) { toast(e.message, true); }
  }

  return (
    <div>
      <PageHead title="Valorización y precios"
        sub="Tabla de precios del contrato por categoría. Cada despacho congela el precio vigente al momento de su recepción: los cambios no alteran guías ya valorizadas." />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h"><h3>Precios vigentes del contrato</h3><small>$/kg por categoría</small></div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Categoría</th><th className="num">Precio vigente</th><th>Desde</th><th className="num">Kg recepcionados YTD</th><th className="num">Valorizado YTD</th><th></th></tr></thead>
          <tbody>
            {data.categorias.map((c) => (
              <tr key={c.id}>
                <td><b>{c.nombre}</b></td>
                <td className="num mono">{c.precio_kg != null ? `$ ${Number(c.precio_kg).toLocaleString('es-CL')}` : '—'}</td>
                <td>{c.vigente_desde || '—'}</td>
                <td className="num">{fmtKg(c.kg_ytd)}</td>
                <td className="num">{fmtCLP(c.valor_ytd)}</td>
                <td className="num">
                  {user.role === 'coordinador' && (
                    <button className="btn sm" onClick={() => { setNuevo(c); setPrecio(String(c.precio_kg ?? '')); }}>Nueva vigencia</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      <div className="card">
        <div className="card-h"><h3>Historial de precios</h3><small>trazabilidad completa de vigencias</small></div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Categoría</th><th className="num">Precio</th><th>Vigente desde</th><th>Registrado por</th></tr></thead>
          <tbody>
            {data.historial.map((p) => {
              const cat = data.categorias.find((c) => c.id === p.categoria_id);
              return (
                <tr key={p.id}>
                  <td>{cat?.nombre}</td>
                  <td className="num mono">$ {Number(p.precio_kg).toLocaleString('es-CL')}</td>
                  <td>{p.vigente_desde}</td>
                  <td style={{ color: 'var(--ink-2)' }}>{p.creado_por || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>

      <Modal open={!!nuevo} title={nuevo && `Nueva vigencia · ${nuevo.nombre}`} onClose={() => setNuevo(null)}
        footer={<>
          <button className="btn" onClick={() => setNuevo(null)}>Cancelar</button>
          <button className="btn primary" onClick={actualizar}>Registrar precio</button>
        </>}>
        <Field label={`Nuevo precio ($/kg) — vigente actual: $ ${nuevo?.precio_kg ?? '—'}`}
          hint="Rige desde hoy para las nuevas recepciones. El historial anterior se conserva y las guías ya valorizadas no cambian.">
          <input type="number" min="1" step="0.01" value={precio} onChange={(e) => setPrecio(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}
