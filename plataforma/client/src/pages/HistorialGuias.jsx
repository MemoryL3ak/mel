// Historial de guías anteriores a la plataforma (planilla «HISTORIA CHATARRA»
// de MEL). Se consulta aparte de las guías reales: aquí se ve, se busca y se
// descarga; el coordinador la carga o la reemplaza subiendo la planilla.
import { useEffect, useRef, useState } from 'react';
import { api, fmtCLP, fmtKg } from '../api.js';
import { Chip, Empty, Modal, useToast } from '../ui.jsx';

const clave = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const TOPE = 300;   // filas del detalle a la vista; el resto se acota buscando o se baja en Excel

export default function HistorialGuias({ anio, puedeCargar, onCargado }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [edp, setEdp] = useState('todos');
  const [busca, setBusca] = useState('');
  const [carga, setCarga] = useState(null);     // { archivo, informe } mientras se confirma
  const [subiendo, setSubiendo] = useState(false);
  const archivo = useRef(null);
  const toast = useToast();

  const load = () => api(`/historial?anio=${anio}`).then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message));
  useEffect(() => { setData(null); load(); }, [anio]);

  // Primero se simula: el coordinador ve qué trae la planilla antes de guardar.
  async function elegir(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setSubiendo(true);
    try {
      const fd = new FormData(); fd.append('archivo', f); fd.append('simular', '1');
      setCarga({ archivo: f, informe: await api('/historial/importar', { method: 'POST', body: fd }) });
    } catch (err) { toast(err.message, true); } finally { setSubiendo(false); }
  }
  async function confirmar() {
    setSubiendo(true);
    try {
      const fd = new FormData(); fd.append('archivo', carga.archivo);
      const r = await api('/historial/importar', { method: 'POST', body: fd });
      toast(`Historial cargado: ${r.filas} guía(s)`);
      setCarga(null); load(); onCargado?.();
    } catch (err) { toast(err.message, true); } finally { setSubiendo(false); }
  }

  if (error) return <div className="aviso bad"><b>No se pudo leer el historial.</b><p>{error}</p></div>;
  if (!data) return <div className="loading">Cargando historial…</div>;

  const botonCargar = puedeCargar && data.disponible && (
    <>
      <input ref={archivo} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={elegir} />
      <button className="btn sm" disabled={subiendo} onClick={() => archivo.current?.click()}>
        {subiendo ? 'Leyendo…' : data.filas.length ? 'Reemplazar con otra planilla' : 'Cargar planilla (Excel)'}</button>
    </>
  );

  const k = clave(busca);
  const filas = data.filas
    .filter((f) => edp === 'todos' || String(f.edp_numero) === edp)
    .filter((f) => !k || [f.gde, f.categoria, f.patio, f.gd_anulada].some((c) => clave(c).includes(k)));

  return (
    <>
      {!data.disponible ? (
        <div className="card"><Empty title="El historial todavía no está habilitado">
          Falta aplicar en la base de datos la migración 0021 (cierre e historial). Apenas se ejecute, aquí se podrá cargar la planilla.
        </Empty></div>
      ) : data.filas.length === 0 ? (
        <div className="card">
          <div className="card-h"><h3>Historial de guías · {anio}</h3>{botonCargar}</div>
          <Empty title="Sin historial cargado para este año">
            {puedeCargar ? 'Suba la planilla «HISTORIA CHATARRA» en Excel para ver aquí las guías anteriores a la plataforma.'
              : 'El coordinador puede cargar la planilla de guías anteriores a la plataforma.'}
          </Empty>
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-h">
              <div>
                <h3>Historial de guías · {anio}</h3>
                <small>
                  guías anteriores a la plataforma, según la planilla de MEL
                  {data.cargado?.el ? ` · cargada el ${data.cargado.el}${data.cargado.por ? ` por ${data.cargado.por}` : ''}` : ''}
                </small>
              </div>
              {botonCargar}
            </div>
            <div className="tbl-wrap"><table>
              <thead><tr><th>Estado de pago</th><th>Período</th><th className="num">Guías</th><th className="num">Kg</th><th className="num">Valor neto</th></tr></thead>
              <tbody>
                {data.periodos.map((p) => (
                  <tr key={p.periodo} style={{ cursor: 'pointer' }} onClick={() => setEdp(String(p.edp_numero))} title="Ver las guías de este estado de pago">
                    <td><b>EDP N° {p.edp_numero ?? '—'}</b></td>
                    <td className="mono">{p.periodo_texto ?? p.periodo}</td>
                    <td className="num">{p.guias}{p.en_gea > 0 && <><br /><small style={{ color: 'var(--muted)' }}>+{p.en_gea} ya en GEA</small></>}</td>
                    <td className="num">{fmtKg(p.kg)}</td>
                    <td className="num">{fmtCLP(p.valor)}</td>
                  </tr>
                ))}
                <tr className="tot">
                  <td>Total {anio}</td><td />
                  <td className="num">{data.total.guias}</td>
                  <td className="num">{fmtKg(data.total.kg)}</td>
                  <td className="num">{fmtCLP(data.total.valor)}</td>
                </tr>
              </tbody>
            </table></div>
            {data.total.en_gea > 0 && (
              <div className="card-b audit-note">
                {data.total.en_gea} guía(s) de la planilla ya están registradas en GEA como guías reales: se muestran
                en el detalle, pero no se suman aquí ni en los indicadores para no contarlas dos veces.
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-h">
              <div className="filtros">
                <button className={`fchip ${edp === 'todos' ? 'on' : ''}`} onClick={() => setEdp('todos')}>Todos <i>{data.filas.length}</i></button>
                {data.periodos.map((p) => (
                  <button key={p.periodo} className={`fchip ${edp === String(p.edp_numero) ? 'on' : ''}`}
                    onClick={() => setEdp(String(p.edp_numero))}>EDP {p.edp_numero}</button>
                ))}
              </div>
              <input type="search" className="busca-guia" value={busca} onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar guía, descripción o patio" aria-label="Buscar en el historial" />
              <small>{filas.length} guía(s)</small>
            </div>
            <div className="tbl-wrap"><table className="densa">
              <thead><tr><th>N° guía</th><th>Fecha</th><th>EDP</th><th>Descripción</th><th>Patio</th>
                <th className="num">Kg</th><th className="num">USD/TM</th><th className="num">Dólar</th><th className="num">Valor neto</th></tr></thead>
              <tbody>
                {filas.slice(0, TOPE).map((f) => (
                  <tr key={f.id}>
                    <td>
                      <span className="mono">{f.gde}</span>
                      {f.en_gea && <><br /><Chip tone="info">Ya en GEA</Chip></>}
                      {f.gd_anulada && <small className="recorte" style={{ maxWidth: 150 }} title={f.gd_anulada}>{f.gd_anulada}</small>}
                    </td>
                    <td className="mono">{f.fecha}</td>
                    <td className="mono">{f.edp_numero ?? '—'}</td>
                    <td>{f.categoria ?? <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                    <td>{f.patio ?? <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                    <td className="num">{f.kg != null ? fmtKg(f.kg) : '—'}</td>
                    <td className="num">{f.usd_tm != null ? f.usd_tm.toLocaleString('es-CL', { maximumFractionDigits: 2 }) : '—'}</td>
                    <td className="num">{f.dolar != null ? f.dolar.toLocaleString('es-CL', { maximumFractionDigits: 2 }) : '—'}</td>
                    <td className="num">{f.valor != null ? fmtCLP(f.valor) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            {filas.length === 0 && <Empty title="Nada con ese filtro">Pruebe con otro estado de pago u otra búsqueda.</Empty>}
            {filas.length > TOPE && (
              <div className="card-b audit-note">
                Se muestran las primeras {TOPE} de {filas.length}. Acote con el buscador o descargue el Excel para verlas todas.
              </div>
            )}
          </div>
        </>
      )}

      <Modal open={!!carga} title="Cargar historial de guías" onClose={() => setCarga(null)}
        footer={<>
          <button className="btn" onClick={() => setCarga(null)}>Cancelar</button>
          <button className="btn primary" disabled={subiendo} onClick={confirmar}>{subiendo ? 'Cargando…' : 'Cargar historial'}</button>
        </>}>
        {carga && (() => {
          const i = carga.informe;
          return (
            <>
              <p style={{ marginTop: 0, color: 'var(--ink-2)' }}>
                La planilla trae <b>{i.filas}</b> guía(s) del año {i.anios.join(', ')}: <b>{fmtKg(i.kg)}</b> kg
                y <b>{fmtCLP(i.valor)}</b>. Al cargarla se <b>reemplaza</b> el historial de ese año; las guías reales
                de la plataforma no se tocan.
              </p>
              <div className="tbl-wrap" style={{ maxHeight: 240, overflowY: 'auto' }}><table>
                <thead><tr><th>EDP</th><th>Período</th><th className="num">Guías</th><th className="num">Kg</th><th className="num">Valor</th></tr></thead>
                <tbody>{i.periodos.map((p) => (
                  <tr key={p.periodo}><td className="mono">{p.edp_numero ?? '—'}</td><td className="mono">{p.periodo_texto ?? p.periodo}</td>
                    <td className="num">{p.guias + p.en_gea}</td><td className="num">{fmtKg(p.kg)}</td><td className="num">{fmtCLP(p.valor)}</td></tr>
                ))}</tbody>
              </table></div>
              {i.ya_en_gea > 0 && <div className="audit-note">{i.ya_en_gea} guía(s) ya están en GEA como guías reales: se cargan, pero no se suman a los indicadores.</div>}
              {i.avisos.map((a, n) => <div className="audit-note" key={n}>{a}</div>)}
            </>
          );
        })()}
      </Modal>
    </>
  );
}
