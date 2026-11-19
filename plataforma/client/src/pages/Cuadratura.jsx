import { useEffect, useState } from 'react';
import { api, fmtCLP, fmtKg } from '../api.js';
import { Chip, Empty, Field, Modal, PageHead, SemanaEP, agruparPorGuia, useToast } from '../ui.jsx';
import { useAuth } from '../auth.jsx';

export default function Cuadratura() {
  const [data, setData] = useState(null);
  const [cerrar, setCerrar] = useState(false);   // false | 'nuevo' | 'rehacer'
  const [cat, setCat] = useState('todas');   // filtro de categoría de la tabla
  const [fila, setFila] = useState(null);    // fila abierta en el detalle guía a guía
  const [obs, setObs] = useState('');
  // Guías madre abiertas en el detalle: N° de guía MEL con sus componentes a la vista.
  const [abiertas, setAbiertas] = useState(() => new Set());
  const alternarGuia = (k) => setAbiertas((s) => {
    const n = new Set(s);
    if (!n.delete(k)) n.add(k);
    return n;
  });
  const { user } = useAuth();
  const toast = useToast();
  // Doble control: el ITO cierra la semana; el responsable de Lampa la confirma.
  const puedeCerrar = ['ito', 'coordinador'].includes(user.role);
  const puedeConfirmar = ['lampa', 'coordinador'].includes(user.role);

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
      const rehacer = cerrar === 'rehacer';
      const r = await api('/cuadratura/cerrar', { method: 'POST', body: { anio: data.anio, semana: data.semana, observacion: obs, rehacer } });
      toast(rehacer
        ? 'Cierre rehecho con los datos corregidos · Lampa debe confirmarlo de nuevo'
        : r.estado === 'cuadrada' ? 'Semana cuadrada sin diferencias' : 'Cuadratura cerrada con diferencias registradas');
      setCerrar(false); setObs('');
      load({ anio: data.anio, semana: data.semana });
    } catch (e) { toast(e.message, true); }
  }

  async function confirmarSemana() {
    try {
      await api('/cuadratura/confirmar', { method: 'POST', body: { anio: data.anio, semana: data.semana } });
      toast('Cuadratura confirmada por el responsable de Lampa');
      load({ anio: data.anio, semana: data.semana });
    } catch (e) { toast(e.message, true); }
  }

  // Desde qué diferencia de kilos una fila tiene algo que explicar: la
  // tolerancia de MEL del contrato (el servidor la manda); 2% en bases sin ella.
  const umbral = data.umbral_pct ?? 2;
  const hayDif = data.detalle.some((x) => x.observados > 0 || (x.dif_pct != null && Math.abs(x.dif_pct) > umbral));

  return (
    <div>
      <PageHead title="Cuadratura semanal de movimientos"
        sub="Cruce de la semana por categoría en sus tres dimensiones: cantidad de guías de despacho, kilos y monto valorizado. Haga clic en una categoría para ver guía a guía de dónde nace su diferencia. El cierre guarda un registro inmutable.">
        {!data.cerrada && data.detalle.length > 0 && puedeCerrar && (
          <button className="btn primary" onClick={() => setCerrar('nuevo')}>Cerrar cuadratura S{data.semana}</button>
        )}
        {data.cerrada && data.cambios_desde_cierre && puedeCerrar && (
          <button className="btn" onClick={() => { setCerrar('rehacer'); setObs(''); }}>Rehacer cierre S{data.semana}</button>
        )}
        {data.cerrada && !data.cerrada.confirmada_el && puedeConfirmar && (
          <button className="btn primary" onClick={confirmarSemana}>Confirmar cierre (Lampa)</button>
        )}
      </PageHead>

      {/* Lo que cambia después del cierre (una corrección, o guías de la semana
          registradas o recepcionadas más tarde) no altera lo que quedó cerrado:
          se avisa para que el cierre se rehaga. */}
      {data.cerrada && data.cambios_desde_cierre && (
        <div className="aviso">
          <b>Los datos de esta semana cambiaron después del cierre</b>
          <p>Desde el cierre se registraron, recepcionaron o corrigieron guías o traslados de esta semana. La tabla muestra lo que
          quedó cerrado el {new Date(data.cerrada.generada_el).toLocaleDateString('es-CL')};
          {puedeCerrar ? ' use «Rehacer cierre» para cerrarla con los datos corregidos.' : ' el ITO debe rehacer el cierre para incorporar la corrección.'}</p>
        </div>
      )}

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
            {data.cerrada && ('confirmada_el' in data.cerrada) && <> · <Chip tone={data.cerrada.confirmada_el ? 'ok' : 'warn'}>
              {data.cerrada.confirmada_el ? `Confirmada por ${data.cerrada.confirmada_por}` : 'Pendiente de confirmación de Lampa'}</Chip></>}
          </small>
        </div>
        <SemanaEP ep={data.ep} />
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
                  const fueraTol = x.dif_pct != null && Math.abs(x.dif_pct) > umbral;
                  const abrible = (x.guias ?? []).length > 0;
                  return (
                    <tr key={x.categoria} style={abrible ? { cursor: 'pointer' } : undefined}
                      onClick={abrible ? () => setFila(x) : undefined}
                      title={abrible ? 'Ver las guías que componen esta fila' : undefined}>
                      <td>
                        <b>{x.categoria}</b>
                        {abrible && <span className="abrir" aria-hidden="true">Ver guías ›</span>}
                      </td>
                      <td className="num gsep" title={x.componentes > 0 ? `${x.guias_mel} guía(s) de MEL; dentro vienen ${x.componentes} componente(s) obsoleto(s), agrupados por su guía` : undefined}>{num(x.guias_mel)}</td>
                      <td className="num">{num(x.guias_recepcionadas)}</td>
                      <td className="num dif" style={x.dif_guias ? { color: 'var(--warn-tx)', fontWeight: 700 } : {}}>
                        {x.dif_guias == null ? '—' : x.dif_guias === 0 ? '0' : (x.dif_guias > 0 ? `+${x.dif_guias}` : x.dif_guias)}
                      </td>
                      <td className="num gsep">{fmtKg(x.kg_mel)}</td>
                      <td className="num" title={x.kg_descontados > 0 ? `Incluye ${fmtKg(x.kg_descontados)} kg descontados (madera u otros): no se valorizan ni cuentan como diferencia` : undefined}>
                        {fmtKg(x.kg_lanegra)}
                        {x.kg_descontados > 0 && <><br /><small style={{ color: 'var(--muted)' }}>−{fmtKg(x.kg_descontados)} madera</small></>}
                      </td>
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
          <thead><tr><th>Semana</th><th>Estado</th><th>Cerrada por</th><th>Confirmación Lampa</th><th>Observación</th></tr></thead>
          <tbody>
            {data.historico.map((c) => (
              <tr key={c.id}>
                <td className="mono">S{c.semana}/{c.anio}</td>
                <td><Chip tone={c.estado === 'cuadrada' ? 'ok' : 'warn'}>{c.estado === 'cuadrada' ? 'Cuadrada' : 'Con diferencias'}</Chip></td>
                <td>{c.generada_por}</td>
                <td>{('confirmada_el' in c)
                  ? (c.confirmada_el ? <Chip tone="ok">{c.confirmada_por}</Chip> : <Chip tone="warn">Pendiente</Chip>)
                  : '—'}</td>
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
          // Componentes obsoletos que viajaron con la misma guía de MEL: una sola
          // fila («guía madre») que se abre para ver cada uno con su SKU.
          const items = agruparPorGuia(fila.guias, (g) => !!g.componente_codigo);
          // Suma de una columna entre las guías que la tienen; null si ninguna.
          const suma = (f, k) => (f.some((g) => g[k] != null) ? f.reduce((a, g) => a + Number(g[k] ?? 0), 0) : null);
          // El mismo N° de guía MEL cargado como despacho normal y, además, como
          // componentes: si es la misma carga, sus kilos están dos veces en la
          // semana. Se avisa en ambos lados.
          const normalesDe = new Map(), componentesDe = new Map();
          for (const g of fila.guias) {
            if (!g.guia_mel) continue;
            const k = String(g.guia_mel).trim();
            const m = g.componente_codigo ? componentesDe : normalesDe;
            if (!(m.get(k) ?? []).includes(g.guia)) m.set(k, [...(m.get(k) ?? []), g.guia]);
          }
          const DOBLE = 'Si es la misma carga, sus kilos están dos veces: revise y anule el registro que sobre.';
          const avisoDoble = (g) => {
            const otros = g.guia_mel ? (g.componente_codigo ? normalesDe : componentesDe).get(String(g.guia_mel).trim()) : null;
            if (!otros?.length) return null;
            return (
              <small style={{ display: 'block', color: 'var(--warn-tx)', fontWeight: 600 }}
                title={`El mismo N° de guía MEL está registrado también como ${g.componente_codigo ? `despacho normal (${otros.join(', ')})` : `${otros.length} componente(s) obsoleto(s)`}. ${DOBLE}`}>
                ⚠ También {g.componente_codigo ? `en ${otros.join(', ')}` : `como ${otros.length} componente${otros.length === 1 ? '' : 's'}`}</small>
            );
          };
          const filaGrupo = ({ guia_mel, filas: f }) => {
            const abierta = abiertas.has(guia_mel);
            const fechas = f.map((g) => g.fecha).sort();
            const conDif = f.filter((g) => g.dif_kg != null);
            const difKg = suma(conDif, 'dif_kg');
            // El % se mide contra los kilos de MEL de las mismas guías; si alguna
            // no los aporta a esta fila (reclasificada), se muestra solo en kilos.
            const baseDif = conDif.every((g) => g.kg_origen != null) ? suma(conDif, 'kg_origen') : null;
            const difPct = difKg != null && baseDif ? (difKg / baseDif) * 100 : null;
            const kgDesc = f.reduce((a, g) => a + (g.kg_destino != null ? Number(g.kg_descontados ?? 0) : 0), 0);
            const conDesc = f.filter((g) => (g.descuentos ?? []).length);
            const descMonto = conDesc.reduce((a, g) => a + Number(g.desc_monto ?? 0), 0);
            const otros = normalesDe.get(guia_mel) ?? [];
            const n = (v, fmt = fmtKg) => (v == null ? '—' : fmt(v));
            return (
              <tr key={`g-${guia_mel}`} className="grupo" aria-expanded={abierta} onClick={() => alternarGuia(guia_mel)}
                title={abierta ? 'Ocultar los componentes de esta guía' : 'Ver los componentes que vienen en esta guía'}>
                <td>
                  <span className="flecha" aria-hidden="true">{abierta ? '▾' : '▸'}</span>
                  <b>Guía MEL <span className="mono">{guia_mel}</span></b>
                  <small className="sub">{f.length} componentes · {abierta ? 'ocultar' : 'ver'}</small>
                  {otros.length > 0 && (
                    <small className="sub" style={{ color: 'var(--warn-tx)', fontWeight: 600 }}
                      title={`El mismo N° de guía MEL está registrado también como despacho normal (${otros.join(', ')}). ${DOBLE}`}>
                      ⚠ También en {otros.join(', ')}</small>
                  )}
                </td>
                <td className="mono">{fechas[0] === fechas[fechas.length - 1] ? fechas[0] : <>{fechas[0]}<br />a {fechas[fechas.length - 1]}</>}</td>
                <td className="num"><b>{n(suma(f, 'kg_origen'))}</b></td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  <b>{n(suma(f, 'kg_destino'))}</b>
                  {kgDesc > 0 && <><br /><small style={{ color: 'var(--muted)' }}>−{fmtKg(kgDesc)} descontados</small></>}
                </td>
                <td className="num" style={{ whiteSpace: 'nowrap', ...(Math.abs(difPct ?? 0) > umbral ? { color: 'var(--bad-tx)', fontWeight: 700 } : {}) }}>
                  {difKg != null ? `${fmtKg(Math.round(difKg * 10) / 10)}${difPct != null ? ` (${difPct.toFixed(2)} %)` : ''}` : '—'}
                </td>
                <td className="num"><b>{n(suma(f, 'kg_contrato'))}</b></td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}><b>{n(suma(f, 'monto_mel'), fmtCLP)}</b></td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}><b>{n(suma(f, 'monto_lanegra'), fmtCLP)}</b></td>
                <td>
                  {conDesc.length === 0 ? <span style={{ color: 'var(--muted)' }}>—</span> : (
                    <small style={{ color: 'var(--bad-tx)', fontWeight: 700 }}>
                      {conDesc.length} con descuentos{descMonto > 0 && <> · -{fmtCLP(descMonto)}</>}</small>
                  )}
                </td>
              </tr>
            );
          };
          // `hija`: la guía va dentro de una guía madre abierta, que ya dice el N° MEL.
          const filaGuia = (g, hija = false) => (
                    <tr key={g.guia + g.lado} className={hija ? 'hija' : undefined}>
                      <td>
                        <span className="mono">{g.guia}</span>
                        {!hija && g.guia_mel && <><br /><small style={{ color: 'var(--muted)' }}>MEL N° {g.guia_mel}</small></>}
                        {/* Componente obsoleto del que nace la guía. */}
                        {g.componente_codigo && (
                          <><br /><small className="mono" style={{ whiteSpace: 'nowrap' }} title={g.componente_nombre ?? 'SKU del componente obsoleto'}>SKU {g.componente_codigo}</small></>
                        )}
                        {g.componente_nombre && <small className="dos-lineas llena" title={g.componente_nombre}>{g.componente_nombre}</small>}
                        {!hija && avisoDoble(g)}
                      </td>
                      <td className="mono">{g.fecha}</td>
                      <td className="num">{g.kg_origen != null ? fmtKg(g.kg_origen) : '—'}</td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>
                        {g.kg_destino != null ? fmtKg(g.kg_destino) : '—'}
                        {/* Madera, pallets: se restan del pesaje, no se valorizan. */}
                        {g.kg_destino != null && g.kg_descontados > 0 && (
                          <><br /><small style={{ color: 'var(--muted)' }}
                            title="Kilos que no son material (madera, pallets): se restan del pesaje de La Negra antes de compararlo con el de MEL y no se valorizan">
                            −{fmtKg(g.kg_descontados)} = {fmtKg(g.kg_destino - g.kg_descontados)}</small></>
                        )}
                      </td>
                      <td className="num" style={{ whiteSpace: 'nowrap', ...(Math.abs(g.dif_pct ?? 0) > umbral ? { color: 'var(--bad-tx)', fontWeight: 700 } : {}) }}>
                        {g.dif_kg != null ? `${fmtKg(g.dif_kg)} (${g.dif_pct.toFixed(2)} %)` : '—'}
                      </td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>
                        {g.kg_contrato != null ? (
                          <>{fmtKg(g.kg_contrato)}<br />
                            <small style={{ color: g.regla_peso === 'pendiente' ? 'var(--warn-tx)' : 'var(--muted)' }}>
                              {{ mel: 'MEL', lampa: 'La Negra', pendiente: 'por acordar', acuerdo: 'acordado' }[g.regla_peso] ?? ''}
                            </small></>
                        ) : '—'}
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
                                  {d.tipo === 'pct' ? `${d.valor} %` : d.tipo === 'usd' ? `USD ${d.valor}`
                                    : d.tipo === 'clp' ? fmtCLP(d.valor) : `${fmtKg(d.valor)} kg`}
                                </b> · {d.glosa}
                              </div>
                            ))}
                            {g.desc_monto > 0 && (
                              <small style={{ color: 'var(--bad-tx)', fontWeight: 700 }}>-{fmtCLP(g.desc_monto)}</small>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
          );
          return (
            <>
              <div className="cotejo">
                <span><small>Guías</small>
                  <b className="mono">{fila.guias_mel ?? '—'} → {fila.guias_recepcionadas ?? '—'}</b>
                  {fila.componentes > 0 && (
                    <small style={{ display: 'block', color: 'var(--muted)' }}>
                      con {fila.componentes} componentes obsoletos</small>
                  )}</span>
                <span><small>Kilos</small>
                  <b className="mono">{fmtKg(fila.kg_mel)} → {fmtKg(fila.kg_lanegra)}</b>
                  {fila.kg_descontados > 0 && (
                    <small style={{ display: 'block', color: 'var(--muted)' }}>
                      incluye {fmtKg(fila.kg_descontados)} kg descontados (madera u otros)</small>
                  )}</span>
                <span><small>Diferencia</small>
                  <b className="mono" style={Math.abs(fila.dif_pct ?? 0) > umbral ? { color: 'var(--bad-tx)' } : undefined}>
                    {fila.dif_pct != null ? `${fila.dif_pct.toFixed(2)} %` : '—'}
                    {fila.dif_monto != null && <> · {fmtCLP(fila.dif_monto)}</>}
                  </b></span>
              </div>
              <div className="tbl-wrap"><table className="densa cabecera-libre">
                <thead><tr>
                  <th>Guía</th><th>Fecha</th>
                  <th className="num">Kg MEL</th><th className="num">Kg La Negra</th><th className="num">Dif.</th>
                  <th className="num" title="Peso que se valoriza según la regla del contrato">Rige</th>
                  <th className="num">Monto MEL</th><th className="num">Monto La Negra</th><th>Descuentos</th>
                </tr></thead>
                <tbody>
                  {items.flatMap((it) => (it.filas
                    ? [filaGrupo(it), ...(abiertas.has(it.guia_mel) ? it.filas.map((g) => filaGuia(g, true)) : [])]
                    : [filaGuia(it.d)]))}
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

      <Modal open={!!cerrar} title={`${cerrar === 'rehacer' ? 'Rehacer cierre' : 'Cerrar cuadratura'} · semana ${data.semana}`} onClose={() => setCerrar(false)}
        footer={<>
          <button className="btn" onClick={() => setCerrar(false)}>Cancelar</button>
          <button className="btn primary" onClick={cerrarSemana}>{cerrar === 'rehacer' ? 'Rehacer cierre' : 'Cerrar cuadratura'}</button>
        </>}>
        <p style={{ marginTop: 0, color: 'var(--ink-2)' }}>
          {cerrar === 'rehacer'
            ? 'Se reemplaza lo cerrado por los datos actuales, que incluyen las correcciones. El cierre anterior queda en la bitácora, y el responsable de Lampa debe confirmarlo de nuevo.'
            : hayDif
              ? `La semana registra diferencias sobre el ${umbral}% o recepciones observadas: la observación es obligatoria y quedará en el registro.`
              : 'Los movimientos cuadran dentro de la tolerancia. El cierre guarda un registro inmutable de la semana.'}
        </p>
        <Field label={cerrar === 'rehacer' ? 'Motivo (obligatorio)' : hayDif ? 'Observación (obligatoria)' : 'Observación (opcional)'}>
          <textarea rows="2" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej.: diferencia por humedad en fierro liviano; guía GD-1007 en revisión con vendor." />
        </Field>
      </Modal>
    </div>
  );
}
