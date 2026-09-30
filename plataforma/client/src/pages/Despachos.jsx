import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fmtCLP, fmtKg } from '../api.js';
import { useAuth } from '../auth.jsx';
import { DateField, Select, CampoPeso, Chip, Empty, Field, Modal, PageHead, Tabs, aKg, unidadGuardada, useToast } from '../ui.jsx';

const CHIP = {
  en_transito: ['info', 'En tránsito'], recepcionado: ['ok', 'Recepcionado'],
  observado: ['warn', 'Difer. de peso'], anulado: ['bad', 'Anulada'],
};

// Descuentos que se aplican sobre una recepción. El monto fijo se puede cargar
// en dólares —la moneda del contrato— o en pesos, como venga en el documento.
const TIPO_DESC = [
  ['kg', 'Kilos', 'kg', 'Se descuentan del peso antes de valorizar.'],
  ['pct', 'Porcentaje', '%', 'Se descuenta del valor de la carga.'],
  ['usd', 'Monto en dólares', 'USD', 'Monto fijo en dólares, descontado al final.'],
  ['clp', 'Monto en pesos', '$', 'Monto fijo en pesos enteros, convertido con el dólar congelado de la guía.'],
];
const descTexto = (d) => d.tipo === 'pct' ? `${d.valor} %`
  : d.tipo === 'usd' ? `USD ${d.valor}`
  : d.tipo === 'clp' ? fmtCLP(d.valor)
  : `${fmtKg(d.valor)} kg`;

// Precio vigente de una categoría, en la unidad en que esté pactado. Va al
// lado del nombre en los desplegables, como referencia de quien elige.
const usd = (v) => Number(v).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const precioRef = (c) =>
  c?.precio_usd_tm != null ? ` · USD ${usd(c.precio_usd_tm)}/TM`
  : c?.precio_usd != null ? ` · USD ${c.precio_usd}/kg`
  : c?.precio_kg ? ` · $${Number(c.precio_kg).toLocaleString('es-CL')}/kg`
  : '';

// El servidor solo guarda imágenes y hasta 5 MB. Si el navegador deja elegir
// otra cosa —basta con poner «todos los archivos» en el diálogo—, el archivo
// se descartaba sin decir nada y la guía quedaba sin respaldo: el usuario creía
// haberlo adjuntado. Se filtra aquí, con el motivo a la vista.
const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_FOTO = 5 * 1024 * 1024;
const revisarFotos = (lista) => {
  const buenas = [], malas = [];
  for (const f of lista) {
    if (!TIPOS_FOTO.includes(f.type)) malas.push(`«${f.name}» no es un formato válido (JPG, PNG, WebP o PDF)`);
    else if (f.size > MAX_FOTO) malas.push(`«${f.name}» pesa ${(f.size / 1024 / 1024).toFixed(1)} MB y el máximo son 5 MB`);
    else buenas.push(f);
  }
  return { buenas, malas };
};

// Respaldos que pide el proceso al despachar. El nombre del campo viaja al
// servidor y define cómo queda etiquetada cada foto en la guía.
const EVIDENCIA = [
  ['guia', 'Foto de la guía de despacho', 'El documento que viaja con el camión. Es el respaldo que permite cruzar esta guía con la documentación de MEL.'],
  ['bascula', 'Foto del ticket de báscula', 'El pesaje impreso de la romana en el patio, que respalda los kilos declarados.'],
  ['carga', 'Foto de la carga', 'Estado del material sobre el camión al salir del patio (opcional).'],
];

