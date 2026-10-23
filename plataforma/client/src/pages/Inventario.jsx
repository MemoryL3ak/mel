import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, fmtUSD, fmtCLP } from '../api.js';
import { Acciones, DateField, Select, CampoPeso, Chip, Empty, Field, Modal, PageHead, Tabs, aKg, hoyISO, useToast } from '../ui.jsx';
import BotonDocs from '../BotonDocs.jsx';

const EYEBROW = 'Venta de obsoletos';
// [tono, etiqueta corta del chip, texto completo]. El chip es corto para que
// la columna de estado no empuje la tabla fuera de la tarjeta; el texto
// completo aparece al pasar el mouse.
const ESTADO = {
  por_identificar: ['warn', 'Por identificar', 'Por identificar en terreno · se puede publicar igual'],
  no_encontrado: ['bad', 'No encontrado', 'No encontrado en terreno · no se publica'],
  planificado: ['neutral', 'Planificado', 'Confirmado en terreno, listo para publicar'],
  publicado: ['info', 'Publicado', 'Publicado en el portal'],
  adjudicado: ['ok', 'Adjudicado', 'Adjudicado'], entregado: ['ok', 'Entregado', 'Entregado al comprador'],
  chatarra: ['bad', 'Chatarra', 'Convertido a chatarra'],
};
const vacio = { codigo: '', nombre: '', especificaciones: '', sitio_id: '', ubicacion: '', valor_referencial: '', memo_id: '', cant_comprometida: 1, fotos: [], ficha: null };
const FICHA_ACCEPT = 'application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/jpeg,image/png,image/webp,.xls,.xlsx';

// Los campos oficiales del componente son los del formulario de ingreso. La
// tabla, la carga masiva y su plantilla usan estas mismas etiquetas y este
// mismo orden: antes cada una tenía las suyas (y la carga masiva y la tabla
// agregaban una cantidad que el formulario no pide).
const CAMPO = {
  memo: 'Memo de baja',
  codigo: 'Código (SKU SAP)',
  nombre: 'Nombre del componente',
  especificaciones: 'Especificaciones',
  sitio: 'Sitio',
  ubicacion: 'Ubicación en terreno',
  cantidad: 'Cantidad',
  valor: 'Valor referencial (USD)',
  fotos: 'Fotos del componente',
  ficha: 'Ficha técnica',
};

// Columnas de la carga masiva, en el orden del formulario. La ayuda de la
// pantalla, la plantilla, la vista previa y el parser salen todas de aquí.
// El memo se elige una vez para toda la carga; fotos y ficha técnica no van
// en una planilla.
const COLUMNAS = [
  { campo: 'codigo', titulo: CAMPO.codigo, ej: '1000234', obligatorio: true },
  { campo: 'nombre', titulo: CAMPO.nombre, ej: 'Motor eléctrico 4.000 HP', obligatorio: true },
  { campo: 'especificaciones', titulo: CAMPO.especificaciones, ej: 'WEG · 3.300 V · 50 Hz' },
  { campo: 'sitio', titulo: CAMPO.sitio, ej: 'MEL', ayuda: 'MEL o La Negra' },
  { campo: 'ubicacion', titulo: CAMPO.ubicacion, ej: 'Sector B-3 · Fila 2' },
  { campo: 'cantidad', titulo: CAMPO.cantidad, ej: '1', num: true, ayuda: 'unidades que declara el memo; por defecto 1' },
  { campo: 'valor_referencial', titulo: CAMPO.valor, ej: '28500', num: true },
];

// Separa una línea en columnas: tabulación (pegado desde Excel) o punto y
// coma (la plantilla CSV). Respeta las comillas con que Excel envuelve un
// texto que trae el separador adentro ("WEG; 3.300 V").
function columnas(linea) {
  const sep = linea.includes('\t') ? '\t' : ';';
  const out = [];
  let actual = '';
  let comillas = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (comillas) {
      if (ch === '"' && linea[i + 1] === '"') { actual += '"'; i++; }
      else if (ch === '"') comillas = false;
      else actual += ch;
    } else if (ch === '"' && actual === '') comillas = true;
    else if (ch === sep) { out.push(actual.trim()); actual = ''; }
    else actual += ch;
  }
  out.push(actual.trim());
  return out;
}

// Una línea por componente. El encabezado de la plantilla (o cualquier fila
// que empiece con "Código") se descarta solo.
function parseMasivo(texto) {
  return texto.split(/\r?\n/).filter((l) => l.trim()).map((l) => {
    const c = columnas(l);
    const fila = {};
    COLUMNAS.forEach((col, i) => {
      const v = c[i] || '';
      fila[col.campo] = col.num ? v.replace(/[^\d]/g, '') : v;
    });
    return fila;
  }).filter((f) => (f.codigo || f.nombre) && !/^c[oó]digo/i.test(f.codigo));
}

// Plantilla CSV con el separador ";" que usa Excel en español y BOM UTF-8
// para que abra con las tildes correctas. Solo trae el encabezado: una fila de
// ejemplo se cargaría por error si nadie la borra.
function descargarPlantilla() {
  const csv = '\ufeff' + COLUMNAS.map((c) => c.titulo).join(';') + '\r\n';
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'plantilla-carga-masiva-componentes.csv' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Lee la plantilla completada. Excel guarda el CSV en UTF-8 o en el código de
// página de Windows según la versión: se prueba UTF-8 y, si no calza, 1252.
async function leerArchivo(archivo) {
  const buf = await archivo.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\ufeff/, ''); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
}

// Los nombres de material vienen de SAP sin espacios ("GASKET,TANK,FUEL,CAT"):
// un espacio de ancho cero tras cada coma deja cortar la línea ahí, y no a
// mitad de palabra, cuando la columna es angosta.
const cortable = (t) => (t ? String(t).replace(/,(?=\S)/g, ',\u200b') : t);

