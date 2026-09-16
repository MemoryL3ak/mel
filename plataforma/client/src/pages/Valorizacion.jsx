import { useEffect, useState } from 'react';
import { api, fmtCLP, fmtKg } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Chip, Empty, Field, Modal, PageHead, useToast } from '../ui.jsx';

// Carga masiva de vigencias: acepta pegado desde Excel (tabulaciones) o CSV
// con ";" o ",". Columnas: Categoría | Precio USD/kg | Vigente desde.
const sinTilde = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

function parsearPrecios(texto, categorias) {
  const filas = [];
  for (const linea of texto.split(/\r?\n/)) {
    const l = linea.trim();
    if (!l) continue;
    const sep = l.includes('\t') ? '\t' : l.includes(';') ? ';' : ',';
    const c = l.split(sep).map((x) => x.trim());
    if (/^categor/i.test(c[0] || '')) continue;                 // fila de encabezado
    const fila = { raw: c };
    if (c.length < 2) { fila.error = 'Se esperan al menos 2 columnas: Categoría y Precio USD/kg'; filas.push(fila); continue; }

    const cat = categorias.find((x) => sinTilde(x.nombre) === sinTilde(c[0]) || sinTilde(x.nombre).includes(sinTilde(c[0])));
    if (cat) { fila.categoria_id = cat.id; fila.categoria = cat.nombre; }
    else fila.error = `Categoría no reconocida: «${c[0]}»`;

    const raw = c[1] ?? '';
    const p = parseFloat(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw);
    if (p > 0) fila.precio_usd = p;
    else fila.error ??= `Precio inválido: «${raw}»`;

    if (c[2]) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(c[2])) fila.vigente_desde = c[2];
      else fila.error ??= `Fecha inválida: «${c[2]}» (use AAAA-MM-DD)`;
    }
    filas.push(fila);
  }
  return filas;
}

// BOM al inicio para que Excel en Windows muestre bien las tildes.
const PLANTILLA = 'data:text/csv;charset=utf-8,' + encodeURIComponent(
  '﻿' +
  'Categoría;Precio USD/kg;Vigente desde\n' +
  'Fierro pesado;0,1950;2026-09-16\n' +
  'Fierro liviano / mixto;0,1260;2026-09-16\n' +
  'Acero inoxidable;0,6850;2026-09-16\n');

