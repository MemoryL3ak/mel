import { useEffect, useState } from 'react';
import { api, fmtCLP, fmtKg } from '../api.js';
import { Chip, Empty, Field, Modal, PageHead, useToast } from '../ui.jsx';

export default function Cuadratura() {
  const [data, setData] = useState(null);
  const [cerrar, setCerrar] = useState(false);
  const [cat, setCat] = useState('todas');   // filtro de categoría de la tabla
  const [obs, setObs] = useState('');
  const toast = useToast();

  const load = (s) => {
    const qs = s ? `?anio=${s.anio}&semana=${s.semana}` : '';
    api('/cuadratura' + qs).then(setData).catch((e) => toast(e.message, true));
  };
  useEffect(() => { load(); }, []);
  if (!data) return <div className="loading">Cargando cuadratura…</div>;

  const mover = (delta) => {
    let { anio, semana } = data;
    semana += delta;
    if (semana < 1) { anio -= 1; semana = 52; }
    if (semana > 52) { anio += 1; semana = 1; }
    load({ anio, semana });
  };

  async function cerrarSemana() {
    try {
      const r = await api('/cuadratura/cerrar', { method: 'POST', body: { anio: data.anio, semana: data.semana, observacion: obs } });
      toast(r.estado === 'cuadrada' ? 'Semana cuadrada sin diferencias' : 'Cuadratura cerrada con diferencias registradas');
      setCerrar(false); setObs('');
      load({ anio: data.anio, semana: data.semana });
    } catch (e) { toast(e.message, true); }
  }

  const hayDif = data.detalle.some((x) => x.observados > 0 || (x.dif_pct != null && Math.abs(x.dif_pct) > 2));

  return (
    <div>
      <PageHead title="Cuadratura semanal de movimientos"
        sub="Cruce de la semana por categoría en sus tres dimensiones: cantidad de guías de despacho, kilos y monto valorizado. El cierre guarda un registro inmutable.">
        {!data.cerrada && data.detalle.length > 0 && (
          <button className="btn primary" onClick={() => setCerrar(true)}>Cerrar cuadratura S{data.semana}</button>
        )}
      </PageHead>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="btn sm" onClick={() => mover(-1)}>←</button>
            <h3>Semana {data.semana} · {data.anio}</h3>
            <button className="btn sm" onClick={() => mover(1)}>→</button>
            {(data.semana !== data.actual.semana || data.anio !== data.actual.anio) &&
              <button className="btn sm" onClick={() => load(data.actual)}>Hoy</button>}
          </div>
          <small>
            {data.desde} — {data.hasta}
            {data.cerrada && <> · <Chip tone={data.cerrada.estado === 'cuadrada' ? 'ok' : 'warn'}>
              {data.cerrada.estado === 'cuadrada' ? 'Cuadrada' : 'Con diferencias'}</Chip></>}
          </small>
        </div>
        {(() => {
          const todas = data.cerrada?.detalle ?? data.detalle;
          const filas = cat === 'todas' ? todas : todas.filter((x) => x.categoria === cat);
          // `alt` cubre los cierres guardados antes de que existiera el cruce de montos.
          const sum = (k, alt) => filas.reduce((a, x) => a + Number(x[k] ?? (alt ? x[alt] : 0) ?? 0), 0);
          const num = (v, fmt = (n) => n) => (v == null ? '—' : fmt(v));
          return (
            <>
            {todas.length > 1 && (
              <div className="card-h">
                <div className="filtros">
                  <button className={`fchip ${cat === 'todas' ? 'on' : ''}`} onClick={() => setCat('todas')}>
                    Todas <i>{todas.length}</i>
                  </button>
                  {todas.map((x) => (
                    <button key={x.categoria} className={`fchip ${cat === x.categoria ? 'on' : ''}`}
                      onClick={() => setCat(x.categoria)}>{x.categoria}</button>
                  ))}
                </div>
                <small>{filas.length} de {todas.length} categoría(s)</small>
              </div>
            )}
            <div className="tbl-wrap"><table className="grp">
              <thead>
                <tr>
                  <th rowSpan="2">Categoría</th>
                  <th colSpan="3" className="gh gsep">Guías de despacho</th>
                  <th colSpan="4" className="gh gsep">Kilos</th>
                  <th colSpan="3" className="gh gsep">Monto valorizado</th>
                  <th rowSpan="2" className="num gsep">Observadas</th>
                </tr>
                <tr>
                  <th className="num gsep">MEL</th><th className="num">La Negra</th><th className="num">Dif.</th>
                  <th className="num gsep">MEL</th><th className="num">La Negra</th><th className="num">Dif. kg</th><th className="num">Dif. %</th>
                  <th className="num gsep">MEL</th><th className="num">La Negra</th><th className="num">Dif.</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((x) => {
                  const fueraTol = x.dif_pct != null && Math.abs(x.dif_pct) > 2;
                  return (
                    <tr key={x.categoria}>
                      <td><b>{x.categoria}</b></td>
                      <td className="num gsep">{num(x.guias_mel)}</td>
                      <td className="num">{num(x.guias_recepcionadas)}</td>
                      <td className="num dif" style={x.dif_guias ? { color: 'var(--warn-tx)', fontWeight: 700 } : {}}>
                        {x.dif_guias == null ? '—' : x.dif_guias === 0 ? '0' : (x.dif_guias > 0 ? `+${x.dif_guias}` : x.dif_guias)}
                      </td>
                      <td className="num gsep">{fmtKg(x.kg_mel)}</td>
                      <td className="num">{fmtKg(x.kg_lanegra)}</td>
                      {/* Restar dos kilos que sí están en el cierre no es recalcularlo:
                          los cierres antiguos no guardaban la resta, pero sí sus términos. */}
                      <td className="num dif">{num(x.dif_kg ?? (x.kg_lanegra - x.kg_mel), fmtKg)}</td>
                      <td className="num dif" style={fueraTol ? { color: 'var(--bad-tx)', fontWeight: 700 } : {}}>
                        {x.dif_pct != null ? `${x.dif_pct.toFixed(2)} %` : '—'}
                      </td>
                      <td className="num gsep">
                        {num(x.monto_mel, fmtCLP)}
                        {x.montos_estimados > 0 && (
                          <sup style={{ color: 'var(--warn-tx)', marginLeft: 3, cursor: 'help' }}
                            title={`${x.montos_estimados} guía(s) sin recepcionar: valorizadas al precio que regía a su fecha, no al precio congelado`}>est.</sup>
                        )}
                      </td>
                      <td className="num">{num(x.monto_lanegra ?? x.monto, fmtCLP)}</td>
                      <td className="num dif" style={fueraTol ? { color: 'var(--bad-tx)', fontWeight: 700 } : {}}>
                        {num(x.dif_monto, fmtCLP)}
                      </td>
                      <td className="num gsep" style={x.observados ? { color: 'var(--warn-tx)', fontWeight: 700 } : {}}>{x.observados || '—'}</td>
                    </tr>
                  );
                })}
                {filas.length > 0 && (
                  <tr className="tot">
                    <td>{cat === 'todas' ? 'Total semana' : `Total · ${cat}`}</td>
                    <td className="num gsep">{sum('guias_mel')}</td>
                    <td className="num">{sum('guias_recepcionadas')}</td>
                    <td className="num dif">{sum('guias_recepcionadas') - sum('guias_mel') || '0'}</td>
                    <td className="num gsep">{fmtKg(sum('kg_mel'))}</td>
                    <td className="num">{fmtKg(sum('kg_lanegra'))}</td>
                    <td className="num dif">{fmtKg(sum('kg_lanegra') - sum('kg_mel'))}</td>
                    <td className="num dif">
                      {sum('kg_mel') ? `${(((sum('kg_lanegra') - sum('kg_mel')) / sum('kg_mel')) * 100).toFixed(2)} %` : '—'}
                    </td>
                    <td className="num gsep">{fmtCLP(sum('monto_mel'))}</td>
                    <td className="num">{fmtCLP(sum('monto_lanegra', 'monto'))}</td>
                    <td className="num dif">{fmtCLP(sum('monto_lanegra', 'monto') - sum('monto_mel'))}</td>
                    <td className="num gsep">{sum('observados') || '—'}</td>
                  </tr>
                )}
              </tbody>
            </table></div>
            {(() => {
              // Un cierre guarda la foto de lo que la cuadratura calculaba ese día.
              // Si después se agregaron dimensiones, esas columnas salen vacías: el
              // registro es inmutable a propósito, pero hay que decir por qué.
              if (!data.cerrada || !filas.length) return null;
              const faltan = [
                filas.every((x) => x.guias_mel == null) && 'la cantidad de guías',
                filas.every((x) => x.monto_mel == null) && 'el cruce de montos',
              ].filter(Boolean);
              if (!faltan.length) return null;
              return (
                <div className="card-b audit-note">
                  Este cierre se guardó cuando la cuadratura todavía no cruzaba {faltan.join(' ni ')}.
                  Esas columnas aparecen vacías porque <b>no forman parte del registro</b>: el cierre
                  es inmutable y no se recalcula. Las semanas que se cierren de ahora en adelante
                  guardan las tres dimensiones completas.
                </div>
              );
            })()}
            </>
          );
        })()}
        {data.detalle.length === 0 && !data.cerrada && <Empty title="Semana sin movimientos">No hay despachos ni traslados registrados en este rango.</Empty>}
        {data.cerrada?.observacion && <div className="card-b audit-note">Observación del cierre: {data.cerrada.observacion} — {data.cerrada.generada_por}</div>}
      </div>

      {(data.cerrada?.detalle ?? data.detalle).some((x) => x.kg_lampa_desp || x.kg_lampa_rec) && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-h"><h3>Traslados La Negra → Lampa</h3><small>cierre de la cadena de disposición final</small></div>
          <div className="tbl-wrap"><table>
            <thead><tr><th>Categoría</th><th className="num">Kg despachados</th><th className="num">Kg recibidos en Lampa</th><th className="num">Dif. kg</th><th className="num">En tránsito</th></tr></thead>
            <tbody>
              {(data.cerrada?.detalle ?? data.detalle).filter((x) => x.kg_lampa_desp || x.kg_lampa_rec).map((x) => (
                <tr key={x.categoria}>
                  <td><b>{x.categoria}</b></td>
                  <td className="num">{fmtKg(x.kg_lampa_desp)}</td>
                  <td className="num">{fmtKg(x.kg_lampa_rec)}</td>
                  <td className="num">{fmtKg(x.kg_lampa_rec - x.kg_lampa_desp)}</td>
                  <td className="num">{x.pendientes_transito || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      <div className="card">
        <div className="card-h"><h3>Cierres históricos</h3><small>últimas 12 semanas cerradas</small></div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Semana</th><th>Estado</th><th>Cerrada por</th><th>Observación</th></tr></thead>
          <tbody>
            {data.historico.map((c) => (
              <tr key={c.id}>
                <td className="mono">S{c.semana}/{c.anio}</td>
                <td><Chip tone={c.estado === 'cuadrada' ? 'ok' : 'warn'}>{c.estado === 'cuadrada' ? 'Cuadrada' : 'Con diferencias'}</Chip></td>
                <td>{c.generada_por}</td>
                <td style={{ color: 'var(--ink-2)', maxWidth: 320 }}>{c.observacion || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {data.historico.length === 0 && <Empty title="Sin cierres aún">La primera cuadratura cerrada quedará registrada aquí.</Empty>}
      </div>

      <Modal open={cerrar} title={`Cerrar cuadratura · semana ${data.semana}`} onClose={() => setCerrar(false)}
        footer={<>
          <button className="btn" onClick={() => setCerrar(false)}>Cancelar</button>
          <button className="btn primary" onClick={cerrarSemana}>Cerrar cuadratura</button>
        </>}>
        <p style={{ marginTop: 0, color: 'var(--ink-2)' }}>
          {hayDif
            ? 'La semana registra diferencias sobre el 2% o recepciones observadas: la observación es obligatoria y quedará en el registro.'
            : 'Los movimientos cuadran dentro de la tolerancia. El cierre guarda un registro inmutable de la semana.'}
        </p>
        <Field label={hayDif ? 'Observación (obligatoria)' : 'Observación (opcional)'}>
          <textarea rows="2" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej.: diferencia por humedad en fierro liviano; guía GD-1007 en revisión con vendor." />
        </Field>
      </Modal>
    </div>
  );
}
