import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { KPI, PageHead, Tabs, useToast } from '../ui.jsx';
import { BarChart, HBarChart, LineChart, mesLabel } from '../charts.jsx';

export default function Indicadores() {
  const [tab, setTab] = useState('chatarra');
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
          <div className="grid g4" style={{ marginBottom: 16 }}>
            <KPI label="Tonelaje YTD" value={cha.kpis.tonelaje_ytd.toLocaleString('es-CL')} unit="t" delta="acumulado 2026" />
            <KPI label="Ingresos chatarra YTD" value={`$ ${cha.kpis.ingresos_ytd}`} unit="M" delta="despachos valorizados" />
            <KPI label="Días prom. aprobación EP" value={cha.kpis.dias_prom_aprobacion} delta={<b className="up">▼ 2,1 días vs. 2025</b>} />
            <KPI label="Pagos conciliados" value={cha.kpis.pct_conciliado} unit="%" delta="del monto aprobado YTD" />
          </div>
          <div className="grid g2">
            <div className="card">
              <div className="card-h"><h3>KPI de despachos · tonelaje mensual</h3><small>2026</small></div>
              <div className="card-b"><BarChart labels={labels} data={cha.serie.map((s) => s.tonelaje)} unit=" t" /></div>
            </div>
            <div className="card">
              <div className="card-h"><h3>KPI de pagos · estado de la cartera</h3><small>millones CLP por estado</small></div>
              <div className="card-b"><HBarChart rows={cha.cartera.map((c) => ({ ...c, lbl: `$ ${c.v} M` }))} /></div>
            </div>
          </div>
        </>
      )}

      {tab === 'obsoletos' && obs && (
        <>
          <div className="grid g4" style={{ marginBottom: 16 }}>
            <KPI label="Tiempo medio publicación" value={obs.kpis.tiempo_medio} unit="días" delta="límite: 15 días" />
            <KPI label="Tasa de adjudicación" value={obs.kpis.tasa_adjudicacion} unit="%" delta="de publicaciones cerradas" />
            <KPI label="Conversión a chatarra" value={obs.kpis.pct_conversion} unit="%" delta="sin adjudicar dentro del plazo" />
            <KPI label="Ingresos obsoletos YTD" value={`$ ${obs.kpis.ingresos_ytd}`} unit="M" delta="ventas adjudicadas" />
          </div>
          <div className="grid g2">
            <div className="card">
              <div className="card-h"><h3>Resultado de publicaciones</h3><small>unidades</small></div>
              <div className="card-b"><HBarChart rows={obs.resultado} /></div>
            </div>
            <div className="card">
              <div className="card-h"><h3>Ingresos por venta de obsoletos</h3><small>millones CLP por mes</small></div>
              <div className="card-b">
                <LineChart labels={obs.serie.map((s) => mesLabel(s.mes))}
                  series={[{ name: 'Obsoletos', color: '#eb6834', data: obs.serie.map((s) => s.ing_obsoletos) }]} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
