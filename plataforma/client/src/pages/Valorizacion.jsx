import { useEffect, useState } from 'react';
import { api, fmtCLP, fmtKg } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Chip, Field, Modal, PageHead, useToast } from '../ui.jsx';

export default function Valorizacion() {
  const [data, setData] = useState(null);
  const [nuevo, setNuevo] = useState(null);   // categoría seleccionada
  const [precio, setPrecio] = useState('');
  const [contrato, setContrato] = useState(null);
  const [editando, setEditando] = useState(null);   // borrador de los datos del contrato
  const { user } = useAuth();
  const toast = useToast();

  const load = () => {
    api('/valorizacion').then(setData).catch((e) => toast(e.message, true));
    api('/contrato').then(setContrato).catch(() => {});
  };
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

  async function guardarContrato() {
    try {
      const r = await api('/contrato', { method: 'PATCH', body: editando });
      setContrato(r);
      setEditando(null);
      toast('Datos del contrato actualizados');
      load();
    } catch (e) { toast(e.message, true); }
  }
  const campoContrato = (clave, etiqueta, extra = {}) => (
    <Field label={etiqueta} hint={extra.hint}>
      <input type={extra.type ?? 'text'} value={editando?.[clave] ?? ''}
        onChange={(e) => setEditando({ ...editando, [clave]: extra.type === 'number' ? e.target.value : e.target.value })}
        placeholder={extra.placeholder} />
    </Field>
  );

  return (
    <div>
      <PageHead title="Valorización y precios"
        sub={`Tabla de precios del contrato por categoría, con vigencia de ${data.meses_vigencia ?? 3} meses. Cada despacho congela el precio vigente al momento de su recepción: los cambios no alteran guías ya valorizadas.`} />

      {(() => {
        const vencidos = data.categorias.filter((c) => c.estado_precio === 'vencido');
        const porVencer = data.categorias.filter((c) => c.estado_precio === 'por_vencer');
        if (!vencidos.length && !porVencer.length) return null;
        return (
          <div className={`aviso ${vencidos.length ? 'bad' : 'warn'}`}>
            <b>{vencidos.length ? 'Precios con vigencia vencida' : 'Precios próximos a vencer'}</b>
            {vencidos.length > 0 && (
              <p>Vencieron: <b>{vencidos.map((c) => c.nombre).join(', ')}</b>. Las recepciones siguen
                valorizándose con el último precio registrado hasta que se acuerde uno nuevo con el contrato.</p>
            )}
            {porVencer.length > 0 && (
              <p>Vencen dentro de 15 días: {porVencer.map((c) => `${c.nombre} (${c.dias_para_vencer} d)`).join(' · ')}.</p>
            )}
          </div>
        );
      })()}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h"><h3>Precios vigentes del contrato</h3><small>$/kg por categoría</small></div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Categoría</th><th className="num">Precio vigente</th><th>Desde</th><th>Vigencia</th><th className="num">Kg recepcionados YTD</th><th className="num">Valorizado YTD</th><th></th></tr></thead>
          <tbody>
            {data.categorias.map((c) => {
              const tono = { vencido: 'bad', por_vencer: 'warn', vigente: 'ok', sin_precio: 'neutral' }[c.estado_precio] ?? 'neutral';
              const texto = {
                vencido: `Vencido hace ${Math.abs(c.dias_para_vencer)} d`,
                por_vencer: `Vence en ${c.dias_para_vencer} d`,
                vigente: `Hasta ${c.vence_el}`,
                sin_precio: 'Sin precio',
              }[c.estado_precio] ?? '—';
              return (
                <tr key={c.id}>
                  <td><b>{c.nombre}</b></td>
                  <td className="num mono">{c.precio_kg != null ? `$ ${Number(c.precio_kg).toLocaleString('es-CL')}` : '—'}</td>
                  <td className="mono">{c.vigente_desde || '—'}</td>
                  <td><Chip tone={tono}>{texto}</Chip></td>
                  <td className="num">{fmtKg(c.kg_ytd)}</td>
                  <td className="num">{fmtCLP(c.valor_ytd)}</td>
                  <td className="num">
                    {user.role === 'coordinador' && (
                      <button className={`btn sm ${c.estado_precio === 'vencido' ? 'primary' : ''}`}
                        onClick={() => { setNuevo(c); setPrecio(String(c.precio_kg ?? '')); }}>Nueva vigencia</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>

      <div className="card">
        <div className="card-h"><h3>Historial de cambios de precio</h3><small>cada vigencia queda registrada; nada se sobrescribe</small></div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Categoría</th><th className="num">Precio</th><th className="num">Variación</th><th>Vigencia</th><th>Registrado por</th><th></th></tr></thead>
          <tbody>
            {data.historial.map((p) => {
              const cat = data.categorias.find((c) => c.id === p.categoria_id);
              // historial viene ordenado del más nuevo al más antiguo por categoría
              const delCat = data.historial.filter((x) => x.categoria_id === p.categoria_id);
              const i = delCat.findIndex((x) => x.id === p.id);
              const siguiente = delCat[i - 1];             // vigencia que lo reemplazó
              const anterior = delCat[i + 1];              // vigencia que reemplazó
              const esVigente = cat?.vigente_desde === p.vigente_desde && Number(cat?.precio_kg) === Number(p.precio_kg);
              const dif = anterior ? Number(p.precio_kg) - Number(anterior.precio_kg) : null;
              const pct = dif != null && Number(anterior.precio_kg) ? (dif / Number(anterior.precio_kg)) * 100 : null;
              return (
                <tr key={p.id} style={esVigente ? { background: 'var(--copper-tint)' } : undefined}>
                  <td><b>{cat?.nombre}</b></td>
                  <td className="num mono">$ {Number(p.precio_kg).toLocaleString('es-CL')}</td>
                  <td className="num" style={{ color: dif == null ? 'var(--muted)' : dif >= 0 ? 'var(--ok-tx)' : 'var(--bad-tx)' }}>
                    {dif == null ? 'inicial' : `${dif >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%`}
                  </td>
                  <td className="mono">{p.vigente_desde}{siguiente ? ` → ${siguiente.vigente_desde}` : ''}</td>
                  <td style={{ color: 'var(--ink-2)' }}>{p.creado_por || '—'}</td>
                  <td>{esVigente && <Chip tone="ok">Vigente</Chip>}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>

      {contrato && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-h">
            <h3>Datos del contrato</h3>
            {user.role !== 'coordinador'
              ? <small>solo el Coordinador puede modificarlos</small>
              : contrato.editable
                ? <button className="btn sm" onClick={() => setEditando({ ...contrato })}>Editar</button>
                : <small style={{ color: 'var(--warn-tx)' }}>pendiente de aplicar la migración 0003 en la base</small>}
          </div>
          <div className="card-b">
            <div className="grid g2" style={{ gap: 12 }}>
              {[
                ['Contrato N°', contrato.numero || '—'],
                ['Gerencia', contrato.gerencia || '—'],
                ['Glosa', contrato.glosa || '—'],
                ['Mandante', contrato.mandante || '—'],
                ['Contratista', contrato.contratista || '—'],
                ['Firma mandante', contrato.firma_mandante || '—'],
                ['Firma contratista', contrato.firma_contratista || '—'],
                ['Monto original', fmtCLP(contrato.monto_original)],
                ['Modificaciones', fmtCLP(contrato.modificaciones)],
                ['IVA', `${Number(contrato.iva_pct)} %`],
                ['Día de corte del período', `día ${contrato.dia_corte} de cada mes`],
                ['Vigencia de los precios', `${contrato.meses_vigencia_precio} meses`],
              ].map(([k, v]) => (
                <div key={k}><small style={{ color: 'var(--muted)' }}>{k}</small><br /><b>{v}</b></div>
              ))}
            </div>
            <div className="audit-note">
              Estos datos alimentan el encabezado y las firmas del documento del estado de pago,
              el cálculo del IVA, el período que abarca cada EP y el plazo de vigencia de los precios.
            </div>
          </div>
        </div>
      )}

      <Modal open={!!editando} title="Datos del contrato" onClose={() => setEditando(null)}
        footer={<>
          <button className="btn" onClick={() => setEditando(null)}>Cancelar</button>
          <button className="btn primary" onClick={guardarContrato}>Guardar</button>
        </>}>
        {campoContrato('numero', 'Contrato N°', { placeholder: '9100078390' })}
        {campoContrato('gerencia', 'Gerencia', { placeholder: 'GERENCIA W&L' })}
        {campoContrato('glosa', 'Glosa del contrato', { placeholder: 'ADJUDICACIÓN LICITACIÓN DE CHATARRA' })}
        {campoContrato('mandante', 'Mandante')}
        {campoContrato('contratista', 'Contratista')}
        {campoContrato('firma_mandante', 'Quién firma por el mandante')}
        {campoContrato('firma_contratista', 'Quién firma por el contratista')}
        {campoContrato('monto_original', 'Monto original del contrato (CLP)', { type: 'number' })}
        {campoContrato('modificaciones', 'Modificaciones (CLP)', { type: 'number' })}
        {campoContrato('iva_pct', 'IVA (%)', { type: 'number' })}
        {campoContrato('dia_corte', 'Día de corte del período', { type: 'number', hint: 'El EP va del día siguiente al corte del mes anterior hasta este día.' })}
        {campoContrato('meses_vigencia_precio', 'Vigencia de los precios (meses)', { type: 'number', hint: 'Pasado ese plazo la plataforma avisa que hay que renegociar.' })}
      </Modal>

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
