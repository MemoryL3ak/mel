import { useEffect, useState } from 'react';
import { api, fmtCLP, fmtKg } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Chip, Empty, Field, Modal, PageHead, useToast } from '../ui.jsx';

// Carga masiva de vigencias: acepta pegado desde Excel (tabulaciones) o CSV
// con ";" o ",". Columnas: Categoría | Alt. A | Alt. B | Vigente desde.
// La alternativa B y la fecha son opcionales: sin B rige el precio de A, y sin
// fecha rige desde hoy.
const sinTilde = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// "7.558,38" y "7558.38" son el mismo número escrito a la chilena y a la
// inglesa. Excel exporta una u otra según la configuración del equipo.
const aNumero = (raw) => {
  const t = String(raw ?? '').replace(/USD/gi, '').replace(/\s/g, '');
  if (!t) return NaN;
  return parseFloat(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
};
const esFecha = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '');

function parsearPrecios(texto, categorias, porTonelada) {
  const filas = [];
  for (const linea of texto.split(/\r?\n/)) {
    const l = linea.trim();
    if (!l) continue;
    const sep = l.includes('\t') ? '\t' : l.includes(';') ? ';' : ',';
    const c = l.split(sep).map((x) => x.trim());
    if (/^(categor|material)/i.test(c[0] || '')) continue;       // fila de encabezado
    const fila = { raw: c };
    if (c.length < 2) { fila.error = 'Se esperan al menos 2 columnas: Categoría y precio'; filas.push(fila); continue; }

    const cat = categorias.find((x) => sinTilde(x.nombre) === sinTilde(c[0]) || sinTilde(x.nombre).includes(sinTilde(c[0])));
    if (cat) { fila.categoria_id = cat.id; fila.categoria = cat.nombre; }
    else fila.error = `Categoría no reconocida: «${c[0]}»`;

    const p = aNumero(c[1]);
    if (p > 0) fila[porTonelada ? 'precio_usd_tm' : 'precio_usd'] = p;
    else fila.error ??= `Precio inválido: «${c[1] ?? ''}»`;

    // Con el contrato por tonelada, la tercera columna es la alternativa B.
    // Si en esa posición viene una fecha, se entiende que no se declaró B.
    let iFecha = 2;
    if (porTonelada && c[2] && !esFecha(c[2])) {
      const b = aNumero(c[2]);
      if (b > 0) fila.precio_usd_tm_madera = b;
      else fila.error ??= `Alternativa B inválida: «${c[2]}»`;
      iFecha = 3;
    }
    const f = c[iFecha];
    if (f) {
      if (esFecha(f)) fila.vigente_desde = f;
      else fila.error ??= `Fecha inválida: «${f}» (use AAAA-MM-DD)`;
    }
    filas.push(fila);
  }
  return filas;
}

// Filas de ejemplo con materiales que existen de verdad y con su precio
// vigente: una plantilla con nombres escritos a mano queda obsoleta apenas
// cambia el contrato, y el propio parser la rechaza por categoría desconocida.
const dec2 = (n) => Number(n).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ejemplos = (cats, porTonelada) => {
  const lista = (cats?.length ? cats : [{ nombre: 'Material' }]).slice(0, 3);
  const filas = lista.map((c) => {
    if (!porTonelada) return `${c.nombre};${dec2(c.precio_usd ?? 0.195).replace('.', ',')};${hoyISO()}`;
    const a = c.precio_usd_tm ?? 100;
    const b = c.precio_usd_tm_madera ?? a;
    return `${c.nombre};${dec2(a)};${dec2(b)};${c.vigente_desde ?? hoyISO()}`;
  });
  return filas.join('\n') + '\n';
};
const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// BOM al inicio para que Excel en Windows muestre bien las tildes.
const plantilla = (porTonelada, cats = []) => 'data:text/csv;charset=utf-8,' + encodeURIComponent(
  '﻿' + (porTonelada
    ? 'Material;Alt. A sin madera USD/TM;Alt. B con madera USD/TM;Vigente desde\n' + ejemplos(cats, true)
    : 'Categoría;Precio USD/kg;Vigente desde\n' + ejemplos(cats, false)));

