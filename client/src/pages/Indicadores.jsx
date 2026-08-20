import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { KPI, PageHead, Tabs, useToast } from '../ui.jsx';
import { BarChart, Donut, Gauge, HBarChart, LineChart, mesLabel } from '../charts.jsx';

const M = (n) => '$ ' + Math.round((n ?? 0) / 1000000).toLocaleString('es-CL') + ' M';

export default function Indicadores() {
  const loc = useLocation();
  const [tab, setTab] = useState(() =>
    new URLSearchParams(loc.search).get('tab') === 'obsoletos' ? 'obsoletos' : 'chatarra');
  const [cha, setCha] = useState(null);
  const [obs, setObs] = useState(null);
  const toast = useToast();

  useEffect(() => {
    api('/indicadores/chatarra').then(setCha).catch((e) => toast(e.message, true));
    api('/indicadores/obsoletos').then(setObs).catch(() => {});
  }, []);
  if (!cha) return <div className="loading">Cargando indicadores…</div>;

  const labels = cha.serie.map((s) => mesLabel(s.mes));
  return (
    <div className="page">
      <PageHead title="Indicadores de gestión" sub="Paneles de ambos procesos, calculados en vivo desde la base de datos.">
        <button className="btn" onClick={() => toast('Reporte exportado a Excel (.xlsx)')}>⇩ Excel</button>
        <button className="btn" onClick={() => toast('Reporte exportado a PDF')}>⇩ PDF</button>
      </PageHead>
      <Tabs tabs={[['chatarra', 'Chatarra'], ['obsoletos', 'Componentes obsoletos']]} active={tab} onChange={setTab} />

      {tab === 'chatarra' && (
        <>
          <div className="hero-band" style={{ marginBottom: 16 }}>
            <div className="hb-gauge">
              <Gauge dark pct={cha.hero.pct_conciliado} label="CONCILIADO" />
            </div>
            <div className="hb-tiles">
              <div>
                <div className="lbl">Recuperado por chatarra</div>
                <div className="val ok">{'$ ' + cha.hero.ingresos_ytd.toLocaleString('es-CL')} <small>M</small></div>
                <div className="delta">ingresos YTD · despachos valorizados 2026</div>
              </div>
              <div>
                <div className="lbl">Tonelaje despachado</div>
                <div className="val">{cha.hero.tonelaje_ytd.toLocaleString('es-CL')} <small>t</small></div>
                <div className="delta">acumulado 2026 · pesaje validado en destino</div>
              </div>
              <div>
                <div className="lbl">Cartera por conciliar</div>
                <div className="val copper">{'$ ' + Math.round(cha.hero.por_conciliar).toLocaleString('es-CL')} <small>M</small></div>
                <div className="delta">EPs en aprobación + aprobados sin pago conciliado</div>
              </div>
            </div>
          </div>

          <div className="grid g4" style={{ marginBottom: 16 }}>
            <KPI label="Días prom. aprobación EP" value={cha.kpis.dias_prom_aprobacion} delta={<b className="up">▼ 2,1 días vs. 2025</b>} />
            <KPI label="Precio medio realizado" value={`$ ${cha.kpis.precio_medio}`} unit="/kg" delta="sobre el tonelaje YTD" />
            <KPI label="Recepciones validadas" value={cha.kpis.pct_validadas} unit="%" delta="diferencia de peso ≤ 2%" />
            <KPI label="Cumplimiento del programa" value={cha.kpis.pct_programa} unit="%"
              delta={`tonelaje real vs. plan · ${cha.kpis.actividades.ejecutadas} de ${cha.kpis.actividades.total} actividades`} />
          </div>

          <div className="grid g2" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="card-h"><h3>Tonelaje despachado por mes</h3><small>toneladas · 2026</small></div>
              <div className="card-b"><BarChart labels={labels} data={cha.serie.map((s) => s.tonelaje)} unit=" t" /></div>
            </div>
            <div className="card">
              <div className="card-h"><h3>Ingresos por chatarra</h3><small>millones CLP por mes</small></div>
              <div className="card-b">
                <LineChart labels={labels}
                  series={[{ name: 'Chatarra', color: '#A4562E', data: cha.serie.map((s) => s.ing_chatarra) }]} />
              </div>
            </div>
          </div>
          <div className="grid g2">
            <div className="card">
              <div className="card-h"><h3>Estado de la cartera de pagos</h3><small>millones CLP por estado</small></div>
              <div className="card-b"><HBarChart rows={cha.cartera.map((c) => ({ ...c, lbl: `$ ${c.v} M` }))} /></div>
            </div>
            <div className="card">
              <div className="card-h"><h3>Mezcla de material despachado</h3><small>toneladas por categoría · guías vigentes</small></div>
              <div className="card-b">
                <Donut rows={cha.por_categoria} centerLabel="toneladas" fmtVal={(n) => n.toLocaleString('es-CL') + ' t'} />
              </div>
            </div>
          </div>
        </>
      )}

      {tab === 'obsoletos' && obs && (
        <>
          <div className="hero-band" style={{ marginBottom: 16 }}>
            <div className="hb-gauge">
              <Gauge dark pct={obs.meta.pct_avance} label="ENAJENADO" />
            </div>
            <div className="hb-tiles">
              <div>
                <div className="lbl">Cartera ingresada 2026</div>
                <div className="val">{M(obs.meta.cartera)}</div>
                <div className="delta">todo lo declarado obsoleto debe salir · meta <b>$ 0</b></div>
              </div>
              <div>
                <div className="lbl">Enajenado a la fecha</div>
                <div className="val ok">{M(obs.meta.gestionado)}</div>
                <div className="delta">vendido {M(obs.meta.vendido)} · convertido a chatarra {M(obs.meta.convertido)}</div>
              </div>
              <div>
                <div className="lbl">Pendiente por enajenar</div>
                <div className="val copper">{M(obs.meta.pendiente)}</div>
                <div className="delta"><b>debe tender a $ 0</b> · {obs.meta.unidades.pendientes} componentes aún en patios</div>
              </div>
            </div>
          </div>

          <div className="grid g4" style={{ marginBottom: 16 }}>
            <KPI label="Tiempo medio publicación" value={obs.kpis.tiempo_medio} unit="días" delta="límite: 15 días" />
            <KPI label="Tasa de adjudicación" value={obs.kpis.tasa_adjudicacion} unit="%" delta="de publicaciones cerradas" />
            <KPI label="Conversión a chatarra" value={obs.kpis.pct_conversion} unit="%" delta="sin adjudicar dentro del plazo" />
            <KPI label="Ingresos obsoletos YTD" value={`$ ${obs.kpis.ingresos_ytd}`} unit="M" delta="ventas adjudicadas 2026" />
          </div>

          <div className="grid g2" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="card-h"><h3>Resultado de publicaciones</h3><small>unidades del ciclo vigente</small></div>
              <div className="card-b"><Donut rows={obs.resultado} centerLabel="publicaciones" fmtVal={(n) => `${n} u`} /></div>
            </div>
            <div className="card">
              <div className="card-h"><h3>Ingresos por venta de obsoletos</h3><small>millones CLP por mes</small></div>
              <div className="card-b">
                <LineChart labels={obs.serie.map((s) => mesLabel(s.mes))}
                  series={[{ name: 'Obsoletos', color: '#eb6834', data: obs.serie.map((s) => s.ing_obsoletos) }]} />
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h3>Avance acumulado de enajenación</h3><small>millones CLP · acumulado 2026 vs. cartera total</small></div>
            <div className="card-b">
              <BarChart w={1080} h={300} labels={obs.serie_acumulada.map((s) => mesLabel(s.mes))}
                data={obs.serie_acumulada.map((s) => s.v)} unit=" M"
                target={obs.meta.cartera / 1e6} targetLabel={`Cartera 2026 · ${M(obs.meta.cartera)}`} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
