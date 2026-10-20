import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, descargar, fmtCLP, fmtKg, fmtUSD } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Chip, Empty, KPI, PageHead, Select, Tabs, useToast } from '../ui.jsx';

// Fase 4 · Indicadores y reportes. Los gráficos son SVG propios: pocas series,
// marcas finas, una sola escala por gráfico, leyenda cuando hay más de una
// serie, etiqueta directa solo en lo que importa, tooltip al pasar y una tabla
// gemela para leer cada cifra sin el gráfico. Paleta validada contra el fondo
// blanco de las tarjetas (ver styles.css, .viz-root).
const EYEBROW = 'Indicadores';
const SERIE = { s1: 'var(--viz-1)', s2: 'var(--viz-2)', s3: 'var(--viz-3)', s4: 'var(--viz-4)' };
const ORDINAL = ['var(--viz-o1)', 'var(--viz-o2)', 'var(--viz-o3)', 'var(--viz-o4)', 'var(--viz-o5)', 'var(--viz-o6)'];

// Eje y compacto: 226.785 → «227 k», 235.867.568 → «236 M».
const compacto = (n, prefijo = '') => {
  const v = Math.abs(n);
  const t = v >= 1e9 ? `${(n / 1e9).toLocaleString('es-CL', { maximumFractionDigits: 1 })} mM`
    : v >= 1e6 ? `${(n / 1e6).toLocaleString('es-CL', { maximumFractionDigits: 1 })} M`
    : v >= 1e3 ? `${(n / 1e3).toLocaleString('es-CL', { maximumFractionDigits: 0 })} k`
    : n.toLocaleString('es-CL', { maximumFractionDigits: 0 });
  return prefijo + t;
};
// Tope «limpio» del eje: 1 · 2 · 2,5 · 5 · 10 por potencia de diez.
const techo = (max) => {
  if (!(max > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  const m = max / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
};
const pct = (v) => (v == null ? '—' : `${v.toLocaleString('es-CL', { maximumFractionDigits: 1 })} %`);
const d1 = (v) => (v == null ? '—' : v.toLocaleString('es-CL', { maximumFractionDigits: 1 }));
const deltaTxt = (v, contra) => (v == null ? null : `${v > 0 ? '▲' : v < 0 ? '▼' : '▬'} ${Math.abs(v).toLocaleString('es-CL', { maximumFractionDigits: 1 })} % vs ${contra}`);

/* ---------------- gráfico de columnas (agrupadas o apiladas) ---------------- */

// `anchoDibujo` es el ancho del dibujo: a media columna se usa uno menor para que el
// texto no se achique al escalar. `entero` deja los ticks en números enteros.
function Columnas({ titulo, sub, categorias, series, fmt, fmtEje, apilado = false, resaltar = null, alto = 230, anchoDibujo = 760, entero = false }) {
  const [hover, setHover] = useState(null);
  const [tabla, setTabla] = useState(false);
  const W = anchoDibujo, H = alto, PL = 58, PR = 14, PT = 22, PB = 30;
  const plotW = W - PL - PR, plotH = H - PT - PB;
  const n = categorias.length;
  const totales = categorias.map((_, i) => series.reduce((a, s) => a + (s.valores[i] || 0), 0));
  const max = apilado ? Math.max(...totales) : Math.max(...series.flatMap((s) => s.valores));
  const top = entero ? Math.max(4, Math.ceil(max / 4) * 4) : techo(max);
  const y = (v) => PT + plotH - (v / top) * plotH;
  const band = plotW / n;
  const porBanda = apilado ? 1 : series.length;
  const ancho = Math.min(24, (band - 10) / porBanda);
  const grupo = ancho * porBanda + 2 * (porBanda - 1);
  const x0 = (i) => PL + band * i + (band - grupo) / 2;
  const ticks = [0.25, 0.5, 0.75, 1].map((f) => f * top);
  // Etiqueta directa solo en la columna más alta y en la última con dato.
  const iMax = totales.indexOf(Math.max(...totales));
  const iUlt = totales.map((t, i) => (t > 0 ? i : -1)).filter((i) => i >= 0).pop();
  const conEtiqueta = new Set([iMax, iUlt].filter((i) => i != null && i >= 0 && totales[i] > 0));
  const cap = (x, yv, w, h, redondo) => (h <= 0 ? '' : redondo && h > 4
    ? `M${x},${yv + h} V${yv + 4} Q${x},${yv} ${x + 4},${yv} H${x + w - 4} Q${x + w},${yv} ${x + w},${yv + 4} V${yv + h} Z`
    : `M${x},${yv + h} V${yv} H${x + w} V${yv + h} Z`);
  const vacio = max <= 0;

  return (
    <div className="card viz-card">
      <div className="card-h">
        <div><h3>{titulo}</h3>{sub && <small>{sub}</small>}</div>
        <button className="btn sm" onClick={() => setTabla(!tabla)}>{tabla ? 'Gráfico' : 'Tabla'}</button>
      </div>
      {tabla ? (
        <div className="tbl-wrap"><table className="viz-tabla">
          <thead><tr><th></th>{series.map((s) => <th key={s.nombre} className="num">{s.nombre}</th>)}{apilado && series.length > 1 && <th className="num">Total</th>}</tr></thead>
          <tbody>{categorias.map((c, i) => (
            <tr key={c}><td>{c}</td>{series.map((s) => <td key={s.nombre} className="num">{fmt(s.valores[i] || 0)}</td>)}{apilado && series.length > 1 && <td className="num"><b>{fmt(totales[i])}</b></td>}</tr>
          ))}</tbody>
        </table></div>
      ) : (
        <div className="viz-plot" onMouseLeave={() => setHover(null)}>
          {series.length > 1 && (
            <div className="viz-leyenda">{series.map((s) => <span key={s.nombre}><i style={{ background: s.color }} />{s.nombre}</span>)}</div>
          )}
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={titulo}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} className="viz-grid" />
                <text x={PL - 8} y={y(t) + 4} textAnchor="end" className="viz-eje">{fmtEje(t)}</text>
              </g>
            ))}
            <line x1={PL} x2={W - PR} y1={y(0)} y2={y(0)} className="viz-base" />
            {categorias.map((c, i) => {
              let acum = 0;
              return (
                <g key={c}>
                  {series.map((s, k) => {
                    const v = s.valores[i] || 0;
                    if (apilado) {
                      const h = (v / top) * plotH;
                      const esTope = series.slice(k + 1).every((s2) => !(s2.valores[i] > 0));
                      const yv = y(acum + v);
                      acum += v;
                      // 2 px de superficie entre segmentos, sin borde.
                      const hGap = esTope ? h : Math.max(h - 2, 0);
                      return <path key={s.nombre} d={cap(x0(i), yv + (esTope ? 0 : 2), ancho, hGap, esTope)} fill={s.color} opacity={hover == null || hover === i ? 1 : 0.55} />;
                    }
                    const h = (v / top) * plotH;
                    const atenuado = resaltar != null && k !== resaltar;
                    return <path key={s.nombre} d={cap(x0(i) + k * (ancho + 2), y(v), ancho, h, true)} fill={atenuado ? 'var(--viz-gris)' : s.color} opacity={hover == null || hover === i ? 1 : 0.55} />;
                  })}
                  {conEtiqueta.has(i) && (
                    <text x={x0(i) + grupo / 2} y={y(apilado ? totales[i] : Math.max(...series.map((s) => s.valores[i] || 0))) - 6} textAnchor="middle" className="viz-etiqueta">
                      {fmt(apilado ? totales[i] : Math.max(...series.map((s) => s.valores[i] || 0)))}
                    </text>
                  )}
                  <text x={PL + band * i + band / 2} y={H - 10} textAnchor="middle" className="viz-eje">{c}</text>
                  {/* Zona de hover más ancha que la marca: toda la banda. */}
                  <rect x={PL + band * i} y={PT} width={band} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
                </g>
              );
            })}
          </svg>
          {vacio && <div className="viz-vacio">Sin datos en el año</div>}
          {hover != null && !vacio && (
            <div className="viz-tooltip" style={{ left: `${((PL + band * hover + band / 2) / W) * 100}%` }}>
              <b>{categorias[hover]}</b>
              {series.map((s) => <div key={s.nombre}><i style={{ background: s.color }} /><strong>{fmt(s.valores[hover] || 0)}</strong><span>{s.nombre}</span></div>)}
              {apilado && series.length > 1 && <div className="tot"><strong>{fmt(totales[hover])}</strong><span>total</span></div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- barras horizontales por etapa (rampa ordinal) ---------------- */

function BarrasEtapas({ titulo, sub, filas, fmt, extra }) {
  const max = Math.max(1, ...filas.map((f) => f.valor));
  return (
    <div className="card viz-card">
      <div className="card-h"><div><h3>{titulo}</h3>{sub && <small>{sub}</small>}</div></div>
      <div className="card-b">
        <div className="viz-etapas" role="table" aria-label={titulo}>
          {filas.map((f, i) => (
            <div key={f.nombre} className="viz-etapa" role="row" title={`${f.nombre}: ${fmt(f.valor)}${f.detalle ? ` · ${f.detalle}` : ''}`}>
              <span className="n" role="cell">{f.nombre}</span>
              <span className="b" role="cell"><i style={{ width: `${(f.valor / max) * 100}%`, background: f.color ?? ORDINAL[Math.min(i, ORDINAL.length - 1)] }} /></span>
              <span className="v" role="cell"><b>{fmt(f.valor)}</b>{f.detalle && <small>{f.detalle}</small>}</span>
            </div>
          ))}
        </div>
        {extra}
      </div>
    </div>
  );
}

const Dato = ({ label, value, sub }) => (
  <div className="viz-dato"><span className="lbl">{label}</span><span className="val">{value}</span>{sub && <span className="sub">{sub}</span>}</div>
);

/* ============================ página ============================ */

export default function Indicadores() {
  const { user } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const puedeChatarra = ['coordinador', 'ito'].includes(user.role);
  const puedeObsoletos = ['coordinador', 'admin_venta'].includes(user.role);
  const tab = params.get('t') ?? (puedeChatarra ? 'chatarra' : 'obsoletos');
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const anio = params.get('anio') ?? '';
  const periodo = params.get('periodo') ?? '';
  const setP = (cambios) => {
    const n = Object.fromEntries(params);
    for (const [k, v] of Object.entries(cambios)) { if (v == null || v === '') delete n[k]; else n[k] = v; }
    setParams(n, { replace: true });
  };

  // Al cambiar el filtro se mantiene lo dibujado, atenuado, hasta que llega lo nuevo.
  useEffect(() => {
    setCargando(true);
    const qs = new URLSearchParams(); if (anio) qs.set('anio', anio); if (periodo) qs.set('periodo', periodo);
    api(`/indicadores?${qs}`).then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message)).finally(() => setCargando(false));
  }, [anio, periodo]);

  if (error && !data) return <div><PageHead eyebrow={EYEBROW} title="Indicadores y reportes" /><div className="aviso bad"><b>No se pudieron calcular los indicadores.</b><p>{error}</p></div></div>;
  if (!data) return <div className="loading">Calculando indicadores…</div>;

  const anios = []; for (let a = Number(data.vigente.slice(0, 4)); a >= 2026; a--) anios.push(a);
  const exportarExcel = async () => {
    try {
      const qs = new URLSearchParams({ pestana: tab, anio: String(data.anio), periodo: data.periodo.periodo });
      await descargar(`/indicadores/excel?${qs}`, tab === 'chatarra' ? `indicadores-chatarra-${data.periodo.periodo}.xlsx` : `indicadores-obsoletos-${data.anio}.xlsx`);
    } catch (e) { toast(e.message, true); }
  };
  // PDF: la vista de impresión del panel, como el estado de pago.
  const exportarPDF = () => {
    document.body.classList.add('print-indicadores');
    const quitar = () => { document.body.classList.remove('print-indicadores'); window.removeEventListener('afterprint', quitar); };
    window.addEventListener('afterprint', quitar);
    window.print();
  };

  const ch = data.chatarra, ob = data.obsoletos;
  const per = data.periodo;
  const tabs = [...(puedeChatarra ? [['chatarra', 'Proceso de chatarra']] : []), ...(puedeObsoletos ? [['obsoletos', 'Venta de obsoletos']] : [])];

  return (
    <div className={`viz-root indicadores${cargando ? ' viz-cargando' : ''}`}>
      <PageHead eyebrow={EYEBROW} title="Indicadores y reportes"
        sub="Paneles de gestión de ambos procesos. El proceso de chatarra se mide por período del estado de pago; la venta de obsoletos, por mes.">
        <button className="btn no-print" onClick={exportarExcel}>⇩ Excel</button>
        <button className="btn no-print" onClick={exportarPDF}>⇩ PDF</button>
      </PageHead>

      {/* Una sola fila de filtros, sobre todo lo que acotan. */}
      <div className="viz-filtros no-print">
        <label>Año
          <Select value={String(data.anio)} onChange={(e) => setP({ anio: e.target.value, periodo: null })}>
            {anios.map((a) => <option key={a} value={String(a)}>{a}</option>)}
          </Select>
        </label>
        {tab === 'chatarra' && (
          <label>Período del estado de pago
            <Select value={per.periodo} onChange={(e) => setP({ periodo: e.target.value })}>
              {data.periodos.map((p) => <option key={p.periodo} value={p.periodo}>{p.nombre} · {p.desde.slice(5)} → {p.hasta.slice(5)}{p.periodo === data.vigente ? ' · en curso' : ''}</option>)}
            </Select>
          </label>
        )}
        <span className="viz-corte">Corte el día {data.corte} · {tab === 'chatarra' ? `${per.desde} → ${per.hasta}` : `año ${data.anio}`}</span>
      </div>
      <div className="solo-print viz-print-cab">
        GEA · Minera Escondida · {tab === 'chatarra' ? `Indicadores del proceso de chatarra · ${per.nombre} (${per.desde} → ${per.hasta})` : `Indicadores de venta de obsoletos · ${data.anio}`} · generado el {new Date().toLocaleDateString('es-CL')}
      </div>

      {tabs.length > 1 && <div className="no-print"><Tabs active={tab} onChange={(t) => setP({ t })} tabs={tabs} /></div>}

      {/* ============================ chatarra ============================ */}
      {tab === 'chatarra' && ch && (() => {
        const a = ch.actual, y = ch.ytd, c = ch.ciclo, k = ch.calidad;
        const contra = ch.anterior ? ch.anterior.nombre.replace(/^EP /, 'EP ') : 'período anterior';
        return (<>
          <div className="grid g4 viz-kpis">
            <KPI label={`Patios MEL · ${per.etiqueta}`} value={fmtKg(a.kg_patios)} unit="kg" delta={deltaTxt(a.delta_kg_patios, contra) ?? `${a.guias} guía(s) despachada(s)`} />
            <KPI label={`La Negra · ${per.etiqueta}`} value={fmtKg(a.kg_lanegra)} unit="kg" delta={deltaTxt(a.delta_kg_lanegra, contra) ?? 'recepcionado y pesado'} />
            <KPI label={`Valorizado · ${per.etiqueta}`} value={fmtCLP(a.valor)} delta={deltaTxt(a.delta_valor, contra) ?? 'según tabla de precios'} />
            <KPI label={`Acumulado ${data.anio}`} value={fmtKg(y.kg_patios)} unit="kg" delta={`${y.guias} guía(s) · ${fmtCLP(y.valor)} · ${y.certificados} CDF`} />
          </div>

          <Columnas titulo={`Tonelaje por período del estado de pago · ${data.anio}`} sub="Kilos despachados desde patios MEL y recepcionados en La Negra, por período (del 21 al 20)"
            categorias={ch.serie.map((s) => s.etiqueta)} fmt={(v) => `${fmtKg(v)} kg`} fmtEje={(v) => compacto(v)}
            series={[{ nombre: 'Patios MEL', color: SERIE.s1, valores: ch.serie.map((s) => s.kg_patios) },
                     { nombre: 'La Negra', color: SERIE.s2, valores: ch.serie.map((s) => s.kg_lanegra) }]} />

          <div className="grid g2 viz-par">
            <Columnas titulo={`Valorizado por período · ${data.anio}`} sub="Pesos valorizados con el precio congelado en cada recepción" alto={230} anchoDibujo={470}
              categorias={ch.serie.map((s) => s.etiqueta)} fmt={fmtCLP} fmtEje={(v) => compacto(v, '$')}
              series={[{ nombre: 'Valorizado', color: SERIE.s1, valores: ch.serie.map((s) => s.valor) }]} />
            <BarrasEtapas titulo={`Cartera de estados de pago · ${data.anio}`} sub="Monto de los EP del año según la etapa en que están" fmt={fmtCLP}
              filas={ch.cartera.map((x) => ({ nombre: x.nombre, valor: x.monto, detalle: `${x.n} EP` }))} />
          </div>

          <div className="grid g2 viz-par">
            <div className="card viz-card">
              <div className="card-h"><div><h3>Ciclo del estado de pago · {data.anio}</h3><small>días promedio entre hitos, sobre {c.eps} EP del año</small></div></div>
              <div className="card-b viz-datos">
                <Dato label="Generación → firma" value={d1(c.dias_generacion_firma)} sub="días" />
                <Dato label="Firma → factura" value={d1(c.dias_firma_factura)} sub="días" />
                <Dato label="Factura → pago" value={d1(c.dias_factura_pago)} sub="días · plazo contractual 15" />
                <Dato label="Pagos dentro de 15 días" value={c.pagos ? `${c.pagos_en_plazo} de ${c.pagos}` : '—'} sub={c.pagos ? pct((c.pagos_en_plazo / c.pagos) * 100) : 'sin pagos registrados'} />
                <Dato label="Monto firmado" value={fmtCLP(c.monto_firmado)} />
                <Dato label="Conciliado" value={fmtCLP(c.monto_conciliado)} sub={c.monto_firmado ? `${pct((c.monto_conciliado / c.monto_firmado) * 100)} de lo firmado` : undefined} />
              </div>
            </div>
            <div className="card viz-card">
              <div className="card-h"><div><h3>Calidad de la operación · {per.etiqueta}</h3><small>recepciones del período y programa del año</small></div></div>
              <div className="card-b viz-datos">
                <Dato label="Recepciones en La Negra" value={k.recepcionadas} />
                <Dato label="Diferencia de peso MEL vs La Negra" value={pct(k.dif_promedio_pct)} sub="promedio por guía · tolerancia 2 %" />
                <Dato label="Guías observadas" value={k.observadas} sub={k.recepcionadas ? pct((k.observadas / k.recepcionadas) * 100) : undefined} />
                <Dato label="En tránsito" value={k.en_transito} sub="por recepcionar" />
                <Dato label="Programa de limpieza ejecutado" value={k.programa_planificadas ? `${k.programa_ejecutadas} de ${k.programa_planificadas}` : '—'} sub={k.programa_planificadas ? pct((k.programa_ejecutadas / k.programa_planificadas) * 100) : 'sin actividades planificadas'} />
              </div>
            </div>
          </div>

          <div className="card viz-card">
            <div className="card-h"><div><h3>Categorías del período · {per.nombre}</h3><small>por categoría final, con el precio congelado</small></div></div>
            <div className="tbl-wrap"><table className="viz-tabla">
              <thead><tr><th>Categoría</th><th className="num">Guías</th><th className="num">Kg patios MEL</th><th className="num">Kg La Negra</th><th className="num">Valorizado</th></tr></thead>
              <tbody>{ch.categorias.map((x) => (
                <tr key={x.categoria}><td>{x.categoria}</td><td className="num">{x.guias}</td><td className="num">{fmtKg(x.kg_patios)}</td><td className="num">{fmtKg(x.kg_lanegra)}</td><td className="num">{fmtCLP(x.valor)}</td></tr>
              ))}</tbody>
            </table></div>
            {ch.categorias.length === 0 && <Empty title="Sin despachos en el período">Elija otro período del estado de pago.</Empty>}
          </div>
        </>);
      })()}

      {/* ============================ obsoletos ============================ */}
      {tab === 'obsoletos' && ob && (() => {
        const p = ob.publicaciones, g = ob.ingresos, inv = ob.inventario, co = ob.compradores;
        return (<>
          <div className="grid g4 viz-kpis">
            <KPI label="Inventario" value={inv.materiales} unit="materiales" delta={`${inv.unidades.toLocaleString('es-CL')} unidades`} />
            <KPI label={`Tasa de adjudicación · ${data.anio}`} value={pct(p.tasa_adjudicacion)} delta={`${p.adjudicadas} adjudicada(s) de ${p.cerradas} cerrada(s)`} />
            <KPI label={`Conversión a chatarra · ${data.anio}`} value={pct(p.tasa_conversion)} delta={`${p.convertidas} publicación(es) sin venta dentro del plazo`} />
            <KPI label={`Ingresos por venta · ${data.anio}`} value={fmtUSD(g.usd)} delta={`${g.adjudicaciones} adjudicación(es) · comisión vendor ${fmtUSD(g.comision_usd)}`} />
          </div>

          <div className="grid g2 viz-par">
            <Columnas titulo={`Publicaciones cerradas por mes · ${data.anio}`} sub="Resultado de cada publicación al cerrar" apilado entero anchoDibujo={470}
              categorias={ob.serie.map((s) => s.etiqueta)} fmt={(v) => `${v}`} fmtEje={(v) => `${v}`}
              series={[{ nombre: 'Adjudicadas', color: SERIE.s1, valores: ob.serie.map((s) => s.adjudicadas) },
                       { nombre: 'Convertidas a chatarra', color: SERIE.s2, valores: ob.serie.map((s) => s.convertidas) },
                       { nombre: 'Canceladas', color: SERIE.s3, valores: ob.serie.map((s) => s.canceladas) }]} />
            <Columnas titulo={`Ingresos por venta (USD) · ${data.anio}`} sub="Monto adjudicado por mes, en dólares" anchoDibujo={470}
              categorias={ob.serie.map((s) => s.etiqueta)} fmt={fmtUSD} fmtEje={(v) => compacto(v, 'US$ ')}
              series={[{ nombre: 'Ingresos', color: SERIE.s1, valores: ob.serie.map((s) => s.usd) }]} />
          </div>

          <div className="grid g2 viz-par">
            <BarrasEtapas titulo="Inventario por etapa" sub="Unidades en cada etapa del proceso, de la identificación a la entrega" fmt={(v) => v.toLocaleString('es-CL')}
              filas={inv.etapas.map((e) => ({ nombre: e.nombre, valor: e.unidades, detalle: `${e.materiales} material(es)` }))}
              extra={<div className="viz-datos" style={{ marginTop: 14 }}>
                <Dato label="No encontrados en terreno" value={inv.no_encontrado.unidades.toLocaleString('es-CL')} sub={`${inv.no_encontrado.materiales} material(es)`} />
                <Dato label="Convertidos a chatarra" value={inv.chatarra.unidades.toLocaleString('es-CL')} sub={`${inv.chatarra.materiales} material(es)`} />
              </div>} />
            <div className="card viz-card">
              <div className="card-h"><div><h3>Tiempos y compradores · {data.anio}</h3><small>de la publicación al retiro</small></div></div>
              <div className="card-b viz-datos">
                <Dato label="Publicación → adjudicación" value={d1(p.dias_promedio_adjudicacion)} sub="días promedio · plazo 15" />
                <Dato label="Adjudicadas dentro de 15 días" value={p.adjudicadas ? `${p.adjudicadas_en_plazo} de ${p.adjudicadas}` : '—'} sub={p.adjudicadas ? pct((p.adjudicadas_en_plazo / p.adjudicadas) * 100) : undefined} />
                <Dato label="Adjudicación → pago" value={d1(g.dias_promedio_pago)} sub={`días · ${g.pagadas} pagada(s)`} />
                <Dato label="Pago → retiro" value={d1(g.dias_promedio_retiro)} sub={`días · ${g.entregadas} entregada(s)`} />
                <Dato label="Compradores registrados" value={co.total} sub={`${co.dd_aprobada} con due diligence aprobada · ${co.dd_pendiente} pendiente(s)`} />
                <Dato label="Ofertas recibidas" value={co.ofertas} sub={`${co.con_ofertas} comprador(es) · ${d1(co.ofertas_por_publicacion)} por publicación`} />
              </div>
            </div>
          </div>
          {p.total === 0 && <div className="audit-note">⚙ Sin publicaciones en {data.anio}. Las tasas y los tiempos se calculan sobre las publicaciones cerradas del año.</div>}
        </>);
      })()}
      {tab === 'obsoletos' && !ob && <Empty title="Sin datos de obsoletos">La venta de obsoletos aún no está habilitada en la base.</Empty>}
    </div>
  );
}
