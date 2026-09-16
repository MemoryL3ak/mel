import { useEffect, useState } from 'react';
import { api, fmtCLP, fmtKg } from '../api.js';
import { Chip, Empty, Field, Modal, PageHead, useToast } from '../ui.jsx';

export default function Cuadratura() {
  const [data, setData] = useState(null);
  const [cerrar, setCerrar] = useState(false);
  const [cat, setCat] = useState('todas');   // filtro de categoría de la tabla
  const [fila, setFila] = useState(null);    // fila abierta en el detalle guía a guía
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
        sub="Cruce de la semana por categoría en sus tres dimensiones: cantidad de guías de despacho, kilos y monto valorizado. Haga clic en una categoría para ver guía a guía de dónde nace su diferencia. El cierre guarda un registro inmutable.">
        {!data.cerrada && data.detalle.length > 0 && (
          <button className="btn primary" onClick={() => setCerrar(true)}>Cerrar cuadratura S{data.semana}</button>
        )}
      </PageHead>

      {/* Lo que la semana tiene que explicar, antes de la tabla: si hay que
          buscarlo entre las cifras, no es una alerta. */}
      {(data.alertas ?? []).length > 0 && (
        <div className="alertas">
          {data.alertas.map((a, i) => (
            <div key={i} className={`alerta ${a.tono}`}>
              {a.categoria && <b>{a.categoria}</b>}
              <span>{a.texto}</span>
            </div>
          ))}
        </div>
      )}

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
                  <th colSpan="4" className="gh gsep">Monto valorizado</th>
                  <th rowSpan="2" className="num gsep">Observadas</th>
                </tr>
                <tr>
                  <th className="num gsep">MEL</th><th className="num">La Negra</th><th className="num">Dif.</th>
                  <th className="num gsep">MEL</th><th className="num">La Negra</th><th className="num">Dif. kg</th><th className="num">Dif. %</th>
                  <th className="num gsep">MEL</th><th className="num">La Negra</th><th className="num">Dif.</th><th className="num">Descuentos</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((x) => {
                  const fueraTol = x.dif_pct != null && Math.abs(x.dif_pct) > 2;
                  const abrible = (x.guias ?? []).length > 0;
                  return (
                    <tr key={x.categoria} style={abrible ? { cursor: 'pointer' } : undefined}
                      onClick={abrible ? () => setFila(x) : undefined}
                      title={abrible ? 'Ver las guías que componen esta fila' : undefined}>
                      <td>
                        <b>{x.categoria}</b>
                        {abrible && <span className="abrir" aria-hidden="true">Ver guías ›</span>}
                      </td>
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
                      <td className="num" style={x.desc_monto ? { color: 'var(--bad-tx)', fontWeight: 600 } : {}}
                        title={x.desc_guias ? `${x.desc_guias} guía(s) con descuentos` : undefined}>
                        {x.desc_monto ? <>-{fmtCLP(x.desc_monto)}{x.desc_pct != null && <><br /><small>{x.desc_pct.toFixed(2)} %</small></>}</> : '—'}
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
                    <td className="num">{sum('desc_monto') ? `-${fmtCLP(sum('desc_monto'))}` : '—'}</td>
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
                filas.every((x) => !(x.guias ?? []).length) && 'el detalle guía a guía',
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

      {(data.anuladas ?? []).length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-h"><h3>Guías anuladas en la semana</h3><small>no suman a la cuadratura</small></div>
          <div className="tbl-wrap"><table>
            <thead><tr><th>Guía</th><th>Fecha</th><th>Motivo</th><th>Anulada por</th></tr></thead>
            <tbody>
              {data.anuladas.map((a) => (
                <tr key={a.guia}>
                  <td className="mono">{a.guia}</td>
                  <td className="mono">{a.fecha}</td>
                  <td style={{ color: 'var(--ink-2)' }}>{a.motivo || '—'}</td>
                  <td>{a.anulada_por || '—'}</td>
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

      <Modal ancho open={!!fila} title={fila && `${fila.categoria} · semana ${data.semana}`} onClose={() => setFila(null)}
        footer={<button className="btn" onClick={() => setFila(null)}>Cerrar</button>}>
        {fila && (() => {
          // Por qué una guía aporta a un solo lado de la fila: o se reclasificó
          // al recepcionar, o todavía no llega a La Negra.
          const porQue = (g) => {
            if (g.lado === 'ambos') return null;
            if (g.lado === 'mel') {
              return g.categoria_final
                ? `Se despachó como ${fila.categoria} y se recibió como ${g.categoria_final}: los kilos de destino suman en esa otra categoría.`
                : 'Todavía no se recepciona en La Negra: por eso no hay kilos de destino.';
            }
            return `Se despachó como ${g.categoria_origen}: los kilos de origen suman en esa otra categoría.`;
          };
          return (
            <>
              <div className="cotejo">
                <span><small>Guías</small>
                  <b className="mono">{fila.guias_mel ?? '—'} → {fila.guias_recepcionadas ?? '—'}</b></span>
                <span><small>Kilos</small>
                  <b className="mono">{fmtKg(fila.kg_mel)} → {fmtKg(fila.kg_lanegra)}</b></span>
                <span><small>Diferencia</small>
                  <b className="mono" style={Math.abs(fila.dif_pct ?? 0) > 2 ? { color: 'var(--bad-tx)' } : undefined}>
                    {fila.dif_pct != null ? `${fila.dif_pct.toFixed(2)} %` : '—'}
                    {fila.dif_monto != null && <> · {fmtCLP(fila.dif_monto)}</>}
                  </b></span>
              </div>
              <div className="tbl-wrap"><table>
                <thead><tr>
                  <th>Guía</th><th>Fecha</th>
                  <th className="num">Kg MEL</th><th className="num">Kg La Negra</th><th className="num">Dif.</th>
                  <th className="num">Monto MEL</th><th className="num">Monto La Negra</th><th>Descuentos</th>
                </tr></thead>
                <tbody>
                  {fila.guias.map((g) => (
                    <tr key={g.guia + g.lado}>
                      <td>
                        <span className="mono">{g.guia}</span>
                        {g.guia_mel && <><br /><small style={{ color: 'var(--muted)' }}>MEL N° {g.guia_mel}</small></>}
                      </td>
                      <td className="mono">{g.fecha}</td>
                      <td className="num">{g.kg_origen != null ? fmtKg(g.kg_origen) : '—'}</td>
                      <td className="num">{g.kg_destino != null ? fmtKg(g.kg_destino) : '—'}</td>
                      <td className="num" style={Math.abs(g.dif_pct ?? 0) > 2 ? { color: 'var(--bad-tx)', fontWeight: 700 } : {}}>
                        {g.dif_kg != null ? `${fmtKg(g.dif_kg)} (${g.dif_pct.toFixed(2)} %)` : '—'}
                      </td>
                      <td className="num">
                        {g.monto_mel != null ? fmtCLP(g.monto_mel) : '—'}
                        {g.monto_mel != null && g.precio_estimado && (
                          <sup style={{ color: 'var(--warn-tx)', marginLeft: 3 }}>est.</sup>
                        )}
                      </td>
                      <td className="num">{g.monto_lanegra != null ? fmtCLP(g.monto_lanegra) : '—'}</td>
                      <td style={{ maxWidth: 260 }}>
                        {(g.descuentos ?? []).length === 0 ? <span style={{ color: 'var(--muted)' }}>—</span> : (
                          <>
                            {g.descuentos.map((d, i) => (
                              <div key={i} style={{ fontSize: 12, lineHeight: 1.45 }}>
                                <b style={{ color: 'var(--bad-tx)' }}>
                                  {d.tipo === 'pct' ? `${d.valor} %` : d.tipo === 'usd' ? `USD ${d.valor}` : `${fmtKg(d.valor)} kg`}
                                </b> · {d.glosa}
                              </div>
                            ))}
                            {g.desc_monto != null && (
                              <small style={{ color: 'var(--bad-tx)', fontWeight: 700 }}>-{fmtCLP(g.desc_monto)}</small>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              {fila.guias.filter((g) => porQue(g)).map((g) => (
                <div className="audit-note" key={g.guia + g.lado}>
                  <b className="mono">{g.guia}</b> — {porQue(g)}
                </div>
              ))}
            </>
          );
        })()}
      </Modal>

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