export default function Despachos() {
  const [rows, setRows] = useState(null);
  const [traslados, setTraslados] = useState([]);
  const [maestros, setMaestros] = useState(null);
  // El panel enlaza a la pestaña y al filtro exactos (?t=d2, ?f=observado).
  const [params, setParams] = useSearchParams();
  const tab = params.get('t') ?? 'd1';
  const filtro = params.get('f') ?? 'todas';
  const setTab = (t) => setParams(t === 'd1' ? {} : { t }, { replace: true });
  const setFiltro = (f) => setParams(f === 'todas' ? { t: 'd1' } : { t: 'd1', f }, { replace: true });
  const [nuevo, setNuevo] = useState(false);
  const [recep, setRecep] = useState(null);
  const [resolver, setResolver] = useState(null);
  const [nuevoTras, setNuevoTras] = useState(false);
  const [recepTras, setRecepTras] = useState(null);
  const hoyISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  // Patio y categoría por defecto: se fijan cuando llegan los maestros, no
  // a mano. Un id fijo hace que el formulario envíe una categoría que puede
  // ya no existir, y la base lo rechaza con un error que nadie entiende.
  const [porDefecto, setPorDefecto] = useState({ patio_id: null, categoria_id: null });
  const formVacio = () => ({
    ...porDefecto, kg_origen: '', unidad: unidadGuardada(),
    tara_origen: '', unidad_tara: unidadGuardada(),
    guia_mel: '', fecha: hoyISO(), ev: {},
    transportista: '', transportista_rut: '', patente_tracto: '', patente_rampla: '',
  });
  const recepVacia = () => ({
    kg_destino: '', unidad: unidadGuardada(), categoria_final_id: '', observacion: '', foto: [],
    ticket_numero: '', vale_numero: '', tara: '', unidad_tara: unidadGuardada(), con_madera: false,
    descuentos: [], nuevoDesc: { tipo: 'kg', valor: '', glosa: '' },
  });
  const [form, setForm] = useState(formVacio);
  const [detalle, setDetalle] = useState(null);
  const [evidencia, setEvidencia] = useState(null);   // urls firmadas del detalle abierto
  const [anular, setAnular] = useState(null);         // guía que se está anulando
  const [aForm, setAForm] = useState({ motivo: '', reemplazar: false });
  // Descuento que se agrega desde el detalle de una guía ya recepcionada.
  const [dForm, setDForm] = useState({ tipo: 'kg', valor: '', glosa: '' });
  const [rForm, setRForm] = useState(recepVacia);
  const [tForm, setTForm] = useState({ categoria_id: null, kg: '', unidad: unidadGuardada() });
  const [lampa, setLampa] = useState({ valor: '', unidad: 'kg' });
  const [cdfFile, setCdfFile] = useState([]);        // documento(s) del CDF a adjuntar
  const [verCdf, setVerCdf] = useState(null);        // { traslado, archivos } del CDF abierto
  const [adjCdf, setAdjCdf] = useState(null);        // traslado al que se le adjunta el CDF despues
  const [editar, setEditar] = useState(null);        // guía en edición de datos
  const [eForm, setEForm] = useState(null);
  const [obs, setObs] = useState('');
  const { user } = useAuth();
  const toast = useToast();

  const load = () => {
    api('/despachos').then(setRows).catch((e) => toast(e.message, true));
    api('/traslados').then(setTraslados).catch(() => {});
  };
  useEffect(() => {
    load();
    api('/maestros').then((m) => {
      setMaestros(m);
      const d = { patio_id: m.patios?.[0]?.id ?? null, categoria_id: m.categorias?.[0]?.id ?? null };
      setPorDefecto(d);
      setForm((f) => ({ ...f, patio_id: f.patio_id ?? d.patio_id, categoria_id: f.categoria_id ?? d.categoria_id }));
      setTForm((t) => ({ ...t, categoria_id: t.categoria_id ?? d.categoria_id }));
    }).catch(() => {});
  }, []);
  if (!rows) return <div className="loading">Cargando despachos…</div>;

  // La interfaz no ofrece lo que el servidor todavía no puede guardar.
  const fn = maestros?.funciones ?? {};
  const puedeCrear = ['limpieza', 'ito', 'coordinador'].includes(user.role);
  const puedeRecep = ['vendor', 'ito', 'coordinador'].includes(user.role);
  const puedeTras = ['vendor', 'coordinador'].includes(user.role);
  const puedeRecepTras = ['vendor', 'coordinador', 'lampa'].includes(user.role);
  const puedeResolver = ['ito', 'coordinador'].includes(user.role);
  const puedeEditar = ['limpieza', 'ito', 'coordinador'].includes(user.role);
  const puedeAnular = ['limpieza', 'ito', 'coordinador'].includes(user.role);

  const post = (path, body, okMsg, cierra) => async () => {
    try {
      await api(path, { method: 'POST', body });
      toast(okMsg);
      cierra();
      load();
    } catch (e) { toast(e.message, true); }
  };

  async function crearDespacho() {
    const kg = aKg(form.kg_origen, form.unidad);
    if (!kg) return toast('Ingrese el peso registrado en la báscula', true);
    if (!form.patio_id || !form.categoria_id) return toast('Elija patio y categoría de material', true);
    try {
      const fd = new FormData();
      fd.append('patio_id', form.patio_id);
      fd.append('categoria_id', form.categoria_id);
      fd.append('kg_origen', kg);
      const taraOrigen = aKg(form.tara_origen, form.unidad_tara);
      if (taraOrigen) fd.append('tara_origen_kg', taraOrigen);
      fd.append('guia_mel', form.guia_mel.trim());
      fd.append('fecha', form.fecha);
      for (const k of ['transportista', 'transportista_rut', 'patente_tracto', 'patente_rampla']) {
        if (form[k]?.trim()) fd.append(k, form[k].trim());
      }
      let n = 0;
      for (const [tipo, archivos] of Object.entries(form.ev)) {
        for (const f of archivos) { fd.append(tipo, f); n++; }
      }
      const d = await api('/despachos', { method: 'POST', body: fd });
      toast(`Despacho ${d.guia} registrado con ${n} respaldo(s) adjunto(s)`);
      setNuevo(false);
      setForm(formVacio());
      load();
    } catch (e) { toast(e.message, true); }
  }

  // La recepción viaja como formulario para poder adjuntar el ticket de báscula.
  async function recepcionar() {
    const kg = aKg(rForm.kg_destino, rForm.unidad);
    if (!kg) return toast('Ingrese el peso pesado en la báscula de La Negra', true);
    try {
      const fd = new FormData();
      fd.append('kg_destino', kg);
      if (rForm.categoria_final_id) fd.append('categoria_final_id', rForm.categoria_final_id);
      if (rForm.observacion) fd.append('observacion', rForm.observacion);
      if (rForm.ticket_numero.trim()) fd.append('ticket_numero', rForm.ticket_numero.trim());
      if (rForm.vale_numero.trim()) fd.append('vale_numero', rForm.vale_numero.trim());
      const tara = aKg(rForm.tara, rForm.unidad_tara);
      if (tara) fd.append('tara_kg', tara);
      if (fn.tm) fd.append('con_madera', rForm.con_madera ? 'true' : 'false');
      if (rForm.descuentos.length) fd.append('descuentos', JSON.stringify(rForm.descuentos));
      for (const f of rForm.foto ?? []) fd.append('recepcion', f);
      const d = await api(`/despachos/${recep.id}/recepcionar`, { method: 'POST', body: fd });
      toast(d.estado === 'observado'
        ? `Recepción registrada con diferencia de ${d.dif_pct}%: queda observada para el ITO`
        : 'Recepción registrada dentro de la tolerancia');
      setRecep(null);
      load();
    } catch (e) { toast(e.message, true); }
  }

  // Recepción en Lampa: viaja como formulario para poder adjuntar el documento
  // del certificado de disposición final.
  async function recepcionarLampa() {
    const kg = aKg(lampa.valor, lampa.unidad);
    if (!kg) return toast('Ingrese el peso validado en báscula de Lampa', true);
    try {
      const fd = new FormData();
      fd.append('kg_lampa', kg);
      for (const f of cdfFile ?? []) fd.append('cdf', f);
      await api(`/traslados/${recepTras.id}/recepcionar`, { method: 'POST', body: fd });
      toast('Recepción en Lampa registrada; certificado emitido');
      setRecepTras(null);
      setCdfFile([]);
      load();
    } catch (e) { toast(e.message, true); }
  }

  // El certificado firmado suele llegar despues de recibir el material, asi que
  // se puede adjuntar en cualquier momento tras la recepcion.
  async function adjuntarCdf() {
    if (!cdfFile.length) return toast('Adjunte el documento del certificado', true);
    try {
      const fd = new FormData();
      for (const f of cdfFile) fd.append('cdf', f);
      const r = await api(`/traslados/${adjCdf.id}/cdf`, { method: 'POST', body: fd });
      toast(`${r.adjuntados} documento(s) adjuntado(s) al certificado ${adjCdf.cert_folio}`);
      setAdjCdf(null); setCdfFile([]); load();
    } catch (e) { toast(e.message, true); }
  }

  // Abre el/los documento(s) del CDF de un traslado.
  async function abrirCdf(t) {
    try {
      const r = await api(`/traslados/${t.id}/cdf`);
      if (!r.archivos?.length) return toast('Este certificado no tiene documento adjunto', true);
      setVerCdf({ traslado: t, archivos: r.archivos });
    } catch (e) { toast(e.message, true); }
  }

  // Corrección de datos de una guía que aún no entró a un estado de pago.
  function abrirEditar(d) {
    setEditar(d);
    setEForm({
      guia_mel: d.guia_mel ?? '', fecha: d.fecha ?? '',
      patio_id: maestros?.patios.find((p) => p.codigo === d.patio)?.id ?? '',
      categoria_id: maestros?.categorias.find((c) => c.nombre === d.categoria)?.id ?? '',
      kg_origen: String(d.kg_origen ?? ''), unidad: 'kg',
      tara_origen: d.tara_origen_kg != null ? String(d.tara_origen_kg) : '', unidad_tara: 'kg',
      transportista: d.transportista ?? '', transportista_rut: d.transportista_rut ?? '',
      patente_tracto: d.patente_tracto ?? '', patente_rampla: d.patente_rampla ?? '',
    });
  }

  async function guardarEdicion() {
    const kg = aKg(eForm.kg_origen, eForm.unidad);
    if (!kg) return toast('El peso de origen debe ser mayor que cero', true);
    try {
      const body = {
        guia_mel: eForm.guia_mel.trim(), fecha: eForm.fecha,
        patio_id: eForm.patio_id, categoria_id: eForm.categoria_id, kg_origen: kg,
        tara_origen_kg: aKg(eForm.tara_origen, eForm.unidad_tara) || '',
        transportista: eForm.transportista.trim(), transportista_rut: eForm.transportista_rut.trim(),
        patente_tracto: eForm.patente_tracto.trim(), patente_rampla: eForm.patente_rampla.trim(),
      };
      await api(`/despachos/${editar.id}`, { method: 'PATCH', body });
      toast(`Guía ${editar.guia} corregida`);
      setEditar(null); setEForm(null);
      load();
    } catch (e) { toast(e.message, true); }
  }

  // Descuentos que se van armando dentro del modal de recepción, antes de guardar.
  function agregarDesc() {
    const d = rForm.nuevoDesc;
    if (!(Number(d.valor) > 0) || !d.glosa.trim()) return toast('Indique monto y glosa del descuento', true);
    if (d.tipo === 'pct' && Number(d.valor) > 100) return toast('El porcentaje no puede superar el 100%', true);
    if (d.tipo === 'clp' && !Number.isInteger(Number(d.valor))) return toast('El descuento en pesos debe ser un monto entero', true);
    setRForm({
      ...rForm,
      descuentos: [...rForm.descuentos, { tipo: d.tipo, valor: Number(d.valor), glosa: d.glosa.trim() }],
      nuevoDesc: { tipo: 'kg', valor: '', glosa: '' },
    });
  }

  // Descuento aplicado sobre una guía que ya está recepcionada. El servidor
  // revaloriza y devuelve la guía completa, así que el detalle se refresca solo.
  async function agregarDescGuia() {
    if (!(Number(dForm.valor) > 0) || !dForm.glosa.trim()) return toast('Indique monto y glosa del descuento', true);
    if (dForm.tipo === 'pct' && Number(dForm.valor) > 100) return toast('El porcentaje no puede superar el 100%', true);
    if (dForm.tipo === 'clp' && !Number.isInteger(Number(dForm.valor))) return toast('El descuento en pesos debe ser un monto entero', true);
    try {
      const r = await api(`/despachos/${detalle.id}/descuentos`, { method: 'POST', body: {
        tipo: dForm.tipo, valor: Number(dForm.valor), glosa: dForm.glosa.trim() } });
      setDetalle(r);
      setDForm({ tipo: 'kg', valor: '', glosa: '' });
      toast('Descuento aplicado · la guía quedó revalorizada');
      load();
    } catch (e) { toast(e.message, true); }
  }

  async function anularGuia() {
    if (!aForm.motivo.trim()) return toast('El motivo de la anulación es obligatorio', true);
    try {
      const r = await api(`/despachos/${anular.id}/anular`, {
        method: 'POST', body: { motivo: aForm.motivo.trim(), reemplazar: aForm.reemplazar },
      });
      toast(r.reemplazo
        ? `${anular.guia} anulada y reemplazada por ${r.reemplazo.guia}`
        : `${anular.guia} anulada`);
      setAnular(null); setAForm({ motivo: '', reemplazar: false });
      load();
    } catch (e) { toast(e.message, true); }
  }

  function abrirDetalle(d) {
    setDetalle(d);
    setEvidencia(null);
    if (d.fotos > 0) {
      api(`/despachos/${d.id}/evidencia`).then((r) => setEvidencia(r.archivos)).catch(() => setEvidencia([]));
    } else {
      setEvidencia([]);
    }
  }

  const enTransito = rows.filter((d) => d.estado === 'en_transito').length;
  const observados = rows.filter((d) => d.estado === 'observado').length;
  const trasTransito = traslados.filter((t) => t.estado === 'en_transito').length;
  const certificados = traslados.filter((t) => t.cert_folio);

  return (
    <div>
      <PageHead title="Despachos y recepciones"
        sub="La cadena completa del material: pesaje en patio MEL, recepción y clasificación en La Negra, traslado a Lampa y certificado de disposición final.">
        {puedeCrear && <button className="btn primary" onClick={() => setNuevo(true)}>+ Registrar despacho</button>}
        {puedeTras && <button className="btn" onClick={() => setNuevoTras(true)}>+ Traslado a Lampa</button>}
      </PageHead>

      {(() => {
        const mesActual = new Date().toISOString().slice(0, 7);
        const dMes = rows.filter((d) => d.fecha?.startsWith(mesActual));
        const tMes = traslados.filter((t) => t.fecha?.startsWith(mesActual));
        return (
          <div className="flow-mini" aria-label="Resumen del flujo del mes">
            <span className="fm"><span className="k">Patios · mes</span><span className="v display">{fmtKg(dMes.reduce((a, d) => a + d.kg_origen, 0))} <small>kg</small></span></span>
            <span className="fm-sep">→</span>
            <span className="fm"><span className="k">La Negra</span><span className="v display">{fmtKg(dMes.reduce((a, d) => a + (d.kg_destino ?? 0), 0))} <small>kg</small></span></span>
            <span className="fm-sep">→</span>
            <span className="fm"><span className="k">Lampa</span><span className="v display">{fmtKg(tMes.reduce((a, t) => a + (t.kg_lampa ?? 0), 0))} <small>kg</small></span></span>
            <span className="fm" style={{ marginLeft: 'auto' }}><span className="k">Certificados</span><span className="v display">{tMes.filter((t) => t.cert_folio).length}</span></span>
          </div>
        );
      })()}

      <Tabs active={tab} onChange={setTab} tabs={[
        ['d1', 'Guías de despacho', enTransito + observados],
        ['d2', 'Recepción en La Negra', enTransito],
        ['d3', 'La Negra → Lampa', trasTransito],
        ['d4', 'Certificados disposición final'],
      ]} />

      {tab === 'd1' && (() => {
        const anuladas = rows.filter((d) => d.estado === 'anulado').length;
        const FILTROS = [
          ['todas', 'Todas', rows.length],
          ['en_transito', 'En tránsito', enTransito],
          ['observado', 'Con diferencia', observados],
          ['recepcionado', 'Recepcionadas', rows.filter((d) => d.estado === 'recepcionado').length],
          ...(anuladas ? [['anulado', 'Anuladas', anuladas]] : []),
        ];
        const visibles = filtro === 'todas' ? rows : rows.filter((d) => d.estado === filtro);
        return (
        <div className="card">
          <div className="card-h">
            <div className="filtros">
              {FILTROS.map(([id, label, n]) => (
                <button key={id} className={`fchip ${filtro === id ? 'on' : ''}`} onClick={() => setFiltro(id)}>
                  {label} <i>{n}</i>
                </button>
              ))}
            </div>
            <small>{visibles.length} de {rows.length} guía(s)</small>
          </div>
          <div className="tbl-wrap"><table>
          <thead><tr><th>Código interno</th><th>Fecha</th><th>Patio</th><th>Categoría</th><th className="num">Kg MEL</th><th className="num">Kg La Negra</th><th className="num">Valorización</th><th>Respaldos</th><th>Estado</th><th>EP</th><th className="acc"></th></tr></thead>
          <tbody>
            {visibles.map((d) => (
              <tr key={d.id} className={d.estado === 'anulado' ? 'anulada' : undefined}>
                <td>
                  <span className="mono">{d.guia}</span>
                  {d.guia_mel && <><br /><small style={{ color: 'var(--muted)' }}>MEL N° {d.guia_mel}</small></>}
                </td>
                <td className="mono">{d.fecha}</td><td>{d.patio}</td>
                <td>{d.categoria}{d.categoria_final && <span style={{ color: 'var(--warn-tx)' }}> → {d.categoria_final}</span>}</td>
                <td className="num">{fmtKg(d.kg_origen)}</td>
                <td className="num">{d.kg_destino != null ? fmtKg(d.kg_destino) : '—'}</td>
                <td className="num">
                  {fmtCLP(d.valor)}
                  {d.descuentos?.length > 0 && (
                    <><br /><small style={{ color: 'var(--bad-tx)' }}>{d.descuentos.length} descuento(s)</small></>
                  )}
                </td>
                <td title={d.fotos ? `${d.fotos} respaldo(s) adjunto(s)` : 'Sin respaldos'}>
                  {d.fotos
                    ? <div className="thumbs">{Array.from({ length: Math.min(d.fotos, 3) }).map((_, i) => <i key={i} />)}</div>
                    : <span style={{ color: 'var(--muted)' }}>—</span>}
                </td>
                <td><Chip tone={CHIP[d.estado][0]}>{CHIP[d.estado][1]}</Chip></td>
                <td className="mono">{d.ep_folio || '—'}</td>
                <td className="num acc" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn sm" onClick={() => abrirDetalle(d)}>Detalle</button>{' '}
                  {d.estado === 'en_transito' && puedeRecep && (
                    <button className="btn sm primary" onClick={() => {
                      setRecep(d);
                      // El peso parte VACÍO: la recepción es una declaración
                      // independiente, no la confirmación de lo que dijo MEL.
                      setRForm(recepVacia());
                    }}>Recepcionar</button>
                  )}
                  {d.estado === 'observado' && puedeResolver && (
                    <button className="btn sm" onClick={() => { setResolver(d); setObs(''); }}>Resolver</button>
                  )}{' '}
                  {/* Corrección de datos de digitación, mientras la guía no esté en un EP. */}
                  {puedeEditar && d.estado !== 'anulado' && !d.ep_folio && (
                    <button className="btn sm" onClick={() => abrirEditar(d)}>Editar</button>
                  )}{' '}
                  {/* Una guía no se borra: se anula con motivo y queda en el libro. */}
                  {fn.anulacion && d.estado !== 'anulado' && !d.ep_folio && puedeAnular && (
                    <button className="btn sm danger" onClick={() => { setAnular(d); setAForm({ motivo: '', reemplazar: false }); }}>Anular</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
          {visibles.length === 0 && (
            <Empty title={filtro === 'todas' ? 'Sin despachos registrados' : 'Nada con ese filtro'}>
              {filtro === 'todas'
                ? 'El primer despacho desde patios MEL aparecerá aquí con su guía foliada.'
                : 'Ninguna guía está en ese estado ahora mismo.'}
            </Empty>
          )}
        </div>
        );
      })()}

      {tab === 'd2' && (() => {
        const porValidar = rows.filter((d) => d.estado === 'en_transito');
        const validadas = rows.filter((d) => d.kg_destino != null);
        return (
          <>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-h">
                <h3>Guías por validar</h3>
                <small>{porValidar.length ? `${porValidar.length} camión(es) por pesar en La Negra` : 'nada pendiente'}</small>
              </div>
              {porValidar.length === 0 ? (
                <Empty title="No hay guías esperando recepción">
                  Cuando MEL despache material, cada guía aparecerá aquí para que registre el peso de su báscula.
                </Empty>
              ) : (
                <div className="tbl-wrap"><table>
                  <thead><tr><th>Código interno</th><th>Fecha</th><th>Patio</th><th>Categoría</th><th className="num">Kg declarados por MEL</th><th className="num acc">Pesaje</th></tr></thead>
                  <tbody>
                    {porValidar.map((d) => (
                      <tr key={d.id}>
                        <td>
                          <span className="mono">{d.guia}</span>
                          {d.guia_mel && <><br /><small style={{ color: 'var(--muted)' }}>MEL N° {d.guia_mel}</small></>}
                        </td>
                        <td className="mono">{d.fecha}</td>
                        <td>{d.patio}</td>
                        <td>{d.categoria}</td>
                        <td className="num">{fmtKg(d.kg_origen)}</td>
                        <td className="num acc">
                          {puedeRecep ? (
                            <button className="btn sm primary" onClick={() => {
                              setRecep(d);
                              setRForm(recepVacia());
                            }}>Registrar pesaje</button>
                          ) : <Chip tone="info">En tránsito</Chip>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </div>

            <div className="card">
              <div className="card-h"><h3>Recepciones validadas</h3><small>registro de los pesajes ya declarados</small></div>
              <div className="tbl-wrap"><table>
                <thead><tr><th>Código interno</th><th>Recepción</th><th className="num">Kg MEL</th><th className="num">Kg La Negra</th><th className="num">Diferencia</th><th>Clasificación</th><th>Validación</th><th>Observación</th></tr></thead>
                <tbody>
                  {validadas.map((d) => (
                    <tr key={d.id}>
                      <td className="mono">{d.guia}</td>
                      <td>{d.recepcionado_el}</td>
                      <td className="num">{fmtKg(d.kg_origen)}</td>
                      <td className="num">{fmtKg(d.kg_destino)}</td>
                      <td className="num" style={Math.abs(d.dif_pct) > 2 ? { color: 'var(--bad-tx)', fontWeight: 700 } : {}}>{d.dif_pct?.toFixed(2)} %</td>
                      <td>{d.categoria_final ? <Chip tone="warn">Reclasificado · {d.categoria_final}</Chip> : d.categoria}</td>
                      <td><Chip tone={d.estado === 'observado' ? 'warn' : 'ok'}>{d.estado === 'observado' ? 'Observada' : 'Validada'}</Chip></td>
                      <td style={{ color: 'var(--ink-2)', maxWidth: 240 }}>{d.obs_recepcion || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              {validadas.length === 0 && <Empty title="Sin recepciones">Los pesajes validados en La Negra aparecerán aquí con su diferencia.</Empty>}
            </div>
          </>
        );
      })()}

      {tab === 'd3' && (
        <div className="card"><div className="tbl-wrap"><table>
          <thead><tr><th>Guía traslado</th><th>Fecha</th><th>Categoría</th><th className="num">Kg despachados</th><th className="num">Kg Lampa</th><th>Estado</th><th>Certificado</th><th></th></tr></thead>
          <tbody>
            {traslados.map((t) => (
              <tr key={t.id}>
                <td className="mono">{t.guia}</td><td className="mono">{t.fecha}</td><td>{t.categoria}</td>
                <td className="num">{fmtKg(t.kg)}</td>
                <td className="num">{t.kg_lampa != null ? fmtKg(t.kg_lampa) : '—'}</td>
                <td><Chip tone={t.estado === 'recepcionado' ? 'ok' : 'info'}>{t.estado === 'recepcionado' ? 'Recepcionado' : 'En tránsito'}</Chip></td>
                <td className="mono">{t.cert_folio || '—'}</td>
                <td className="num">
                  {t.estado === 'en_transito' && puedeRecepTras && (
                    <button className="btn sm primary" onClick={() => { setRecepTras(t); setLampa({ valor: '', unidad: unidadGuardada() }); setCdfFile([]); }}>Recepcionar en Lampa</button>
                  )}
                  {t.estado === 'recepcionado' && t.cert_fotos > 0 && (
                    <button className="btn sm" onClick={() => abrirCdf(t)}>Ver CDF</button>
                  )}{' '}
                  {t.estado === 'recepcionado' && puedeRecepTras && (
                    <button className="btn sm" onClick={() => { setAdjCdf(t); setCdfFile([]); }}
                      title="Adjuntar el documento firmado del certificado">
                      {t.cert_fotos > 0 ? 'Agregar documento' : 'Adjuntar CDF'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
          {traslados.length === 0 && <Empty title="Sin traslados a Lampa">El vendor consolida el material en La Negra y lo re-despacha a Lampa con guía GT.</Empty>}
        </div>
      )}

      {tab === 'd4' && (
        <div className="card"><div className="tbl-wrap"><table>
          <thead><tr><th>Certificado</th><th>Guía traslado</th><th>Categoría</th><th className="num">Kg certificados</th><th>Emisión</th><th>Documento</th></tr></thead>
          <tbody>
            {certificados.map((t) => (
              <tr key={t.id}>
                <td className="mono">{t.cert_folio}</td>
                <td className="mono">{t.guia}</td>
                <td>{t.categoria}</td>
                <td className="num">{fmtKg(t.kg_lampa)}</td>
                <td>{t.recepcionado_el}</td>
                <td>{t.cert_fotos > 0
                  ? <button className="btn sm" onClick={() => abrirCdf(t)}>Ver documento</button>
                  : puedeRecepTras
                    ? <button className="btn sm primary" onClick={() => { setAdjCdf(t); setCdfFile([]); }}>Adjuntar documento</button>
                    : <span style={{ color: 'var(--muted)' }}>Sin adjunto</span>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
          {certificados.length === 0 && <Empty title="Sin certificados emitidos">Cada recepción en Lampa emite automáticamente su certificado de disposición final foliado.</Empty>}
        </div>
      )}

      {/* ---- modales ---- */}
      <Modal open={!!detalle} title={detalle && `Código interno ${detalle.guia}`} onClose={() => setDetalle(null)}
        footer={<button className="btn" onClick={() => setDetalle(null)}>Cerrar</button>}>
        {detalle && (
          <>
            <div className="grid g2" style={{ gap: 10, marginBottom: 4 }}>
              <div><small style={{ color: 'var(--muted)' }}>Guía de despacho MEL</small><br />
                <b className="mono">{detalle.guia_mel ? `N° ${detalle.guia_mel}` : 'sin número registrado'}</b></div>
              <div><small style={{ color: 'var(--muted)' }}>Fecha del despacho</small><br /><b className="mono">{detalle.fecha}</b></div>
              <div><small style={{ color: 'var(--muted)' }}>Patio de origen</small><br /><b>{detalle.patio} · {detalle.patio_nombre}</b></div>
              <div><small style={{ color: 'var(--muted)' }}>Categoría</small><br />
                <b>{detalle.categoria}</b>{detalle.categoria_final && <span style={{ color: 'var(--warn-tx)' }}> → {detalle.categoria_final}</span>}</div>
              <div><small style={{ color: 'var(--muted)' }}>Pesaje MEL</small><br /><b>{fmtKg(detalle.kg_origen)} kg</b>
                {detalle.tara_origen_kg != null && <><br /><small style={{ color: 'var(--muted)' }}>Tara {fmtKg(detalle.tara_origen_kg)} · bruto {fmtKg(detalle.bruto_origen_kg)} kg</small></>}</div>
              <div><small style={{ color: 'var(--muted)' }}>Pesaje La Negra</small><br />
                <b>{detalle.kg_destino != null ? `${fmtKg(detalle.kg_destino)} kg` : 'pendiente'}</b>
                {detalle.dif_pct != null && <span style={{ color: Math.abs(detalle.dif_pct) > 2 ? 'var(--bad-tx)' : 'var(--muted)', fontSize: 12 }}> ({detalle.dif_pct.toFixed(2)}%)</span>}</div>
              <div><small style={{ color: 'var(--muted)' }}>Precio congelado</small><br />
                <b>{detalle.precio_usd_tm != null ? `USD ${detalle.precio_usd_tm}/TM`
                  : detalle.precio_usd != null ? `USD ${detalle.precio_usd}/kg`
                  : detalle.precio_kg != null ? `$ ${detalle.precio_kg}/kg` : '—'}</b>
                {detalle.con_madera != null && (
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {' '}· {detalle.con_madera ? 'con madera (alt. B)' : 'sin madera (alt. A)'}</span>
                )}
                {detalle.dolar != null && <span style={{ color: 'var(--muted)', fontSize: 12 }}> · dólar $ {detalle.dolar}</span>}</div>
              <div><small style={{ color: 'var(--muted)' }}>Valorización</small><br /><b>{fmtCLP(detalle.valor)}</b>
                {detalle.valor_usd != null && <span style={{ color: 'var(--muted)', fontSize: 12 }}> · USD {detalle.valor_usd}</span>}</div>
            </div>

            {(detalle.transportista || detalle.patente_tracto) && (
              <>
                <div className="ev-tit">Transporte</div>
                <div className="grid g2" style={{ gap: 10, marginBottom: 4 }}>
                  <div><small style={{ color: 'var(--muted)' }}>Transportista</small><br /><b>{detalle.transportista || '—'}</b></div>
                  <div><small style={{ color: 'var(--muted)' }}>RUT</small><br /><b className="mono">{detalle.transportista_rut || '—'}</b></div>
                  <div><small style={{ color: 'var(--muted)' }}>Patente tracto</small><br /><b className="mono">{detalle.patente_tracto || '—'}</b></div>
                  <div><small style={{ color: 'var(--muted)' }}>Patente rampla / batea</small><br /><b className="mono">{detalle.patente_rampla || '—'}</b></div>
                </div>
              </>
            )}

            {(detalle.ticket_numero || detalle.vale_numero || detalle.tara_kg != null) && (
              <>
                <div className="ev-tit">Pesaje en La Negra</div>
                <div className="grid g2" style={{ gap: 10, marginBottom: 4 }}>
                  <div><small style={{ color: 'var(--muted)' }}>N° de ticket</small><br /><b className="mono">{detalle.ticket_numero || '—'}</b></div>
                  <div><small style={{ color: 'var(--muted)' }}>N° de vale</small><br /><b className="mono">{detalle.vale_numero || '—'}</b></div>
                  <div><small style={{ color: 'var(--muted)' }}>Tara (camión vacío)</small><br />
                    <b>{detalle.tara_kg != null ? `${fmtKg(detalle.tara_kg)} kg` : '—'}</b></div>
                  <div><small style={{ color: 'var(--muted)' }}>Bruto del ticket</small><br />
                    <b>{detalle.bruto_kg != null ? `${fmtKg(detalle.bruto_kg)} kg` : '—'}</b></div>
                </div>
              </>
            )}

            {/* La sección va siempre, aunque no haya descuentos: si solo
                apareciera cuando ya existe alguno, no habría dónde agregar el
                primero y la función sería invisible. Cuando no se puede, dice
                por qué. */}
            {fn.desc_item && detalle.estado !== 'anulado' && (() => {
              const recibida = ['recepcionado', 'observado'].includes(detalle.estado);
              const abierta = recibida && !detalle.ep_folio && puedeRecep;
              return (
                <>
                  <div className="ev-tit">Descuentos de la carga <small>humedad, material ajeno, mermas</small></div>
                  {detalle.descuentos?.length > 0 ? detalle.descuentos.map((d) => (
                    <div className="pend" key={d.id}>
                      <Chip tone="bad">{descTexto(d)}</Chip>
                      <span>{d.glosa} <small style={{ color: 'var(--muted)' }}>· {d.creado_por}</small></span>
                      {puedeResolver && abierta && (
                        <button className="btn sm danger go" onClick={async () => {
                          try {
                            const r = await api(`/despachos/${detalle.id}/descuentos/${d.id}`, { method: 'DELETE' });
                            toast('Descuento eliminado · la guía quedó revalorizada');
                            setDetalle(r); load();
                          } catch (e) { toast(e.message, true); }
                        }}>Quitar</button>
                      )}
                    </div>
                  )) : (
                    <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 8 }}>
                      Esta guía no tiene descuentos aplicados.
                    </div>
                  )}

                  {abierta ? (
                    <>
                      <div className="desc-nuevo">
                        <Select value={dForm.tipo} onChange={(e) => setDForm({ ...dForm, tipo: e.target.value })}>
                          {TIPO_DESC.map(([id, label, u]) => <option key={id} value={id}>{label} ({u})</option>)}
                        </Select>
                        <input type="number" min="0" step={dForm.tipo === 'clp' ? '1' : '0.01'} placeholder="0"
                          value={dForm.valor} onChange={(e) => setDForm({ ...dForm, valor: e.target.value })} />
                        <input placeholder="Motivo del descuento" value={dForm.glosa}
                          onChange={(e) => setDForm({ ...dForm, glosa: e.target.value })} />
                        <button className="btn sm" onClick={agregarDescGuia}>Agregar</button>
                      </div>
                      <small style={{ color: 'var(--muted)', display: 'block', marginBottom: 14 }}>
                        {TIPO_DESC.find(([t]) => t === dForm.tipo)?.[3]} La guía se revaloriza al instante.
                      </small>
                    </>
                  ) : (
                    <div className="audit-note">
                      {!recibida
                        ? <>Los descuentos se aplican <b>al recepcionar en La Negra</b>, o desde aquí una vez
                          recibida la carga. Esta guía todavía va en tránsito.</>
                        : detalle.ep_folio
                        ? <>La guía ya está en el estado de pago <b className="mono">{detalle.ep_folio}</b>: sus
                          descuentos quedaron congelados con él. Sáquela de ese EP para modificarlos.</>
                        : <>Solo La Negra, el ITO o el Coordinador pueden aplicar descuentos.</>}
                    </div>
                  )}
                </>
              );
            })()}

            {detalle.estado === 'anulado' && (
              <div className="aviso bad">
                <b>Guía anulada</b>
                <p>{detalle.motivo_anulacion} — {detalle.anulada_por}, {detalle.anulada_el}.
                {detalle.reemplazada_por && <> Fue reemplazada por otra guía del libro.</>}</p>
              </div>
            )}
            {detalle.obs_recepcion && <div className="audit-note">Observación: {detalle.obs_recepcion}</div>}
            <div className="ev-tit">Respaldos de la guía</div>
            {evidencia == null && <div className="loading" style={{ padding: '18px 0' }}>Cargando respaldos…</div>}
            {evidencia?.length === 0 && (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>Esta guía no tiene respaldos adjuntos.</div>
            )}
            {evidencia?.length > 0 && Object.entries(
              evidencia.reduce((acc, a) => { (acc[a.etiqueta] ??= []).push(a.url); return acc; }, {})
            ).map(([etiqueta, urls]) => (
              <div key={etiqueta} style={{ marginBottom: 12 }}>
                <small style={{ display: 'block', color: 'var(--ink-2)', fontWeight: 600, marginBottom: 6 }}>{etiqueta}</small>
                {/* contain, no cover: son documentos y deben verse completos */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 8 }}>
                  {urls.map((u) => (
                    <a key={u} href={u} target="_blank" rel="noreferrer" title="Abrir en tamaño completo">
                      {/\.pdf(\?|$)/i.test(u) ? (
                        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', height: 130, background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--line)', color: 'var(--ink-2)', fontSize: 13, fontWeight: 600 }}>
                          <span style={{ fontSize: 26 }}>📄</span>Ver PDF
                        </span>
                      ) : (
                        <img src={u} alt={etiqueta}
                          style={{ width: '100%', height: 130, objectFit: 'contain', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--line)' }} />
                      )}
                    </a>
                  ))}
                </div>
              </div>
            ))}
            {detalle.ep_folio && <div className="audit-note">Incluido en el estado de pago <b>&nbsp;{detalle.ep_folio}</b></div>}
          </>
        )}
      </Modal>

      <Modal open={nuevo} title="Registrar despacho MEL → La Negra" onClose={() => setNuevo(false)}
        footer={<>
          <button className="btn" onClick={() => setNuevo(false)}>Cancelar</button>
          <button className="btn primary" onClick={crearDespacho}>Registrar despacho</button>
        </>}>
        <div className="grid g2" style={{ gap: 0, columnGap: 14 }}>
          <Field label="N° de guía de despacho MEL"
            hint="El número del documento en papel. Se digita: la plataforma no lo lee de la foto.">
            <input value={form.guia_mel} onChange={(e) => setForm({ ...form, guia_mel: e.target.value })} placeholder="458921" />
          </Field>
          <Field label="Fecha del despacho" hint="Se propone hoy; corríjala si la guía es de otro día.">
            <DateField value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
          </Field>
        </div>
        <Field label="Patio de origen">
          <Select value={form.patio_id ?? ''} onChange={(e) => setForm({ ...form, patio_id: +e.target.value })}>
            {maestros?.patios.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>)}
          </Select>
        </Field>
        <Field label="Categoría de material">
          <Select value={form.categoria_id ?? ''} onChange={(e) => setForm({ ...form, categoria_id: +e.target.value })}>
            {maestros?.categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}{precioRef(c)}</option>)}
          </Select>
        </Field>
        <CampoPeso label="Peso en báscula MEL" valor={form.kg_origen} unidad={form.unidad}
          onValor={(v) => setForm({ ...form, kg_origen: v })}
          onUnidad={(u) => setForm({ ...form, unidad: u })} />
        {fn.tara_origen && (
          <CampoPeso label="Tara · peso del camión vacío (opcional)"
            hint={(() => {
              const neto = aKg(form.kg_origen, form.unidad);
              const tara = aKg(form.tara_origen, form.unidad_tara);
              return neto && tara
                ? `Bruto en origen: ${fmtKg(neto + tara)} kg (neto ${fmtKg(neto)} + tara ${fmtKg(tara)}).`
                : 'El peso valorizado sigue siendo el neto declarado por MEL.';
            })()}
            valor={form.tara_origen} unidad={form.unidad_tara}
            onValor={(v) => setForm({ ...form, tara_origen: v })}
            onUnidad={(u) => setForm({ ...form, unidad_tara: u })} />
        )}

        {fn.transporte && <>
        <div className="ev-tit">Transporte
          <small>Obligatorio en la guía electrónica desde el 1 de noviembre de 2026 (Res. Ex. 154 del SII)</small>
        </div>
        <div className="grid g2" style={{ gap: 0, columnGap: 14 }}>
          <Field label="Transportista">
            <input value={form.transportista} onChange={(e) => setForm({ ...form, transportista: e.target.value })}
              placeholder="Nombre o razón social" />
          </Field>
          <Field label="RUT del transportista">
            <input value={form.transportista_rut} onChange={(e) => setForm({ ...form, transportista_rut: e.target.value })}
              placeholder="76.010.722-0" />
          </Field>
          <Field label="Patente del tracto">
            <input value={form.patente_tracto} onChange={(e) => setForm({ ...form, patente_tracto: e.target.value.toUpperCase() })}
              placeholder="ABCD12" />
          </Field>
          <Field label="Patente de la rampla o batea">
            <input value={form.patente_rampla} onChange={(e) => setForm({ ...form, patente_rampla: e.target.value.toUpperCase() })}
              placeholder="EFGH34" />
          </Field>
        </div>
        </>}

        <div className="ev-tit">Respaldos de la guía <small>JPG, PNG, WebP o PDF · máx. 5 MB · hasta 2 archivos por respaldo</small></div>
        {EVIDENCIA.map(([tipo, etiqueta, ayuda]) => {
          const puestas = form.ev[tipo] ?? [];
          return (
            <Field key={tipo} label={`${etiqueta}${puestas.length ? ` · ${puestas.length}` : ''}`} hint={ayuda}>
              <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => {
                  const { buenas, malas } = revisarFotos(Array.from(e.target.files));
                  if (malas.length) toast(malas.join(' · '), true);
                  if (!buenas.length) e.target.value = '';
                  setForm({ ...form, ev: { ...form.ev, [tipo]: buenas.slice(0, 2) } });
                }} />
              {puestas.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {puestas.map((f) => (
                    f.type === 'application/pdf'
                      ? <span key={f.name} title={f.name}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 48, padding: '0 8px', fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', background: 'var(--surface-2)', borderRadius: 6, border: '1px solid var(--line)' }}>📄 PDF</span>
                      : <img key={f.name} src={URL.createObjectURL(f)} alt={f.name}
                          style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--line)' }} />
                  ))}
                </div>
              )}
            </Field>
          );
        })}
        <small style={{ color: 'var(--muted)' }}>Se folia con un código interno automático (CI-####) al registrar. No es la GD del SII: esa es el «N° de guía de despacho MEL».</small>
      </Modal>

      <Modal open={!!recep} title={recep && `Recepcionar ${recep.guia} en La Negra`} onClose={() => setRecep(null)}
        footer={<>
          <button className="btn" onClick={() => setRecep(null)}>Cancelar</button>
          <button className="btn primary" onClick={recepcionar}>Validar recepción</button>
        </>}>
        {recep && (() => {
          const kg = aKg(rForm.kg_destino, rForm.unidad);
          const origen = Number(recep.kg_origen);
          const dif = kg == null ? null : kg - origen;
          const pct = dif == null ? null : (dif / origen) * 100;
          const fuera = pct != null && Math.abs(pct) > 2;
          return (
            <>
              <div className="cotejo">
                <span><small>Declarado por MEL en origen</small><b className="mono">{fmtKg(origen)} kg</b></span>
                <span className="vs">frente a</span>
                <span><small>Pesado en La Negra</small>
                  <b className="mono">{kg == null ? '— pendiente —' : `${fmtKg(kg)} kg`}</b></span>
              </div>
              {dif != null && (
                <div className={`dif-live ${fuera ? 'bad' : 'ok'}`}>
                  Diferencia: <b>{dif > 0 ? '+' : ''}{fmtKg(dif)} kg ({pct > 0 ? '+' : ''}{pct.toFixed(2)} %)</b>
                  {fuera
                    ? ' — supera el 2%: la guía quedará observada para que el ITO la revise.'
                    : ' — dentro de la tolerancia del 2%.'}
                </div>
              )}
              <CampoPeso label="Peso validado en báscula La Negra"
                hint="Escriba el peso de su propia romana. El campo parte vacío a propósito: esta es una declaración independiente de la de MEL."
                valor={rForm.kg_destino} unidad={rForm.unidad}
                onValor={(v) => setRForm({ ...rForm, kg_destino: v })}
                onUnidad={(u) => setRForm({ ...rForm, unidad: u })} />
            </>
          );
        })()}
        {/* Alternativa A o B del contrato. Se decide mirando la carga, y el
            precio que se elija aquí queda congelado con la guía. */}
        {fn.tm && (() => {
          // Si se reclasificó, el precio que rige es el de la categoría final:
          // es la que se congela con la guía.
          const cat = rForm.categoria_final_id
            ? maestros?.categorias?.find((c) => c.id === rForm.categoria_final_id)
            : maestros?.categorias?.find((c) => c.nombre === recep?.categoria);
          const a = cat?.precio_usd_tm;
          const b = cat?.precio_usd_tm_madera;
          const precioTm = (v) => v == null ? 'sin precio vigente' : `USD ${usd(v)}/TM`;
          return (
            <Field label="¿La carga viene con madera?"
              hint="Define qué alternativa del contrato se aplica. El precio elegido queda congelado con esta guía.">
              <div className="alternativas">
                {[[false, 'Sin madera', 'Alternativa A', a], [true, 'Con madera', 'Alternativa B', b]].map(([val, tit, alt, precio]) => (
                  <button key={String(val)} type="button"
                    className={`alt${rForm.con_madera === val ? ' sel' : ''}`}
                    onClick={() => setRForm({ ...rForm, con_madera: val })}>
                    <b>{tit}</b>
                    <small>{alt}</small>
                    <span className="mono">{precioTm(precio)}</span>
                  </button>
                ))}
              </div>
            </Field>
          );
        })()}

        {fn.pesaje && <>
        <div className="grid g2" style={{ gap: 0, columnGap: 14 }}>
          <Field label="N° de ticket de báscula" hint="El folio que imprime la romana de La Negra.">
            <input value={rForm.ticket_numero} onChange={(e) => setRForm({ ...rForm, ticket_numero: e.target.value })} placeholder="114523" />
          </Field>
          <Field label="N° de vale">
            <input value={rForm.vale_numero} onChange={(e) => setRForm({ ...rForm, vale_numero: e.target.value })} placeholder="8871" />
          </Field>
        </div>
        <CampoPeso label="Tara · peso del camión vacío"
          hint={(() => {
            const neto = aKg(rForm.kg_destino, rForm.unidad);
            const tara = aKg(rForm.tara, rForm.unidad_tara);
            return neto && tara
              ? `Bruto del ticket: ${fmtKg(neto + tara)} kg (neto ${fmtKg(neto)} + tara ${fmtKg(tara)}).`
              : 'Queda registrada junto al ticket. El peso valorizado sigue siendo el neto.';
          })()}
          valor={rForm.tara} unidad={rForm.unidad_tara}
          onValor={(v) => setRForm({ ...rForm, tara: v })}
          onUnidad={(u) => setRForm({ ...rForm, unidad_tara: u })} />
        </>}

        {fn.desc_item && <>
        <div className="ev-tit">Descuentos de la carga <small>humedad, material ajeno, mermas</small></div>
        {rForm.descuentos.length > 0 && rForm.descuentos.map((d, i) => (
          <div className="pend" key={i}>
            <Chip tone="bad">{descTexto(d)}</Chip>
            <span>{d.glosa}</span>
            <button className="btn sm danger go"
              onClick={() => setRForm({ ...rForm, descuentos: rForm.descuentos.filter((_, j) => j !== i) })}>Quitar</button>
          </div>
        ))}
        <div className="desc-nuevo">
          <Select value={rForm.nuevoDesc.tipo}
            onChange={(e) => setRForm({ ...rForm, nuevoDesc: { ...rForm.nuevoDesc, tipo: e.target.value } })}>
            {TIPO_DESC.map(([id, label, u]) => <option key={id} value={id}>{label} ({u})</option>)}
          </Select>
          <input type="number" min="0" step={rForm.nuevoDesc.tipo === 'clp' ? '1' : '0.01'} placeholder="0"
            value={rForm.nuevoDesc.valor}
            onChange={(e) => setRForm({ ...rForm, nuevoDesc: { ...rForm.nuevoDesc, valor: e.target.value } })} />
          <input placeholder="Motivo del descuento" value={rForm.nuevoDesc.glosa}
            onChange={(e) => setRForm({ ...rForm, nuevoDesc: { ...rForm.nuevoDesc, glosa: e.target.value } })} />
          <button className="btn sm" onClick={agregarDesc}>Agregar</button>
        </div>
        <small style={{ color: 'var(--muted)', display: 'block', marginBottom: 14 }}>
          {TIPO_DESC.find(([t]) => t === rForm.nuevoDesc.tipo)?.[3]}
        </small>
        </>}

        <Field label="Foto del ticket de báscula La Negra" hint="Respalda el peso que acaba de declarar. Queda adjunto a la guía.">
          <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => {
              const { buenas, malas } = revisarFotos(Array.from(e.target.files));
              if (malas.length) toast(malas.join(' · '), true);
              if (!buenas.length) e.target.value = '';
              setRForm({ ...rForm, foto: buenas.slice(0, 2) });
            }} />
        </Field>
        <Field label="Reclasificación (solo si el material se reduce)" hint="El precio se congela con la categoría final al momento de esta recepción.">
          <Select value={rForm.categoria_final_id} onChange={(e) => setRForm({ ...rForm, categoria_final_id: e.target.value ? +e.target.value : '' })}>
            <option value="">Mantener {recep?.categoria}</option>
            {maestros?.categorias.filter((c) => c.nombre !== recep?.categoria).map((c) => <option key={c.id} value={c.id}>{c.nombre}{precioRef(c)}</option>)}
          </Select>
        </Field>
        <Field label="Observación (opcional)">
          <input value={rForm.observacion} onChange={(e) => setRForm({ ...rForm, observacion: e.target.value })} placeholder="Condición de la carga, mermas, etc." />
        </Field>
      </Modal>

      <Modal open={!!resolver} title={resolver && `Resolver observación · ${resolver.guia}`} onClose={() => setResolver(null)}
        footer={<>
          <button className="btn" onClick={() => setResolver(null)}>Cancelar</button>
          <button className="btn primary" onClick={post(`/despachos/${resolver?.id}/resolver`, { observacion: obs }, 'Observación resuelta', () => setResolver(null))}>Validar recepción</button>
        </>}>
        <p style={{ marginTop: 0, color: 'var(--ink-2)' }}>{resolver?.obs_recepcion}</p>
        <Field label="Resolución del ITO (obligatoria)" hint="Queda en la guía y en la bitácora de auditoría.">
          <textarea rows="2" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej.: diferencia justificada por humedad; se valida el peso de destino." />
        </Field>
      </Modal>

      <Modal open={!!anular} title={anular && `Anular ${anular.guia}`} onClose={() => setAnular(null)}
        footer={<>
          <button className="btn" onClick={() => setAnular(null)}>Cancelar</button>
          <button className="btn danger" onClick={anularGuia}>
            {aForm.reemplazar ? 'Anular y emitir reemplazo' : 'Anular guía'}
          </button>
        </>}>
        {anular?.estado === 'recepcionado' && (
          <div className="aviso" style={{ borderColor: 'var(--bad-line)', background: 'var(--bad-bg)' }}>
            <b style={{ color: 'var(--bad-tx)' }}>Esta guía ya fue recepcionada en La Negra</b>
            <p>El vendor ya la pesó y aceptó. Anularla deshace un movimiento que la otra parte
            dio por bueno, y va a aparecer como diferencia en la cuadratura de la semana.
            Si es solo un error de digitación, <b>Editar</b> corrige sin anular.</p>
          </div>
        )}
        <div className="aviso">
          <b>La guía no se borra</b>
          <p>Queda en el libro marcada como anulada, con su motivo y quién la anuló. El folio
          <b className="mono"> {anular?.guia}</b> sigue consumido, igual que una guía de papel anulada,
          y deja de sumar a la cuadratura, al estado de pago y al flujo del mes.</p>
        </div>
        <Field label="Motivo de la anulación (obligatorio)"
          hint="Queda en la guía y en la bitácora de auditoría. Es lo que va a leer un auditor.">
          <textarea rows="2" value={aForm.motivo} onChange={(e) => setAForm({ ...aForm, motivo: e.target.value })}
            placeholder="Ej.: error en el peso de origen; el camión volvió al patio sin descargar." />
        </Field>
        <label className="check-linea">
          <input type="checkbox" checked={aForm.reemplazar}
            onChange={(e) => setAForm({ ...aForm, reemplazar: e.target.checked })} />
          <span>
            <b>Emitir la guía que la reemplaza</b>
            <small>Se crea una guía nueva con folio propio, copiando patio, categoría, peso y transporte
            de {anular?.guia}. Las dos quedan enlazadas.</small>
          </span>
        </label>
      </Modal>

      <Modal open={nuevoTras} title="Despachar traslado La Negra → Lampa" onClose={() => setNuevoTras(false)}
        footer={<>
          <button className="btn" onClick={() => setNuevoTras(false)}>Cancelar</button>
          <button className="btn primary" onClick={post('/traslados',
            { categoria_id: tForm.categoria_id, kg: aKg(tForm.kg, tForm.unidad) },
            'Traslado despachado con guía foliada', () => { setNuevoTras(false); setTForm({ ...tForm, kg: '' }); })}>Despachar</button>
        </>}>
        {/* El origen es fijo por diseño: el vendor consolida en La Negra y de ahí
            re-despacha. Se afirma como dato, no como un control deshabilitado:
            una caja gris se lee como "no me deja elegir", no como "es así". */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', marginBottom: 14,
          background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-s)' }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>Origen</span>
          <b>La Negra</b>
          <small style={{ color: 'var(--muted)', marginLeft: 'auto', textAlign: 'right' }}>
            Patio del vendor → destino final en Lampa
          </small>
        </div>
        <Field label="Categoría de material">
          <Select value={tForm.categoria_id ?? ''} onChange={(e) => setTForm({ ...tForm, categoria_id: +e.target.value })}>
            {maestros?.categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}{precioRef(c)}</option>)}
          </Select>
        </Field>
        <CampoPeso label="Peso despachado desde La Negra" hint="La guía se folia automáticamente (GT-####)."
          valor={tForm.kg} unidad={tForm.unidad}
          onValor={(v) => setTForm({ ...tForm, kg: v })}
          onUnidad={(u) => setTForm({ ...tForm, unidad: u })} />
      </Modal>

      <Modal open={!!recepTras} title={recepTras && `Recepcionar ${recepTras.guia} en Lampa`} onClose={() => { setRecepTras(null); setCdfFile([]); }}
        footer={<>
          <button className="btn" onClick={() => { setRecepTras(null); setCdfFile([]); }}>Cancelar</button>
          <button className="btn primary" onClick={recepcionarLampa}>Recepcionar y emitir CDF</button>
        </>}>
        <CampoPeso label="Peso validado en báscula Lampa"
          hint={`Despachado desde La Negra: ${recepTras && fmtKg(recepTras.kg)} kg. Al validar se emite el certificado de disposición final foliado (CDF-####).`}
          valor={lampa.valor} unidad={lampa.unidad}
          onValor={(v) => setLampa({ ...lampa, valor: v })}
          onUnidad={(u) => setLampa({ ...lampa, unidad: u })} />
        {fn.cdf_doc && (
          <Field label="Documento del certificado de disposición final (opcional)"
            hint="Adjunte el CDF firmado en PDF o foto. Queda asociado al certificado foliado.">
            <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(e) => {
                const { buenas, malas } = revisarFotos(Array.from(e.target.files));
                if (malas.length) toast(malas.join(' · '), true);
                if (!buenas.length) e.target.value = '';
                setCdfFile(buenas.slice(0, 2));
              }} />
            {cdfFile.length > 0 && <small style={{ color: 'var(--muted)', display: 'block', marginTop: 6 }}>{cdfFile.length} documento(s) adjunto(s).</small>}
          </Field>
        )}
      </Modal>

      <Modal open={!!adjCdf} title={adjCdf && `Adjuntar documento · ${adjCdf.cert_folio}`}
        onClose={() => { setAdjCdf(null); setCdfFile([]); }}
        footer={<>
          <button className="btn" onClick={() => { setAdjCdf(null); setCdfFile([]); }}>Cancelar</button>
          <button className="btn primary" onClick={adjuntarCdf}>Adjuntar</button>
        </>}>
        <p style={{ marginTop: 0 }}>
          Certificado <b className="mono">{adjCdf?.cert_folio}</b> del traslado <b className="mono">{adjCdf?.guia}</b>.
        </p>
        <p style={{ color: 'var(--ink-2)', fontSize: 13.5 }}>
          El certificado ya está emitido y foliado. Acá se adjunta el documento firmado, que
          normalmente llega después de recibir el material.
          {adjCdf?.cert_fotos > 0 && <> Ya tiene <b>{adjCdf.cert_fotos}</b> documento(s): estos se suman.</>}
        </p>
        <Field label="Documento del certificado" hint="PDF o foto · hasta 4 archivos · 5 MB cada uno.">
          <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => {
              const buenas = Array.from(e.target.files).filter((f) => ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(f.type));
              if (buenas.length < e.target.files.length) toast('Solo se aceptan PDF, JPG, PNG o WebP', true);
              if (!buenas.length) e.target.value = '';
              setCdfFile(buenas.slice(0, 4));
            }} />
          {cdfFile.length > 0 && <small style={{ color: 'var(--muted)', display: 'block', marginTop: 6 }}>{cdfFile.length} documento(s) listo(s) para adjuntar.</small>}
        </Field>
      </Modal>

      <Modal open={!!verCdf} title={verCdf && `Certificado ${verCdf.traslado.cert_folio}`} onClose={() => setVerCdf(null)}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 8 }}>
          {verCdf?.archivos.map((a) => (
            <a key={a.url} href={a.url} target="_blank" rel="noreferrer" title="Abrir en tamaño completo">
              {/\.pdf(\?|$)/i.test(a.url)
                ? <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', height: 130, background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--line)', color: 'var(--ink-2)', fontSize: 13, fontWeight: 600 }}><span style={{ fontSize: 26 }}>📄</span>Ver PDF</span>
                : <img src={a.url} alt="CDF" style={{ width: '100%', height: 130, objectFit: 'contain', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--line)' }} />}
            </a>
          ))}
        </div>
      </Modal>

      <Modal open={!!editar} title={editar && `Corregir datos · ${editar.guia}`} onClose={() => { setEditar(null); setEForm(null); }}
        footer={<>
          <button className="btn" onClick={() => { setEditar(null); setEForm(null); }}>Cancelar</button>
          <button className="btn primary" onClick={guardarEdicion}>Guardar corrección</button>
        </>}>
        {eForm && <>
        <small style={{ color: 'var(--muted)', display: 'block', marginBottom: 12 }}>
          Solo datos del documento de origen. Los kilos y el precio de la recepción no se editan aquí: para eso se anula la guía y se rehace.
        </small>
        <div className="grid g2" style={{ gap: 0, columnGap: 14 }}>
          <Field label="N° de guía de despacho MEL">
            <input value={eForm.guia_mel} onChange={(e) => setEForm({ ...eForm, guia_mel: e.target.value })} placeholder="458921" />
          </Field>
          <Field label="Fecha del despacho">
            <DateField value={eForm.fecha} onChange={(e) => setEForm({ ...eForm, fecha: e.target.value })} />
          </Field>
        </div>
        <Field label="Patio de origen">
          <Select value={eForm.patio_id} onChange={(e) => setEForm({ ...eForm, patio_id: +e.target.value })}>
            {maestros?.patios.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>)}
          </Select>
        </Field>
        <Field label="Categoría de material">
          <Select value={eForm.categoria_id} onChange={(e) => setEForm({ ...eForm, categoria_id: +e.target.value })}>
            {maestros?.categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </Select>
        </Field>
        <CampoPeso label="Peso en báscula MEL" valor={eForm.kg_origen} unidad={eForm.unidad}
          onValor={(v) => setEForm({ ...eForm, kg_origen: v })}
          onUnidad={(u) => setEForm({ ...eForm, unidad: u })} />
        {fn.tara_origen && (
          <CampoPeso label="Tara · peso del camión vacío (opcional)" valor={eForm.tara_origen} unidad={eForm.unidad_tara}
            onValor={(v) => setEForm({ ...eForm, tara_origen: v })}
            onUnidad={(u) => setEForm({ ...eForm, unidad_tara: u })} />
        )}
        {fn.transporte && (
          <div className="grid g2" style={{ gap: 0, columnGap: 14 }}>
            <Field label="Transportista"><input value={eForm.transportista} onChange={(e) => setEForm({ ...eForm, transportista: e.target.value })} /></Field>
            <Field label="RUT del transportista"><input value={eForm.transportista_rut} onChange={(e) => setEForm({ ...eForm, transportista_rut: e.target.value })} /></Field>
            <Field label="Patente del tracto"><input value={eForm.patente_tracto} onChange={(e) => setEForm({ ...eForm, patente_tracto: e.target.value.toUpperCase() })} /></Field>
            <Field label="Patente de la rampla o batea"><input value={eForm.patente_rampla} onChange={(e) => setEForm({ ...eForm, patente_rampla: e.target.value.toUpperCase() })} /></Field>
          </div>
        )}
        </>}
      </Modal>
    </div>
  );
}