export default function Valorizacion() {
  const [data, setData] = useState(null);
  const [nuevo, setNuevo] = useState(null);   // categoría seleccionada
  const [precio, setPrecio] = useState('');      // Alternativa A (o precio único)
  const [precioB, setPrecioB] = useState('');     // Alternativa B, con madera
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
      // El contrato va en USD por tonelada, con dos alternativas. Si no se
      // declara la B, el servidor entiende que rige la misma de A.
      const campo = data.tm
        ? { precio_usd_tm: Number(precio), ...(Number(precioB) > 0 ? { precio_usd_tm_madera: Number(precioB) } : {}) }
        : data.usd ? { precio_usd: Number(precio) } : { precio_kg: Number(precio) };
      await api('/precios', { method: 'POST', body: { categoria_id: nuevo.id, ...campo, vigente_desde: desde || undefined } });
      toast(`Nuevo precio vigente para ${nuevo.nombre}`);
      setNuevo(null); setPrecio(''); setPrecioB(''); setDesde('');
      load();
    } catch (e) { toast(e.message, true); }
  }

  async function cargarMasivo(filas) {
    try {
      const r = await api('/precios/masivo', {
        method: 'POST',
        body: { filas: filas.map((f) => ({ categoria_id: f.categoria_id, precio_usd: f.precio_usd,
          precio_usd_tm: f.precio_usd_tm, precio_usd_tm_madera: f.precio_usd_tm_madera, vigente_desde: f.vigente_desde })) },
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
        sub={`Tabla de precios del contrato por categoría${data.tm ? ', en dólares por tonelada métrica' : data.usd ? ', en dólares por kilo' : ''}, con vigencia de ${data.meses_vigencia ?? 3} meses. Cada despacho congela el precio y el tipo de cambio al momento de su recepción: los cambios posteriores no alteran guías ya valorizadas.`}>
        {user.role === 'coordinador' && (data.usd || data.tm) && (
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
        <div className="card-h"><h3>Precios vigentes del contrato</h3>
          <small>{data.tm ? 'USD por tonelada métrica · dos alternativas' : '$/kg por categoría'}</small></div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Categoría</th>
            {data.tm
              ? <><th className="num">Alt. A · sin madera</th><th className="num gsep">Alt. B · con madera</th></>
              : <th className="num">{data.usd ? 'Precio USD/kg' : 'Precio vigente'}</th>}
            {(data.usd || data.tm) && <th className="num">Referencia $/kg hoy</th>}
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
                  {data.tm ? (() => {
                    const usd = (v) => v == null ? <span style={{ color: 'var(--muted)' }}>—</span>
                      : `USD ${Number(v).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                    // Cuando las dos alternativas coinciden, la B se atenúa: no
                    // hay decisión que tomar en ese material.
                    const igual = c.precio_usd_tm != null && c.precio_usd_tm === c.precio_usd_tm_madera;
                    return (<>
                      <td className="num mono">{usd(c.precio_usd_tm)}</td>
                      <td className="num mono gsep" style={igual ? { color: 'var(--muted)' } : undefined}
                        title={igual ? 'Igual a la alternativa A' : undefined}>{usd(c.precio_usd_tm_madera)}</td>
                    </>);
                  })() : (
                    <td className="num mono">
                      {data.usd
                        ? (c.precio_usd != null ? `USD ${Number(c.precio_usd).toFixed(4)}`
                          : c.precio_kg != null ? <span style={{ color: 'var(--muted)' }}>$ {Number(c.precio_kg).toLocaleString('es-CL')} <small>(CLP)</small></span>
                          : '—')
                        : (c.precio_kg != null ? `$ ${Number(c.precio_kg).toLocaleString('es-CL')}` : '—')}
                    </td>
                  )}
                  {(data.usd || data.tm) && (
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
                        onClick={() => { setNuevo(c); setPrecio(''); setPrecioB(''); setDesde(''); }}>Nueva vigencia</button>
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
          <button className="btn" onClick={() => { setNuevo(null); setPrecioB(''); }}>Cancelar</button>
          <button className="btn primary" onClick={actualizar}>Registrar precio</button>
        </>}>
        {/* El campo parte vacío a propósito: precargarlo con el precio vigente
            invita a confirmar sin decidir, que es lo que hay que evitar. */}
        <Field label={data.tm ? 'Alternativa A · sin madera (USD/TM)' : data.usd ? 'Nuevo precio (USD/kg)' : 'Nuevo precio ($/kg)'}
          hint={`Vigente actual: ${nuevo?.precio_usd_tm != null ? `USD ${nuevo.precio_usd_tm}/TM` : nuevo?.precio_usd != null ? `USD ${nuevo.precio_usd}/kg` : nuevo?.precio_kg != null ? `$ ${nuevo.precio_kg}` : 'sin precio'}. ` +
            'El historial anterior se conserva y las guías ya valorizadas no cambian.'}>
          <input type="number" min="0" step={data.tm ? '0.01' : data.usd ? '0.0001' : '0.01'} value={precio}
            onChange={(e) => setPrecio(e.target.value)} placeholder="0" />
        </Field>
        {data.tm && (
          <Field label="Alternativa B · con madera (USD/TM)"
            hint={`Vigente actual: ${nuevo?.precio_usd_tm_madera != null ? `USD ${nuevo.precio_usd_tm_madera}/TM` : 'sin precio'}. Si se deja vacío, rige el mismo precio de la alternativa A.`}>
            <input type="number" min="0" step="0.01" value={precioB}
              onChange={(e) => setPrecioB(e.target.value)} placeholder="igual que A" />
          </Field>
        )}
        <Field label="Vigente desde" hint="Si se deja vacío, rige desde hoy.">
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </Field>
        {(data.usd || data.tm) && Number(precio) > 0 && data.dolar && (
          <div className="dif-live ok">
            Al dólar de hoy ($ {Number(data.dolar.valor).toLocaleString('es-CL')}) equivale a
            <b> $ {Math.round(Number(precio) * Number(data.dolar.valor) / (data.tm ? 1000 : 1)).toLocaleString('es-CL')}/kg</b>
            {data.tm && <> · <b>$ {Math.round(Number(precio) * Number(data.dolar.valor)).toLocaleString('es-CL')}/TM</b></>}.
            Lo que se congela en cada guía es el precio en dólares, no esta referencia.
          </div>
        )}
      </Modal>

      <Modal ancho open={masivo} title="Carga masiva de precios" onClose={() => setMasivo(false)}
        footer={(() => {
          const filas = texto.trim() ? parsearPrecios(texto, data.categorias, data.tm) : [];
          const malas = filas.filter((f) => f.error).length;
          return (
            <>
              <a className="btn" href={plantilla(data.tm, data.categorias)} download="Precios del contrato (plantilla).csv"
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
          hint={data.tm
            ? 'O pegue directamente desde Excel. Columnas: Material, Alternativa A en USD/TM, Alternativa B (opcional: sin ella rige la A) y Vigente desde en AAAA-MM-DD (opcional).'
            : 'O pegue directamente desde Excel en el cuadro de abajo. Columnas: Categoría, Precio USD/kg y (opcional) Vigente desde en formato AAAA-MM-DD.'}>
          <input type="file" accept=".csv,.txt" onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) f.text().then(setTexto);
          }} />
        </Field>
        <Field label="Contenido">
          <textarea rows="6" value={texto} onChange={(e) => setTexto(e.target.value)}
            placeholder={ejemplos(data.categorias, data.tm).trim()} />
        </Field>
        {(() => {
          const filas = texto.trim() ? parsearPrecios(texto, data.categorias, data.tm) : [];
          if (!filas.length) return <Empty title="Sin filas que revisar">Pegue el contenido o cargue el archivo para ver la vista previa.</Empty>;
          const malas = filas.filter((f) => f.error).length;
          return (
            <>
              <div className="ev-tit">Vista previa
                <small>{malas ? `${malas} fila(s) con error: la carga no entra hasta corregirlas` : 'todas las filas válidas'}</small>
              </div>
              <div className="tbl-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}><table>
                <thead><tr><th>Categoría</th>
                  {data.tm
                    ? <><th className="num">Alt. A USD/TM</th><th className="num">Alt. B USD/TM</th></>
                    : <th className="num">USD/kg</th>}
                  <th>Vigente desde</th><th>Estado</th></tr></thead>
                <tbody>
                  {filas.map((f, i) => (
                    <tr key={i}>
                      <td>{f.categoria ?? <span style={{ color: 'var(--muted)' }}>{f.raw?.[0] ?? '—'}</span>}</td>
                      {data.tm ? (<>
                        <td className="num mono">
                          {f.precio_usd_tm != null ? f.precio_usd_tm.toLocaleString('es-CL', { minimumFractionDigits: 2 }) : '—'}</td>
                        <td className="num mono" style={f.precio_usd_tm_madera == null ? { color: 'var(--muted)' } : undefined}>
                          {f.precio_usd_tm_madera != null
                            ? f.precio_usd_tm_madera.toLocaleString('es-CL', { minimumFractionDigits: 2 })
                            : 'igual que A'}</td>
                      </>) : (
                        <td className="num mono">{f.precio_usd != null ? f.precio_usd.toFixed(4) : '—'}</td>
                      )}
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