export default function Valorizacion() {
  const [data, setData] = useState(null);
  const [nuevo, setNuevo] = useState(null);   // categoría seleccionada
  const [precio, setPrecio] = useState('');
  const [desde, setDesde] = useState('');
  const [contrato, setContrato] = useState(null);
  const [editando, setEditando] = useState(null);   // borrador de los datos del contrato
  const [masivo, setMasivo] = useState(false);
  const [texto, setTexto] = useState('');
  const [dolarManual, setDolarManual] = useState(null);   // {fecha, valor}
  const { user } = useAuth();
  const toast = useToast();

  const load = () => {
    api('/valorizacion').then(setData).catch((e) => toast(e.message, true));
    api('/contrato').then(setContrato).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  if (!data) return <div className="loading">Cargando valorización…</div>;

  async function actualizar() {
    if (!(Number(precio) > 0)) return toast('Ingrese un precio mayor que cero', true);
    try {
      // Con la valorización en dólares el precio nuevo siempre es USD/kg; las
      // vigencias antiguas en pesos se conservan tal como fueron facturadas.
      const campo = data.usd ? { precio_usd: Number(precio) } : { precio_kg: Number(precio) };
      await api('/precios', { method: 'POST', body: { categoria_id: nuevo.id, ...campo, vigente_desde: desde || undefined } });
      toast(`Nuevo precio vigente para ${nuevo.nombre}`);
      setNuevo(null); setPrecio(''); setDesde('');
      load();
    } catch (e) { toast(e.message, true); }
  }

  async function cargarMasivo(filas) {
    try {
      const r = await api('/precios/masivo', {
        method: 'POST',
        body: { filas: filas.map((f) => ({ categoria_id: f.categoria_id, precio_usd: f.precio_usd, vigente_desde: f.vigente_desde })) },
      });
      toast(`${r.cargadas} vigencia(s) cargadas`);
      setMasivo(false); setTexto('');
      load();
    } catch (e) { toast(e.message, true); }
  }

  async function guardarDolar() {
    try {
      await api('/dolar', { method: 'POST', body: { fecha: dolarManual.fecha, valor: Number(dolarManual.valor) } });
      toast(`Dólar del ${dolarManual.fecha} registrado`);
      setDolarManual(null);
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
        sub={`Tabla de precios del contrato por categoría${data.usd ? ', en dólares por kilo' : ''}, con vigencia de ${data.meses_vigencia ?? 3} meses. Cada despacho congela el precio y el tipo de cambio al momento de su recepción: los cambios posteriores no alteran guías ya valorizadas.`}>
        {user.role === 'coordinador' && data.usd && (
          <button className="btn" onClick={() => { setMasivo(true); setTexto(''); }}>⇪ Carga masiva</button>
        )}
      </PageHead>

      {data.usd && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-h">
            <h3>Valor del dólar</h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <small>observado, desde mindicador.cl</small>
              <button className="btn sm" onClick={() => setDolarManual({ fecha: data.dolar?.fecha ?? '', valor: '' })}>
                Registrar a mano
              </button>
            </div>
          </div>
          <div className="card-b">
            {data.dolar ? (
              <div className="cotejo" style={{ marginBottom: 0 }}>
                <span><small>Vigente para valorizar</small>
                  <b className="mono" style={{ fontSize: 20 }}>$ {Number(data.dolar.valor).toLocaleString('es-CL')}</b></span>
                <span><small>Fecha de la cotización</small><b className="mono">{data.dolar.fecha}</b></span>
                <span><small>Origen</small>
                  <b>{data.dolar.estimado
                    ? <Chip tone="warn">Arrastrado del último día publicado</Chip>
                    : <Chip tone="ok">Publicado para esa fecha</Chip>}</b></span>
              </div>
            ) : (
              <div className="aviso bad">
                <b>Sin valor del dólar</b>
                <p>No se pudo obtener la cotización y no hay ninguna guardada. <b>Las recepciones con precio en
                dólares no se pueden valorizar</b> hasta que exista un valor: regístrelo a mano con el botón de arriba.</p>
              </div>
            )}
            <div className="audit-note">
              El tipo de cambio se <b>congela con cada recepción</b>: la guía guarda el dólar del día en que
              se recibió, así una variación posterior no revaloriza lo ya declarado.
            </div>
          </div>
        </div>
      )}

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
          <thead><tr><th>Categoría</th><th className="num">{data.usd ? 'Precio USD/kg' : 'Precio vigente'}</th>
            {data.usd && <th className="num">Referencia en pesos</th>}
            <th>Desde</th><th>Vigencia</th><th className="num">Kg recepcionados YTD</th><th className="num">Valorizado YTD</th><th></th></tr></thead>
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
                  <td className="num mono">
                    {data.usd
                      ? (c.precio_usd != null ? `USD ${Number(c.precio_usd).toFixed(4)}`
                        : c.precio_kg != null ? <span style={{ color: 'var(--muted)' }}>$ {Number(c.precio_kg).toLocaleString('es-CL')} <small>(CLP)</small></span>
                        : '—')
                      : (c.precio_kg != null ? `$ ${Number(c.precio_kg).toLocaleString('es-CL')}` : '—')}
                  </td>
                  {data.usd && (
                    <td className="num mono" style={{ color: 'var(--muted)' }}
                      title="Referencia al dólar de hoy. Lo que se congela en cada guía es el precio en dólares.">
                      {c.precio_clp_hoy != null ? `$ ${c.precio_clp_hoy.toLocaleString('es-CL')}` : '—'}
                    </td>
                  )}
                  <td className="mono">{c.vigente_desde || '—'}</td>
                  <td><Chip tone={tono}>{texto}</Chip></td>
                  <td className="num">{fmtKg(c.kg_ytd)}</td>
                  <td className="num">{fmtCLP(c.valor_ytd)}</td>
                  <td className="num">
                    {user.role === 'coordinador' && (
                      <button className={`btn sm ${c.estado_precio === 'vencido' ? 'primary' : ''}`}
                        onClick={() => { setNuevo(c); setPrecio(''); setDesde(''); }}>Nueva vigencia</button>
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

      {/* La historia del dólar vive con las demás historias, no arriba: lo que
          la cabecera tiene que responder es con qué se valoriza hoy. */}
      {data.usd && data.historial_dolar?.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-h">
            <h3>Historial del tipo de cambio</h3>
            <small>últimos {data.historial_dolar.length} registros · observado, desde mindicador.cl</small>
          </div>
          <div className="tbl-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}><table>
            <thead><tr><th>Fecha</th><th className="num">Valor</th><th className="num">Variación</th><th>Origen</th></tr></thead>
            <tbody>
              {data.historial_dolar.map((d, i) => {
                // El historial viene del más nuevo al más antiguo.
                const previo = data.historial_dolar[i + 1];
                const dif = previo ? Number(d.valor) - Number(previo.valor) : null;
                const pct = dif != null && Number(previo.valor) ? (dif / Number(previo.valor)) * 100 : null;
                return (
                  <tr key={d.fecha}>
                    <td className="mono">{d.fecha}</td>
                    <td className="num mono">$ {Number(d.valor).toLocaleString('es-CL')}</td>
                    <td className="num" style={{ color: dif == null ? 'var(--muted)' : dif >= 0 ? 'var(--ok-tx)' : 'var(--bad-tx)' }}>
                      {dif == null ? '—' : `${dif >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(2)}%`}
                    </td>
                    <td style={{ color: 'var(--ink-2)' }}>{d.fuente}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>
      )}

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
        {/* El campo parte vacío a propósito: precargarlo con el precio vigente
            invita a confirmar sin decidir, que es lo que hay que evitar. */}
        <Field label={data.usd ? 'Nuevo precio (USD/kg)' : 'Nuevo precio ($/kg)'}
          hint={`Vigente actual: ${nuevo?.precio_usd != null ? `USD ${nuevo.precio_usd}` : nuevo?.precio_kg != null ? `$ ${nuevo.precio_kg}` : 'sin precio'}. ` +
            'El historial anterior se conserva y las guías ya valorizadas no cambian.'}>
          <input type="number" min="0" step={data.usd ? '0.0001' : '0.01'} value={precio}
            onChange={(e) => setPrecio(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Vigente desde" hint="Si se deja vacío, rige desde hoy.">
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </Field>
        {data.usd && Number(precio) > 0 && data.dolar && (
          <div className="dif-live ok">
            Al dólar de hoy ($ {Number(data.dolar.valor).toLocaleString('es-CL')}) equivale a
            <b> $ {Math.round(Number(precio) * Number(data.dolar.valor)).toLocaleString('es-CL')}/kg</b>.
            Lo que se congela en cada guía es el precio en dólares, no esta referencia.
          </div>
        )}
      </Modal>

      <Modal ancho open={masivo} title="Carga masiva de precios" onClose={() => setMasivo(false)}
        footer={(() => {
          const filas = texto.trim() ? parsearPrecios(texto, data.categorias) : [];
          const malas = filas.filter((f) => f.error).length;
          return (
            <>
              <a className="btn" href={PLANTILLA} download="Precios del contrato (plantilla).csv"
                style={{ marginRight: 'auto', textDecoration: 'none' }}>⇩ Plantilla CSV</a>
              <button className="btn" onClick={() => setMasivo(false)}>Cancelar</button>
              <button className="btn primary" disabled={!filas.length || malas > 0}
                onClick={() => cargarMasivo(filas)}>
                Cargar {filas.length - malas || ''} vigencia(s)
              </button>
            </>
          );
        })()}>
        <Field label="Archivo CSV"
          hint="O pegue directamente desde Excel en el cuadro de abajo. Columnas: Categoría, Precio USD/kg y (opcional) Vigente desde en formato AAAA-MM-DD.">
          <input type="file" accept=".csv,.txt" onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) f.text().then(setTexto);
          }} />
        </Field>
        <Field label="Contenido">
          <textarea rows="6" value={texto} onChange={(e) => setTexto(e.target.value)}
            placeholder={'Fierro pesado;0,1950;2026-09-16\nFierro liviano / mixto;0,1260'} />
        </Field>
        {(() => {
          const filas = texto.trim() ? parsearPrecios(texto, data.categorias) : [];
          if (!filas.length) return <Empty title="Sin filas que revisar">Pegue el contenido o cargue el archivo para ver la vista previa.</Empty>;
          const malas = filas.filter((f) => f.error).length;
          return (
            <>
              <div className="ev-tit">Vista previa
                <small>{malas ? `${malas} fila(s) con error: la carga no entra hasta corregirlas` : 'todas las filas válidas'}</small>
              </div>
              <div className="tbl-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}><table>
                <thead><tr><th>Categoría</th><th className="num">USD/kg</th><th>Vigente desde</th><th>Estado</th></tr></thead>
                <tbody>
                  {filas.map((f, i) => (
                    <tr key={i}>
                      <td>{f.categoria ?? <span style={{ color: 'var(--muted)' }}>{f.raw?.[0] ?? '—'}</span>}</td>
                      <td className="num mono">{f.precio_usd != null ? f.precio_usd.toFixed(4) : '—'}</td>
                      <td className="mono">{f.vigente_desde ?? 'hoy'}</td>
                      <td>{f.error ? <Chip tone="bad">{f.error}</Chip> : <Chip tone="ok">Lista</Chip>}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              <div className="audit-note">
                La carga es <b>todo o nada</b>: si una fila falla, no entra ninguna. Cada fila agrega una
                vigencia nueva al historial; no reemplaza la anterior.
              </div>
            </>
          );
        })()}
      </Modal>

      <Modal open={!!dolarManual} title="Registrar el valor del dólar" onClose={() => setDolarManual(null)}
        footer={<>
          <button className="btn" onClick={() => setDolarManual(null)}>Cancelar</button>
          <button className="btn primary" onClick={guardarDolar}>Registrar</button>
        </>}>
        <p style={{ marginTop: 0, color: 'var(--ink-2)' }}>
          Para fines de semana, feriados o cuando la fuente no responde. Queda en la historia
          identificado como registro manual, con su nombre.
        </p>
        <Field label="Fecha">
          <input type="date" value={dolarManual?.fecha ?? ''}
            onChange={(e) => setDolarManual({ ...dolarManual, fecha: e.target.value })} />
        </Field>
        <Field label="Valor del dólar (CLP)">
          <input type="number" min="0" step="0.01" placeholder="0" value={dolarManual?.valor ?? ''}
            onChange={(e) => setDolarManual({ ...dolarManual, valor: e.target.value })} />
        </Field>
      </Modal>
    </div>
  );
}