export default function Inventario() {
  // Pestañas: los pendientes quedaban debajo de un inventario largo y nadie los
  // veía. ?t= permite enlazar directo a una pestaña (p. ej. desde el panel).
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const tab = params.get('t') ?? 'inv';
  const setTab = (t) => setParams(t === 'inv' ? {} : { t }, { replace: true });
  const [data, setData] = useState(null);
  const [sitios, setSitios] = useState([]);
  const [busy, setBusy] = useState(false);
  const [nuevo, setNuevo] = useState(false);
  const [f, setF] = useState(vacio);
  const [editar, setEditar] = useState(null);
  const [eliminar, setEliminar] = useState(null);
  const [masivo, setMasivo] = useState(false);
  const [memos, setMemos] = useState([]);
  const [memoMasivo, setMemoMasivo] = useState('');
  const [errores, setErrores] = useState(null);   // errores por fila de la carga masiva
  const [texto, setTexto] = useState('');
  const [verAdj, setVerAdj] = useState(null);
  const [patios, setPatios] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [clasificar, setClasificar] = useState(null);
  const [cf, setCf] = useState({ patio_id: '', categoria_id: '', peso: '', unidad: 't', fecha: hoyISO() });
  const [terreno, setTerreno] = useState(null);       // confirmación en terreno con cantidad
  const [movimiento, setMovimiento] = useState(null); // enviadas / recibidas
  const [importar, setImportar] = useState(null);     // importación de la planilla de materiales
  const toast = useToast();

  const load = () => api('/componentes').then(setData).catch((e) => toast(e.message, true));
  useEffect(() => {
    load();
    // Obsoletos se dan de baja en faena MEL o en La Negra; Lampa no aplica.
    api('/maestros').then((m) => {
      setSitios((m.sitios ?? []).filter((s) => s.codigo !== 'LP'));
      // Patios y categorias son de Fase 1: los pide la derivacion a chatarra.
      setPatios(m.patios ?? []); setCategorias(m.categorias ?? []);
    }).catch(() => {});
    // El componente cuelga del memo que autoriza su baja; los cerrados ya no reciben.
    api('/memos').then((ms) => setMemos(ms.filter((m) => m.estado !== 'cerrado'))).catch(() => {});
  }, []);
  if (!data) return <div className="loading">Cargando inventario…</div>;

  // Envuelve una acción para bloquear el botón mientras corre (evita el doble clic).
  const correr = async (fn) => { if (busy) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };

  const crear = () => correr(async () => {
    if (!f.codigo.trim()) return toast('El código (SKU SAP) es obligatorio', true);
    if (!f.nombre.trim()) return toast('El nombre del componente es obligatorio', true);
    const fd = new FormData();
    fd.append('codigo', f.codigo.trim());
    fd.append('nombre', f.nombre.trim());
    fd.append('especificaciones', f.especificaciones);
    if (f.sitio_id) fd.append('sitio_id', f.sitio_id);
    fd.append('ubicacion', f.ubicacion);
    if (f.valor_referencial !== '') fd.append('valor_referencial', Number(f.valor_referencial));
    if (f.memo_id) fd.append('memo_id', f.memo_id);
    fd.append('cant_comprometida', Math.max(1, Math.round(Number(f.cant_comprometida) || 1)));
    for (const foto of f.fotos) fd.append('fotos', foto);
    if (f.ficha) fd.append('ficha', f.ficha);
    try {
      const c = await api('/componentes', { method: 'POST', body: fd });
      toast(`Componente ${c.codigo} ingresado · ya se puede publicar`);
      setNuevo(false); setF(vacio); load();
    } catch (e) { toast(e.message, true); }
  });

  const guardarEdicion = () => correr(async () => {
    if (!editar.codigo.trim()) return toast('El código es obligatorio', true);
    if (!editar.nombre.trim()) return toast('El nombre es obligatorio', true);
    try {
      await api(`/componentes/${editar.id}`, { method: 'PATCH', body: {
        codigo: editar.codigo.trim(), nombre: editar.nombre.trim(), especificaciones: editar.especificaciones,
        sitio_id: editar.sitio_id || '', ubicacion: editar.ubicacion,
        valor_referencial: editar.valor_referencial === '' ? '' : Number(editar.valor_referencial),
        cant_comprometida: Math.max(1, Math.round(Number(editar.cant_comprometida) || 1)) } });
      toast('Componente actualizado');
      setEditar(null); load();
    } catch (e) { toast(e.message, true); }
  });

  const eliminarComp = () => correr(async () => {
    try {
      await api(`/componentes/${eliminar.id}`, { method: 'DELETE' });
      toast(`${eliminar.codigo} eliminado`);
      setEliminar(null); load();
    } catch (e) { toast(e.message, true); }
  });

  const cargarMasivo = () => correr(async () => {
    const filas = parseMasivo(texto);
    if (!filas.length) return toast('No hay filas válidas para cargar', true);
    setErrores(null);
    try {
      const r = await api('/componentes/masivo', { method: 'POST', body: { filas, memo_id: memoMasivo || undefined } });
      toast(`${r.cargados} componente(s) cargado(s) · ya se pueden publicar`);
      setMasivo(false); setTexto(''); setMemoMasivo(''); load();
    } catch (e) { setErrores(e.detalle ?? null); toast(e.message, true); }
  });

  // Derivacion al programa de limpieza: con patio, categoria y peso el obsoleto
  // no vendido deja de ser una etiqueta y pasa a existir como carga de Fase 1.
  const derivar = () => correr(async () => {
    if (!cf.patio_id) return toast('Indique el patio donde se retirara', true);
    if (!cf.categoria_id) return toast('Indique la categoria de chatarra', true);
    const kg = aKg(cf.peso, cf.unidad);
    if (!kg) return toast('Indique el peso estimado', true);
    if (kg < 100) return toast('El programa se planifica en toneladas: el mínimo es 0,1 t (100 kg)', true);
    try {
      const r = await api(`/componentes/${clasificar.id}/clasificar`, { method: 'POST', body: {
        patio_id: Number(cf.patio_id), categoria_id: Number(cf.categoria_id),
        peso_estimado_kg: kg, fecha: cf.fecha } });
      toast(r.despacho?.estado === 'pendiente_guia'
        ? `${clasificar.codigo} derivado · despacho ${r.despacho.guia} pendiente de guía en Despachos`
        : `${clasificar.codigo} derivado · despacho ${r.despacho?.guia ?? ''} creado`);
      setClasificar(null); load();
    } catch (e) { toast(e.message, true); }
  });

  // La confirmación pide cuántos aparecieron: el memo declara 200 y en el patio
  // pueden estar 80, con 120 todavía por contar o ya dados por perdidos.
  const confirmarTerreno = (c) => setTerreno({
    c, cant_encontrada: String(c.cant_encontrada ?? c.cant_comprometida ?? 1), cant_no_encontrada: String(c.cant_no_encontrada ?? ''), nota: '',
  });
  const enviarTerreno = () => correr(async () => {
    const { c } = terreno;
    const enc = Math.round(Number(terreno.cant_encontrada));
    const ne = terreno.cant_no_encontrada === '' ? null : Math.round(Number(terreno.cant_no_encontrada));
    if (!(enc >= 1)) return toast('Indique cuántas unidades se encontraron (al menos 1)', true);
    if (ne != null && (ne < 0 || enc + ne > Number(c.cant_comprometida ?? enc))) return toast('Encontradas más no encontradas no pueden superar la cantidad comprometida', true);
    try {
      await api(`/componentes/${c.id}/terreno`, { method: 'POST', body: { encontrado: true, cant_encontrada: enc, ...(ne != null ? { cant_no_encontrada: ne } : {}), nota: terreno.nota.trim() } });
      toast(`${c.codigo} confirmado en terreno · ${enc} de ${c.cant_comprometida ?? enc}`);
      setTerreno(null); load();
    } catch (e) { toast(e.message, true); }
  });

  const enviarMovimiento = () => correr(async () => {
    const { c } = movimiento;
    const body = {};
    if (movimiento.cant_enviada !== '') body.cant_enviada = Math.round(Number(movimiento.cant_enviada));
    if (movimiento.cant_recibida !== '') body.cant_recibida = Math.round(Number(movimiento.cant_recibida));
    if (!Object.keys(body).length) return toast('Indique las unidades enviadas o recibidas', true);
    try {
      await api(`/componentes/${c.id}/cantidades`, { method: 'POST', body });
      toast(`${c.codigo}: movimiento registrado`);
      setMovimiento(null); load();
    } catch (e) { toast(e.message, true); }
  });

  // Importación de la planilla: la vista previa lee el archivo y muestra los
  // grupos; la carga manda las filas de vuelta con el memo de cada grupo.
  const previaPlanilla = (archivo) => correr(async () => {
    if (!archivo) return;
    const fd = new FormData();
    fd.append('archivo', archivo);
    try {
      const p = await api('/componentes/importar/previa', { method: 'POST', body: fd });
      const memosSel = {};
      const nuevos = {};
      for (const g of p.grupos) {
        if (!g.sin_memo) continue;
        // Si la planilla trae la referencia del memo y ya existe uno con ella, se propone.
        const conRef = g.memo_ref && memos.find((m) => (m.referencia || '').trim().toLowerCase() === g.memo_ref.toLowerCase());
        memosSel[g.clave] = conRef ? String(conRef.id) : '';
        nuevos[g.clave] = { area_usuaria: g.clave, referencia: g.memo_ref ?? '', emitido_por: '', fecha_memo: hoyISO() };
      }
      setImportar({ previa: p, memosSel, nuevos, resultado: null });
    } catch (e) { toast(e.message, true); }
  });
  const ejecutarImportacion = () => correr(async () => {
    const { previa, memosSel, nuevos } = importar;
    const memosBody = {};
    for (const g of previa.grupos) {
      if (!g.sin_memo) continue;
      const v = memosSel[g.clave];
      if (!v) return toast(`Elija el memo de baja para «${g.clave}»`, true);
      memosBody[g.clave] = v === '__nuevo__' ? { nuevo: nuevos[g.clave] } : Number(v);
    }
    try {
      const r = await api('/componentes/importar', { method: 'POST', body: { filas: previa.filas, memos: memosBody } });
      setImportar({ ...importar, resultado: r });
      toast(`Planilla importada · ${r.creados} nuevo(s) · ${r.actualizados} actualizado(s)`);
      load();
      api('/memos').then(setMemos).catch(() => {});
    } catch (e) { toast(e.message, true); }
  });

  async function abrirAdjuntos(c) {
    try {
      const r = await api(`/componentes/${c.id}/adjuntos`);
      if (!r.archivos?.length) return toast('Este componente no tiene adjuntos', true);
      setVerAdj({ componente: c, archivos: r.archivos });
    } catch (e) { toast(e.message, true); }
  }

  const previa = parseMasivo(texto);

  return (
    <div>
      <PageHead eyebrow={EYEBROW} title="Inventario y logística de obsoletos"
        sub="Los componentes nacen «por identificar» y se pueden publicar de inmediato; la confirmación en terreno registra después cuántas unidades aparecieron.">
        <button className="btn" onClick={() => setImportar({ previa: null })}>⇪ Importar planilla de materiales</button>
        <button className="btn" onClick={() => { setMasivo(true); setTexto(''); }}>⇪ Carga masiva</button>
        <button className="btn primary" onClick={() => { setNuevo(true); setF(vacio); }}>+ Ingresar componente</button>
      </PageHead>

      <Tabs active={tab} onChange={setTab} tabs={[
        ['inv', 'Inventario'],
        ['clasificar', 'Pendientes de clasificar', data.porClasificar?.length ?? 0],
        ['entrega', 'Pendientes de entrega', data.pendientes.length],
      ]} />

      {tab === 'inv' && (() => {
        // Totales por unidad, no por fila: un material son muchas unidades y
        // la pregunta de la operación es cuántas hay, cuántas aparecieron y
        // cuántas ya salieron.
        const vivos = data.componentes.filter((c) => c.estado !== 'chatarra');
        const suma = (k) => vivos.reduce((a, c) => a + (Number(c[k]) || 0), 0);
        const comprometidas = vivos.reduce((a, c) => a + (Number(c.cant_comprometida) || 1), 0);
        const encontradas = suma('cant_encontrada');
        const noEncontradas = suma('cant_no_encontrada');
        const porContar = Math.max(comprometidas - encontradas - noEncontradas, 0);
        const n = (x) => x.toLocaleString('es-CL');
        return (
          <div className="flow-mini" aria-label="Totales del inventario">
            <span className="fm"><span className="k">Materiales</span><span className="v display">{n(vivos.length)}</span></span>
            <span className="fm"><span className="k">Unidades</span><span className="v display">{n(comprometidas)}</span></span>
            <span className="fm-sep">→</span>
            <span className="fm"><span className="k">Encontradas</span><span className="v display">{n(encontradas)}</span></span>
            <span className="fm"><span className="k">No encontradas</span><span className="v display">{n(noEncontradas)}</span></span>
            <span className="fm"><span className="k">Por contar</span><span className="v display">{n(porContar)}</span></span>
            <span className="fm-sep">→</span>
            <span className="fm"><span className="k">Enviadas</span><span className="v display">{n(suma('cant_enviada'))}</span></span>
            <span className="fm"><span className="k">Recibidas</span><span className="v display">{n(suma('cant_recibida'))}</span></span>
            {data.componentes.length > vivos.length && (
              <span className="fm" style={{ marginLeft: 'auto' }}><span className="k">A chatarra</span><span className="v display">{n(data.componentes.length - vivos.length)} <small>mat.</small></span></span>
            )}
          </div>
        );
      })()}

      {tab === 'inv' && (
      <div className="card"><div className="tbl-wrap"><table className="densa cabecera-libre">
        {/* Mismas columnas, en el mismo orden y con las mismas etiquetas que el
            formulario de ingreso (CAMPO), más el estado del proceso. */}
        <thead><tr><th>{CAMPO.memo}</th><th>{CAMPO.codigo}</th><th>{CAMPO.nombre}</th><th>{CAMPO.especificaciones}</th>
          <th>{CAMPO.sitio}</th><th>{CAMPO.ubicacion}</th><th className="num" title="Comprometida · encontrada / no encontrada · enviada / recibida">{CAMPO.cantidad}</th>
          <th className="num">{CAMPO.valor}</th><th>Estado</th><th className="acc"></th></tr></thead>
        <tbody>
          {data.componentes.map((c) => {
            const [tono, txt] = ESTADO[c.estado] ?? ['neutral', c.estado];
            return (
              <tr key={c.id}>
                <td>{c.memo
                  ? <><span className="mono">{c.memo}</span><small className="recorte" title={c.area_usuaria}>{c.area_usuaria}</small></>
                  : <small style={{ color: 'var(--muted)' }}>Sin memo</small>}</td>
                <td className="mono">{c.codigo}</td>
                <td className="parte"><b>{cortable(c.nombre)}</b>
                  {c.fotos > 0 && <small style={{ color: 'var(--muted)', display: 'block' }} title="Fotos y ficha técnica adjuntas">📎 {c.fotos} adjunto(s)</small>}</td>
                <td className="parte" style={{ minWidth: 100, overflowWrap: 'anywhere' }}><small className="dos-lineas" title={c.especificaciones || undefined}>{cortable(c.especificaciones) || '—'}</small></td>
                <td>{c.sitio || '—'}</td>
                <td>{c.ubicacion || '—'}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }} title={resumenCantidades(c)}>
                  <b>{c.cant_comprometida ?? 1}</b>
                  {(c.cant_encontrada != null || c.cant_enviada != null || c.cant_recibida != null) && (
                    <small style={{ display: 'block', color: 'var(--muted)' }}>
                      {c.cant_encontrada != null && <>enc. {c.cant_encontrada}</>}
                      {c.cant_no_encontrada > 0 && <> · no {c.cant_no_encontrada}</>}
                      {c.cant_enviada != null && <> · env. {c.cant_enviada}</>}
                      {c.cant_recibida != null && <> · rec. {c.cant_recibida}</>}
                    </small>
                  )}
                </td>
                <td className="num" title={c.monto_clp != null ? `Valor contable SAP: ${fmtCLP(c.monto_clp)}` : undefined}>
                  {fmtUSD(c.valor_referencial)}
                  {c.monto_clp != null && <small style={{ display: 'block', color: 'var(--muted)' }}>SAP {fmtCLP(c.monto_clp)}</small>}
                </td>
                <td title={ESTADO[c.estado]?.[2]}><Chip tone={tono}>{txt}{c.estado === 'publicado' && c.dia != null ? ` · día ${c.dia}` : ''}</Chip>
                  {c.nota_terreno && <><br /><small style={{ color: 'var(--muted)' }}>{c.nota_terreno}</small></>}</td>
                <td className="num acc">
                  <Acciones columnas="94px 68px" filas={[
                    [['por_identificar', 'planificado'].includes(c.estado) && (
                      <button className="btn sm primary" onClick={() => nav(`/publicaciones?comp=${c.id}`)}
                        title="Publicar en el portal: la confirmación en terreno no es requisito">Publicar</button>
                    )],
                    [['por_identificar', 'no_encontrado'].includes(c.estado) || (['publicado', 'adjudicado'].includes(c.estado) && c.cant_encontrada == null) ? (
                      <button className="btn sm" disabled={busy} onClick={() => confirmarTerreno(c)}
                        title="Registrar que se encontró en terreno y cuántas unidades">Confirmar en terreno</button>
                    ) : ['planificado', 'publicado', 'adjudicado'].includes(c.estado) && c.cant_encontrada > 0 && (
                      <button className="btn sm" disabled={busy} title="Registrar unidades enviadas y recibidas"
                        onClick={() => setMovimiento({ c, cant_enviada: String(c.cant_enviada ?? ''), cant_recibida: String(c.cant_recibida ?? '') })}>Movimiento</button>
                    )],
                    [<BotonDocs hito="componente" refId={c.id} />,
                      <button className="btn sm" onClick={() => setEditar({ ...c, especificaciones: c.especificaciones ?? '', ubicacion: c.ubicacion ?? '', sitio_id: c.sitio_id ?? '', valor_referencial: c.valor_referencial ?? '', cant_comprometida: c.cant_comprometida ?? 1 })}>Editar</button>],
                    [c.fotos > 0 && <button className="btn sm" onClick={() => abrirAdjuntos(c)}>Adjuntos</button>,
                      ['planificado', 'por_identificar', 'no_encontrado'].includes(c.estado) && <button className="btn sm danger" onClick={() => setEliminar(c)}>Eliminar</button>],
                  ]} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
        {data.componentes.length === 0 && <Empty title="Inventario vacío">Ingrese el primer componente obsoleto para planificar su venta.</Empty>}
      </div>
      )}

      {tab === 'clasificar' && (
        <div className="card">
          <div className="card-h">
            <h3>Pendientes de clasificar para chatarra</h3>
            <small>no se vendieron · esperan patio, categoría y peso para entrar al programa</small>
          </div>
          <div className="tbl-wrap"><table>
            <thead><tr><th>{CAMPO.nombre}</th><th>{CAMPO.sitio}</th><th>{CAMPO.ubicacion}</th><th>Motivo</th><th className="num">Días esperando</th><th className="acc"></th></tr></thead>
            <tbody>
              {(data.porClasificar ?? []).map((c) => (
                <tr key={c.id}>
                  <td><b>{cortable(c.nombre)}</b><br /><small className="mono" style={{ color: 'var(--muted)' }}>{c.codigo}</small></td>
                  <td>{c.sitio || '—'}</td>
                  <td>{c.ubicacion || '—'}</td>
                  <td><small style={{ color: 'var(--ink-2)' }}>{c.motivo || '—'}</small></td>
                  <td className="num">{c.desde ?? '—'}</td>
                  <td className="num acc">
                    <button className="btn sm primary" disabled={busy}
                      onClick={() => { setClasificar(c); setCf({ patio_id: '', categoria_id: '', peso: '', unidad: 't', fecha: hoyISO() }); }}>
                      Clasificar y derivar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {!data.porClasificar?.length && (
            <Empty title="Sin pendientes">Ningún componente convertido a chatarra espera clasificación.</Empty>
          )}
          <div className="audit-note" style={{ margin: 12 }}>
            ⚙ Mientras estén acá, la cuadrilla de limpieza no tiene instrucción de retirarlos. Al clasificarlos se crea el
            registro en el programa de limpieza y el despacho a La Negra, donde se valorizan al recepcionarse.
          </div>
        </div>
      )}

      {tab === 'entrega' && (
      <div className="card">
        <div className="card-h"><h3>Pendientes de entrega</h3><small>adjudicados sin retiro coordinado</small></div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Componente</th><th>Comprador</th><th>Adjudicado el</th><th className="num">Días de espera</th><th>Estado</th></tr></thead>
          <tbody>
            {data.pendientes.map((p) => (
              <tr key={p.adjudicacion_id}>
                <td><b>{p.componente}</b><br /><small className="mono" style={{ color: 'var(--muted)' }}>{p.codigo}</small></td>
                <td>{p.comprador}</td>
                <td className="mono">{p.adjudicado_el}</td>
                <td className="num">{p.dias_espera}</td>
                <td><Chip tone={p.estado === 'pagada' ? 'warn' : 'info'}>{p.estado === 'pagada' ? 'Pagado · por retirar' : 'Sin coordinación'}</Chip></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {data.pendientes.length === 0 && <Empty title="Sin pendientes">No hay componentes adjudicados esperando retiro.</Empty>}
      </div>
      )}

      {/* ---- alta ---- */}
      <Modal open={nuevo} title="Ingresar componente obsoleto" onClose={() => setNuevo(false)}
        footer={<>
          <button className="btn" onClick={() => setNuevo(false)} disabled={busy}>Cancelar</button>
          <button className="btn primary" onClick={crear} disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar al inventario'}</button>
        </>}>
        <Campos v={f} set={setF} sitios={sitios} memos={memos} conArchivos />
      </Modal>

      {/* ---- edición ---- */}
      <Modal open={!!editar} title={editar && `Editar ${editar.codigo}`} onClose={() => setEditar(null)}
        footer={<>
          <button className="btn" onClick={() => setEditar(null)} disabled={busy}>Cancelar</button>
          <button className="btn primary" onClick={guardarEdicion} disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
        </>}>
        {editar && <Campos v={editar} set={setEditar} sitios={sitios} />}
        {editar?.importado_el && <DatosSAP c={editar} />}
      </Modal>

      {/* ---- confirmación en terreno ---- */}
      <Modal open={!!terreno} title={terreno && `Confirmar en terreno · ${terreno.c.codigo}`} onClose={() => setTerreno(null)}
        footer={<>
          <button className="btn" onClick={() => setTerreno(null)} disabled={busy}>Cancelar</button>
          <button className="btn primary" onClick={enviarTerreno} disabled={busy}>{busy ? 'Guardando…' : 'Confirmar'}</button>
        </>}>
        {terreno && <>
          <p style={{ marginTop: 0 }}><b>{terreno.c.nombre}</b> · el memo declara <b>{terreno.c.cant_comprometida ?? 1}</b> unidad(es).</p>
          <div className="grid g2" style={{ gap: 0, columnGap: 14 }}>
            <Field label="Unidades encontradas">
              <input type="number" min="1" step="1" value={terreno.cant_encontrada} onChange={(e) => setTerreno({ ...terreno, cant_encontrada: e.target.value })} />
            </Field>
            <Field label="Unidades no encontradas" hint="Las que se buscaron y no están. El resto queda por contar.">
              <input type="number" min="0" step="1" value={terreno.cant_no_encontrada} onChange={(e) => setTerreno({ ...terreno, cant_no_encontrada: e.target.value })} placeholder="0" />
            </Field>
          </div>
          <Field label="Nota de terreno" hint="Opcional.">
            <textarea rows="2" value={terreno.nota} onChange={(e) => setTerreno({ ...terreno, nota: e.target.value })} placeholder="Ubicado en patio A-1, completo." />
          </Field>
        </>}
      </Modal>

      {/* ---- movimiento (enviadas / recibidas) ---- */}
      <Modal open={!!movimiento} title={movimiento && `Movimiento · ${movimiento.c.codigo}`} onClose={() => setMovimiento(null)}
        footer={<>
          <button className="btn" onClick={() => setMovimiento(null)} disabled={busy}>Cancelar</button>
          <button className="btn primary" onClick={enviarMovimiento} disabled={busy}>{busy ? 'Guardando…' : 'Registrar'}</button>
        </>}>
        {movimiento && <>
          <p style={{ marginTop: 0, color: 'var(--ink-2)', fontSize: 13.5 }}>
            <b>{movimiento.c.nombre}</b>: encontradas {movimiento.c.cant_encontrada}. Registre cuántas unidades salieron hacia la zona
            de consolidación o La Negra y cuántas llegaron.
          </p>
          <div className="grid g2" style={{ gap: 0, columnGap: 14 }}>
            <Field label="Unidades enviadas" hint="Acumulado a la fecha.">
              <input type="number" min="0" step="1" value={movimiento.cant_enviada} onChange={(e) => setMovimiento({ ...movimiento, cant_enviada: e.target.value })} />
            </Field>
            <Field label="Unidades recibidas" hint="Acumulado a la fecha.">
              <input type="number" min="0" step="1" value={movimiento.cant_recibida} onChange={(e) => setMovimiento({ ...movimiento, cant_recibida: e.target.value })} />
            </Field>
          </div>
        </>}
      </Modal>

      {/* ---- importación de la planilla de materiales ---- */}
      <Modal open={!!importar} title="Importar planilla de materiales" onClose={() => setImportar(null)} ancho
        footer={<>
          <button className="btn" onClick={() => setImportar(null)} disabled={busy}>{importar?.resultado ? 'Cerrar' : 'Cancelar'}</button>
          {importar?.previa && !importar.resultado && (
            <button className="btn primary" onClick={ejecutarImportacion} disabled={busy || !importar.previa.aprobadas}>
              {busy ? 'Importando…' : `Importar ${importar.previa.aprobadas} fila(s) aprobada(s)`}
            </button>
          )}
        </>}>
        {importar && !importar.previa && (<>
          <p style={{ marginTop: 0, color: 'var(--ink-2)', fontSize: 13.5 }}>
            Suba la planilla de materiales tal como la exporta la hoja de control, en Excel (.xlsx) o CSV separado por «;» (una fila por material SAP).
            Primero verá qué va a cargar; nada se guarda hasta confirmar. Importar la misma planilla más adelante actualiza por
            código SAP: cantidades, estado de terreno y ubicación; no duplica.
          </p>
          <Field label="Archivo" hint="Solo entran las filas con «Aprobado = Sí». Las demás se listan para que se vea cuántas quedan afuera.">
            <input type="file" accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain"
              onChange={(e) => { const a = e.target.files?.[0]; e.target.value = ''; previaPlanilla(a); }} />
          </Field>
          {busy && <div className="loading">Leyendo la planilla…</div>}
        </>)}
        {importar?.previa && !importar.resultado && (() => {
          const p = importar.previa;
          return (<>
            <div className="alerta info" style={{ marginBottom: 12 }}>
              <b>{p.archivo}</b>
              <span>{p.total} material(es) · <b>{p.aprobadas} aprobado(s)</b> que se importan · {p.total - p.aprobadas} sin aprobar que quedan afuera
                {p.omitidas.length > 0 && <> · {p.omitidas.length} fila(s) omitida(s)</>}</span>
            </div>
            <div className="tbl-wrap"><table className="densa">
              <thead><tr><th>Área · sub-área</th><th className="num">Nuevos</th><th className="num">Actualizan</th><th className="num">Unidades</th><th className="num">Sin aprobar</th><th>Memo de baja</th></tr></thead>
              <tbody>
                {p.grupos.map((g) => (
                  <tr key={g.clave}>
                    <td><b>{g.clave}</b>{g.memo_ref && <><br /><small className="mono" style={{ color: 'var(--muted)' }}>{g.memo_ref}</small></>}</td>
                    <td className="num">{g.nuevas}</td>
                    <td className="num">{g.actualizan}</td>
                    <td className="num">{g.unidades.toLocaleString('es-CL')}</td>
                    <td className="num" style={{ color: g.no_aprobadas ? 'var(--warn-tx)' : undefined }}>{g.no_aprobadas}</td>
                    <td style={{ minWidth: 220 }}>
                      {!g.sin_memo ? <small style={{ color: 'var(--muted)' }}>{g.nuevas + g.actualizan ? 'Ya tienen memo' : 'Nada que importar'}</small> : (<>
                        <Select value={importar.memosSel[g.clave] ?? ''} onChange={(e) => setImportar({ ...importar, memosSel: { ...importar.memosSel, [g.clave]: e.target.value } })}>
                          <option value="">— Elija el memo —</option>
                          {memos.map((m) => <option key={m.id} value={String(m.id)}>{m.folio} · {m.area_usuaria}</option>)}
                          <option value="__nuevo__">+ Crear memo nuevo para este grupo</option>
                        </Select>
                        {importar.memosSel[g.clave] === '__nuevo__' && (
                          <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                            <input value={importar.nuevos[g.clave].area_usuaria} placeholder="Área usuaria"
                              onChange={(e) => setImportar({ ...importar, nuevos: { ...importar.nuevos, [g.clave]: { ...importar.nuevos[g.clave], area_usuaria: e.target.value } } })} />
                            <input value={importar.nuevos[g.clave].referencia} placeholder="Referencia del memo (opcional)"
                              onChange={(e) => setImportar({ ...importar, nuevos: { ...importar.nuevos, [g.clave]: { ...importar.nuevos[g.clave], referencia: e.target.value } } })} />
                            <input value={importar.nuevos[g.clave].emitido_por} placeholder="Quien firma (opcional)"
                              onChange={(e) => setImportar({ ...importar, nuevos: { ...importar.nuevos, [g.clave]: { ...importar.nuevos[g.clave], emitido_por: e.target.value } } })} />
                          </div>
                        )}
                      </>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            {p.omitidas.length > 0 && (
              <div className="audit-note" style={{ marginTop: 10 }}>
                Omitidas: {p.omitidas.slice(0, 8).map((o) => `fila ${o.fila}${o.codigo ? ` (${o.codigo})` : ''}: ${o.motivo}`).join(' · ')}{p.omitidas.length > 8 ? ' · …' : ''}
              </div>
            )}
            <p style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 0 }}>
              Los componentes que ya avanzaron en la plataforma (publicados, adjudicados, entregados o en chatarra) conservan su estado;
              la planilla les actualiza cantidades, ubicación y datos SAP. El memo que ya tienen no se cambia.
            </p>
          </>);
        })()}
        {importar?.resultado && (() => {
          const r = importar.resultado;
          return (<>
            <div className="alerta info"><b>Importación lista</b>
              <span>{r.creados} componente(s) nuevo(s) · {r.actualizados} actualizado(s)
                {r.valores_corregidos > 0 && <> · {r.valores_corregidos} valor(es) referencial(es) que tenían pesos se limpiaron</>}
                {r.memos_creados.length > 0 && <> · memos creados: {r.memos_creados.join(', ')}</>}</span>
            </div>
            {r.errores.length > 0 && (
              <div className="aviso bad"><b>{r.errores.length} fila(s) no entraron</b>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{r.errores.map((e, i) => <li key={i}>{e}</li>)}</ul></div>
            )}
          </>);
        })()}
      </Modal>

      {/* ---- eliminar ---- */}
      <Modal open={!!eliminar} title="Eliminar componente" onClose={() => setEliminar(null)}
        footer={<>
          <button className="btn" onClick={() => setEliminar(null)} disabled={busy}>Cancelar</button>
          <button className="btn danger" onClick={eliminarComp} disabled={busy}>{busy ? 'Eliminando…' : 'Eliminar'}</button>
        </>}>
        <p style={{ marginTop: 0 }}>¿Eliminar <b>{eliminar?.nombre}</b> ({eliminar?.codigo}) del inventario? Se borran también sus adjuntos. Esta acción no se revierte.</p>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>Solo se pueden eliminar componentes que aún no se publicaron.</p>
      </Modal>

      {/* ---- carga masiva ---- */}
      <Modal open={masivo} title="Carga masiva de componentes" onClose={() => { setMasivo(false); setErrores(null); }} ancho
        footer={<>
          <button className="btn" onClick={() => { setMasivo(false); setErrores(null); }} disabled={busy}>Cancelar</button>
          <button className="btn primary" onClick={cargarMasivo} disabled={busy || !previa.length}>{busy ? 'Cargando…' : `Cargar ${previa.length || ''}`}</button>
        </>}>
        <div className="masivo-plantilla">
          <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 13.5 }}>
            Descargue la plantilla, complétela en Excel (una fila por componente) y súbala aquí. También puede
            pegar las filas copiadas desde Excel. Las columnas son los campos del formulario de ingreso, en el mismo orden:
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn sm" onClick={descargarPlantilla}>⇩ Descargar plantilla</button>
            <label className="btn sm" style={{ cursor: 'pointer' }}>
              ⇪ Subir plantilla completada
              <input type="file" accept=".csv,.txt,text/csv,text/plain" hidden
                onChange={async (e) => {
                  const a = e.target.files?.[0];
                  e.target.value = '';
                  if (!a) return;
                  if (/\.xlsx?$/i.test(a.name)) return toast('Guarde la plantilla como CSV (Archivo › Guardar como › CSV) o copie las filas y péguelas aquí', true);
                  setTexto(await leerArchivo(a));
                  setErrores(null);
                }} />
            </label>
          </div>
        </div>
        <div className="tbl-wrap" style={{ margin: '10px 0 4px' }}><table>
          <thead><tr>
            <th style={{ width: 28 }}>#</th><th>Columna</th><th>Ejemplo</th>
          </tr></thead>
          <tbody>
            {COLUMNAS.map((c, i) => (
              <tr key={c.campo}>
                <td className="mono" style={{ color: 'var(--muted)' }}>{i + 1}</td>
                <td>
                  <b>{c.titulo}</b>
                  {c.obligatorio
                    ? <small style={{ color: 'var(--bad-tx)' }}> · obligatoria</small>
                    : <small style={{ color: 'var(--muted)' }}> · opcional{c.ayuda ? ` · ${c.ayuda}` : ''}</small>}
                </td>
                <td className="mono" style={{ color: 'var(--muted)' }}>{c.ej}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <p style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 10 }}>
          Las columnas opcionales pueden ir vacías, pero <b>su lugar debe respetarse</b>. El encabezado de la
          plantilla se descarta solo. El {CAMPO.memo.toLowerCase()} se elige abajo, una vez para toda la carga;
          las fotos y la ficha técnica no van en la planilla.
        </p>
        {errores?.length > 0 && (
          <div className="aviso" style={{ borderColor: 'var(--bad-line)', background: 'var(--bad-bg)' }}>
            <b style={{ color: 'var(--bad-tx)' }}>La carga no entró · {errores.length} problema(s)</b>
            <p>Se revisa toda la planilla antes de cargar: o entran todas las filas, o no entra ninguna.
            Corrige lo siguiente y vuelve a pegar.</p>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
              {errores.map((e, i) => <li key={i} style={{ marginTop: 3 }}>{e}</li>)}
            </ul>
          </div>
        )}
        <Field label="Memo de baja" hint="Toda la carga queda respaldada por este memo: es la lista que declara.">
          <Select value={memoMasivo} onChange={(e) => setMemoMasivo(e.target.value)}>
            <option value="">— Elija el memo —</option>
            {memos.map((m) => <option key={m.id} value={m.id}>{m.folio} · {m.area_usuaria}</option>)}
          </Select>
        </Field>
        <Field label="Datos">
          <textarea rows="7" value={texto} onChange={(e) => setTexto(e.target.value)}
            placeholder={'1000234;Motor eléctrico 4000 HP;WEG 3.300V;MEL;Sector B-3 · Fila 2;28500\n1000235;Tolva CAEX 930E;Estructura completa;La Negra;Patio A-1;45000'} />
        </Field>
        {previa.length > 0 && (
          <div className="tbl-wrap" style={{ marginTop: 4 }}><table>
            <thead><tr>{COLUMNAS.map((c) => <th key={c.campo} className={c.num ? 'num' : undefined}>{c.titulo}</th>)}</tr></thead>
            <tbody>
              {previa.slice(0, 8).map((r, i) => (
                <tr key={i}>
                  <td className="mono">{r.codigo || <span style={{ color: 'var(--bad-tx)' }}>falta</span>}</td>
                  <td>{r.nombre || <span style={{ color: 'var(--bad-tx)' }}>falta</span>}</td>
                  <td>{r.especificaciones || '—'}</td>
                  <td>{r.sitio || '—'}</td><td>{r.ubicacion || '—'}</td>
                  <td className="num">{r.cantidad || 1}</td>
                  <td className="num">{r.valor_referencial ? fmtUSD(r.valor_referencial) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>{previa.length > 8 && <small style={{ color: 'var(--muted)' }}>… y {previa.length - 8} más</small>}</div>
        )}
      </Modal>

      {/* ---- clasificación para chatarra ---- */}
      <Modal open={!!clasificar} title={clasificar && `Derivar a chatarra · ${clasificar.codigo}`} onClose={() => setClasificar(null)}
        footer={<>
          <button className="btn" onClick={() => setClasificar(null)} disabled={busy}>Cancelar</button>
          <button className="btn primary" onClick={derivar} disabled={busy}>{busy ? 'Derivando…' : 'Derivar al programa'}</button>
        </>}>
        <p style={{ marginTop: 0 }}><b>{clasificar?.nombre}</b> no se vendió y pasó a chatarra.</p>
        <p style={{ color: 'var(--ink-2)', fontSize: 13.5 }}>
          El proceso de chatarra mueve <b>kilos de una categoría desde un patio</b>, y el componente no trae ninguno de esos datos:
          por eso hay que clasificarlo. Con esto se crea el registro en el programa de limpieza y su despacho a
          La Negra, que queda <b>«Pendiente guía»</b> en Despachos hasta que se ingresen la guía MEL, el pesaje y los
          respaldos. Se valoriza al recepcionarse en La Negra.
        </p>
        <div className="grid g2" style={{ gap: 0, columnGap: 14 }}>
          <Field label="Patio de retiro">
            <Select value={cf.patio_id} onChange={(e) => setCf({ ...cf, patio_id: e.target.value })}>
              <option value="">— Elija el patio —</option>
              {patios.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </Select>
          </Field>
          <Field label="Categoría de chatarra" hint="Define el precio por kilo.">
            <Select value={cf.categoria_id} onChange={(e) => setCf({ ...cf, categoria_id: e.target.value })}>
              <option value="">— Elija la categoría —</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid g2" style={{ gap: 0, columnGap: 14 }}>
          {/* Mismo campo de peso que al registrar un despacho (kg o t), pero
              parte en toneladas: el programa de limpieza planifica en toneladas. */}
          <CampoPeso label="Peso estimado" hint="Mínimo 0,1 t (100 kg)."
            valor={cf.peso} unidad={cf.unidad}
            onValor={(v) => setCf({ ...cf, peso: v })}
            onUnidad={(u) => setCf({ ...cf, unidad: u })} />
          <Field label="Fecha de retiro" hint="Define la semana y el día del programa de limpieza.">
            <DateField value={cf.fecha} onChange={(e) => setCf({ ...cf, fecha: e.target.value })} />
          </Field>
        </div>
      </Modal>

      {/* ---- adjuntos ---- */}
      <Modal open={!!verAdj} title={verAdj && `Adjuntos · ${verAdj.componente.nombre}`} onClose={() => setVerAdj(null)} ancho>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 8 }}>
          {verAdj?.archivos.map((a) => (
            <a key={a.url} href={a.url} target="_blank" rel="noreferrer" title={a.tipo === 'ficha' ? 'Ficha técnica' : 'Foto'}>
              {a.tipo === 'ficha'
                ? <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', height: 130, background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--line)', color: 'var(--ink-2)', fontSize: 13, fontWeight: 600 }}><span style={{ fontSize: 26 }}>📄</span>Ficha técnica</span>
                : <img src={a.url} alt="Foto" style={{ width: '100%', height: 130, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)' }} />}
            </a>
          ))}
        </div>
      </Modal>
    </div>
  );
}

// Campos compartidos entre alta y edición.
// Resumen de cantidades para el texto emergente de la columna.
function resumenCantidades(c) {
  const partes = [`Comprometida ${c.cant_comprometida ?? 1}`];
  if (c.cant_encontrada != null) partes.push(`encontrada ${c.cant_encontrada}`);
  if (c.cant_no_encontrada != null) partes.push(`no encontrada ${c.cant_no_encontrada}`);
  if (c.cant_enviada != null) partes.push(`enviada ${c.cant_enviada}`);
  if (c.cant_recibida != null) partes.push(`recibida ${c.cant_recibida}`);
  return partes.join(' · ');
}

// Lo que trae la planilla de materiales y la plataforma guarda sin editar: el
// origen SAP del componente, para consultarlo sin abrir la hoja de control.
function DatosSAP({ c }) {
  const filas = [
    ['Área · sub-área', [c.area, c.subarea].filter(Boolean).join(' · ')],
    ['Planta · storage location', [c.planta, c.storage_location].filter(Boolean).join(' · ')],
    ['MRP', [c.mrp_controller, c.mrp_type].filter(Boolean).join(' · ')],
    ['Precio unitario SAP', c.precio_unitario_clp != null ? fmtCLP(c.precio_unitario_clp) : ''],
    ['Monto SAP', c.monto_clp != null ? fmtCLP(c.monto_clp) : ''],
    ['Estado en la planilla', c.estado_planilla],
    ['Encontrado el', c.encontrado_el ? `${c.encontrado_el}${c.responsable_terreno ? ` · ${c.responsable_terreno}` : ''}` : ''],
    ['Último despacho', c.despachado_el],
    ['Guías GD / GV', [c.guias_gd, c.guias_gv].filter(Boolean).join(' / ')],
    ['Ficha técnica en SAP', c.ficha_sap == null ? '' : c.ficha_sap ? 'Creada' : 'No'],
  ].filter(([, v]) => v);
  if (!filas.length) return null;
  return (
    <div style={{ marginTop: 6, borderTop: '1px dashed var(--line)', paddingTop: 12 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--ink-2)', marginBottom: 6 }}>
        Datos de la planilla de materiales
        <small style={{ fontWeight: 500, letterSpacing: 0, textTransform: 'none', marginLeft: 8, color: 'var(--muted)' }}>
          importados el {new Date(c.importado_el).toLocaleDateString('es-CL')} · se actualizan al reimportar
        </small>
      </div>
      <table style={{ fontSize: 12.5 }}><tbody>
        {filas.map(([k, v]) => <tr key={k}><td style={{ padding: '3px 12px 3px 0', color: 'var(--muted)', border: 0 }}>{k}</td><td style={{ padding: '3px 0', border: 0 }}>{v}</td></tr>)}
      </tbody></table>
    </div>
  );
}

function Campos({ v, set, sitios, memos, conArchivos }) {
  return (<>
    {memos && (
      <Field label={CAMPO.memo}
        hint="El memo firmado del área usuaria que autoriza enajenar este componente. Se carga en «Memos de baja».">
        <Select value={v.memo_id} onChange={(e) => set({ ...v, memo_id: e.target.value })}>
          <option value="">— Elija el memo —</option>
          {memos.map((m) => <option key={m.id} value={m.id}>{m.folio} · {m.area_usuaria}</option>)}
        </Select>
        {memos.length === 0 && (
          <small style={{ color: 'var(--warn-tx)', display: 'block', marginTop: 6 }}>
            No hay memos abiertos. Cargue primero el memo en «Memos de baja».
          </small>
        )}
      </Field>
    )}
    <div className="grid g2" style={{ gap: 0, columnGap: 14 }}>
      <Field label={CAMPO.codigo} hint="Se digita: corresponde al SKU del componente en SAP.">
        <input value={v.codigo} onChange={(e) => set({ ...v, codigo: e.target.value })} placeholder="1000234" />
      </Field>
      <Field label={CAMPO.nombre}>
        <input value={v.nombre} onChange={(e) => set({ ...v, nombre: e.target.value })} placeholder="Motor eléctrico 4.000 HP" />
      </Field>
    </div>
    <Field label={CAMPO.especificaciones} hint="Marca, características, estado de uso. Se muestran en el portal público.">
      <textarea rows="2" value={v.especificaciones} onChange={(e) => set({ ...v, especificaciones: e.target.value })}
        placeholder="WEG · 3.300 V · 50 Hz · usado, operativo al retiro de servicio" />
    </Field>
    <div className="grid g2" style={{ gap: 0, columnGap: 14 }}>
      <Field label={CAMPO.sitio}>
        <Select value={v.sitio_id} onChange={(e) => set({ ...v, sitio_id: e.target.value })}>
          <option value="">— Sin definir —</option>
          {sitios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </Select>
      </Field>
      <Field label={CAMPO.ubicacion}>
        <input value={v.ubicacion} onChange={(e) => set({ ...v, ubicacion: e.target.value })} placeholder="Sector B-3 · Fila 2" />
      </Field>
    </div>
    <div className="grid g2" style={{ gap: 0, columnGap: 14 }}>
      <Field label={CAMPO.cantidad} hint="Unidades que declara el memo.">
        <input type="number" min="1" step="1" value={v.cant_comprometida ?? 1} onChange={(e) => set({ ...v, cant_comprometida: e.target.value })} />
      </Field>
      <Field label={CAMPO.valor} hint="Estimación de venta en dólares; no es la oferta mínima.">
        <input type="number" min="0" value={v.valor_referencial} onChange={(e) => set({ ...v, valor_referencial: e.target.value })} placeholder="28500" />
      </Field>
    </div>
    {conArchivos && <>
      <Field label={CAMPO.fotos} hint="JPG, PNG o WebP · hasta 4 · se muestran en el portal público.">
        <input type="file" multiple accept="image/jpeg,image/png,image/webp"
          onChange={(e) => set({ ...v, fotos: Array.from(e.target.files).slice(0, 4) })} />
        {v.fotos?.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {v.fotos.map((foto) => (
              <img key={foto.name} src={URL.createObjectURL(foto)} alt={foto.name}
                style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--line)' }} />
            ))}
          </div>
        )}
      </Field>
      <Field label={CAMPO.ficha} hint="PDF, planilla Excel o foto. Opcional.">
        <input type="file" accept={FICHA_ACCEPT}
          onChange={(e) => set({ ...v, ficha: e.target.files[0] || null })} />
        {v.ficha && <small style={{ color: 'var(--muted)', display: 'block', marginTop: 6 }}>📄 {v.ficha.name}</small>}
      </Field>
    </>}
  </>);
}
