import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Chip, DateField, Empty, Field, Modal, PageHead, Select, Tabs, hoyISO, useToast } from '../ui.jsx';

// Repositorio documental (Fase 3): los 9 tipos de chatarra y los 14 de
// obsoletos, cada documento vinculado al hito del proceso que respalda, con
// versiones que nunca se pisan y control de vencimientos. Qué ve y qué carga
// cada perfil lo define el catálogo de tipos, que ajusta el coordinador.
const EYEBROW = 'Fase 3 · Control documental';
const VENC = {
  vencido: ['bad', 'Vencido'],
  por_vencer: ['warn', 'Por vencer'],
  vigente: ['ok', 'Vigente'],
  sin_fecha: ['warn', 'Sin fecha'],
  no_vence: ['neutral', 'No vence'],
};
const PROCESO = { chatarra: 'Chatarra', obsoletos: 'Obsoletos' };
const ROL_CORTO = {
  limpieza: 'Limpieza', vendor: 'Vendor', ito: 'ITO', coordinador: 'Coordinador',
  lampa: 'Lampa', admin_venta: 'Adm. venta',
};

const fmtBytes = (n) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toLocaleString('es-CL', { maximumFractionDigits: 1 })} MB`);
const fmtCuando = (ts) => (ts ? new Date(ts).toLocaleString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
// Vencimiento propuesto: hoy + la vigencia típica del tipo.
const sumarMeses = (meses) => {
  if (!meses) return '';
  const d = new Date();
  d.setMonth(d.getMonth() + Number(meses));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const textoDias = (v) => {
  if (v?.dias == null) return null;
  if (v.dias < 0) return `venció hace ${-v.dias} día(s)`;
  if (v.dias === 0) return 'vence hoy';
  return `en ${v.dias} día(s)`;
};

export default function Documentos() {
  const { user } = useAuth();
  const esCoord = user?.role === 'coordinador';
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = params.get('t') ?? 'docs';
  const fVenc = params.get('f') ?? 'todos';
  const fHito = params.get('hito');
  const fRef = params.get('ref');
  const setP = (cambios) => {
    const n = Object.fromEntries(params);
    for (const [k, v] of Object.entries(cambios)) { if (v == null || v === '') delete n[k]; else n[k] = v; }
    setParams(n, { replace: true });
  };

  const [cat, setCat] = useState(null);          // { tipos, hitos, roles }
  const [docs, setDocs] = useState(null);
  const [pend, setPend] = useState([]);
  const [error, setError] = useState(null);
  const [fProc, setFProc] = useState('todos');
  const [fTipo, setFTipo] = useState('');
  const [busca, setBusca] = useState('');
  const [busy, setBusy] = useState(false);

  const [cargar, setCargar] = useState(null);    // formulario de documento nuevo
  const [ents, setEnts] = useState({});          // hito → entidades para vincular
  const [detalle, setDetalle] = useState(null);
  const [archivosVer, setArchivosVer] = useState({});   // versión → archivos firmados
  const [version, setVersion] = useState(null);  // formulario de versión nueva
  const [editar, setEditar] = useState(null);
  const [anular, setAnular] = useState(null);
  const [tipoEdit, setTipoEdit] = useState(null);

  const load = async () => {
    try {
      const [c, d, p] = await Promise.all([api('/documentos/tipos'), api('/documentos'), api('/documentos/pendientes')]);
      setCat(c); setDocs(d); setPend(p); setError(null);
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, []);

  const tipoPorCodigo = useMemo(() => new Map((cat?.tipos ?? []).map((t) => [t.codigo, t])), [cat]);
  const cargables = (cat?.tipos ?? []).filter((t) => t.puede_cargar && t.activo);

  if (error) {
    return (
      <div>
        <PageHead eyebrow={EYEBROW} title="Repositorio documental" />
        <div className="aviso bad"><b>No se pudo abrir el repositorio.</b><p>{error}</p></div>
      </div>
    );
  }
  if (!cat || !docs) return <div className="loading">Cargando repositorio…</div>;

  const correr = async (fn) => { if (busy) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };

  /* ---------- documentos: filtros ---------- */
  const deHito = docs.filter((d) => (!fHito || d.hito === fHito) && (!fRef || String(d.ref_id) === fRef));
  const base = deHito.filter((d) => (fProc === 'todos' || d.proceso === fProc) && (!fTipo || d.tipo === fTipo));
  const vigentes = base.filter((d) => d.estado === 'vigente');
  const cuenta = (clave) => vigentes.filter((d) => d.venc.clave === clave).length;
  const FILTROS = [
    ['todos', 'Vigentes', vigentes.length],
    ['vencido', 'Vencidos', cuenta('vencido')],
    ['por_vencer', 'Por vencer', cuenta('por_vencer')],
    ['sin_fecha', 'Sin fecha', cuenta('sin_fecha')],
    ['anulado', 'Anulados', base.filter((d) => d.estado === 'anulado').length],
  ].filter(([id, , n]) => id === 'todos' || id === fVenc || n > 0);
  const q = busca.trim().toLowerCase();
  const visibles = base
    .filter((d) => (fVenc === 'anulado' ? d.estado === 'anulado'
      : d.estado === 'vigente' && (fVenc === 'todos' || d.venc.clave === fVenc)))
    .filter((d) => !q || [d.folio, d.titulo, d.ref_label, d.tipo_nombre].some((x) => x?.toLowerCase().includes(q)));
  const etiquetaHito = fHito && (deHito[0]?.ref_label
    ? `${cat.hitos[fHito]?.nombre ?? fHito} ${deHito[0].ref_label}`
    : cat.hitos[fHito]?.nombre ?? fHito);

  /* ---------- carga de un documento nuevo ---------- */
  async function entidadesDe(hito) {
    if (ents[hito]) return ents[hito];
    const lista = await api(`/documentos/hitos/${hito}`);
    setEnts((x) => ({ ...x, [hito]: lista }));
    return lista;
  }
  // `pre.hito` fija el registro (se llegó desde una guía, un EP…): solo se
  // ofrecen los tipos de ese hito y el registro ya viene elegido.
  async function abrirCarga(pre = {}) {
    const tipo = pre.tipo ? tipoPorCodigo.get(pre.tipo) : null;
    const hito = tipo?.hito ?? pre.hito ?? null;
    setCargar({ hito, tipo: tipo?.codigo ?? '', ref_id: pre.ref_id ? String(pre.ref_id) : '', titulo: '',
      vence_el: tipo?.vence ? sumarMeses(tipo.vigencia_meses) : '', nota: '', archivos: [] });
    if (hito) entidadesDe(hito).catch((e) => toast(e.message, true));
  }
  function elegirTipo(codigo) {
    const t = tipoPorCodigo.get(codigo);
    setCargar((c) => ({ ...c, tipo: codigo, ref_id: c.hito && t?.hito === c.hito ? c.ref_id : '',
      vence_el: t?.vence ? sumarMeses(t.vigencia_meses) : '' }));
    if (t) entidadesDe(t.hito).catch((e) => toast(e.message, true));
  }
  const enviarCarga = () => correr(async () => {
    const t = tipoPorCodigo.get(cargar.tipo);
    if (!t) return toast('Seleccione el tipo de documento', true);
    if (!cargar.ref_id) return toast(`Seleccione el ${cat.hitos[t.hito].nombre.toLowerCase()} al que corresponde`, true);
    if (t.vence && !cargar.vence_el) return toast('Indique la fecha de vencimiento', true);
    if (!cargar.archivos.length) return toast('Adjunte al menos un archivo', true);
    const fd = new FormData();
    fd.append('tipo', t.codigo);
    fd.append('ref_id', cargar.ref_id);
    fd.append('titulo', cargar.titulo);
    if (t.vence) fd.append('vence_el', cargar.vence_el);
    fd.append('nota', cargar.nota);
    for (const f of cargar.archivos) fd.append('archivos', f);
    try {
      const r = await api('/documentos', { method: 'POST', body: fd });
      toast(r.fallidos ? `${r.folio} cargado, pero ${r.fallidos} archivo(s) no se pudieron guardar` : `${r.folio} cargado al repositorio`, !!r.fallidos);
      setCargar(null); load();
    } catch (e) { toast(e.message, true); }
  });

  /* ---------- detalle y versiones ---------- */
  async function verArchivos(docId, v) {
    try {
      const r = await api(`/documentos/${docId}/versiones/${v}`);
      setArchivosVer((x) => ({ ...x, [v]: r.archivos }));
    } catch (e) { toast(e.message, true); }
  }
  async function abrirDetalle(d) {
    try {
      const det = await api(`/documentos/${d.id}`);
      setArchivosVer({});
      setDetalle(det);
      verArchivos(det.id, det.version_actual);
    } catch (e) { toast(e.message, true); }
  }
  const recargarDetalle = async (id) => {
    const det = await api(`/documentos/${id}`);
    setArchivosVer({});
    setDetalle(det);
    verArchivos(det.id, det.version_actual);
  };
  const enviarVersion = () => correr(async () => {
    const { doc } = version;
    if (!version.nota.trim()) return toast('Indique qué cambia en esta versión', true);
    if (doc.tipo_info?.vence && !version.vence_el) return toast('Indique el vencimiento de esta versión', true);
    if (!version.archivos.length) return toast('Adjunte al menos un archivo', true);
    const fd = new FormData();
    fd.append('nota', version.nota.trim());
    if (doc.tipo_info?.vence) fd.append('vence_el', version.vence_el);
    if (version.conservar) fd.append('conservar', '1');
    for (const f of version.archivos) fd.append('archivos', f);
    try {
      const r = await api(`/documentos/${doc.id}/versiones`, { method: 'POST', body: fd });
      toast(`${doc.folio}: versión ${r.version_actual} cargada`);
      setVersion(null); load(); recargarDetalle(doc.id);
    } catch (e) { toast(e.message, true); }
  });
  const enviarEdicion = () => correr(async () => {
    try {
      await api(`/documentos/${editar.id}`, { method: 'PATCH', body: {
        titulo: editar.titulo, ...(editar.vence ? { vence_el: editar.vence_el } : {}) } });
      toast('Documento actualizado');
      setEditar(null); load(); recargarDetalle(editar.id);
    } catch (e) { toast(e.message, true); }
  });
  const enviarAnulacion = () => correr(async () => {
    if (!anular.motivo.trim()) return toast('Indique el motivo de la anulación', true);
    try {
      await api(`/documentos/${anular.id}/anular`, { method: 'POST', body: { motivo: anular.motivo.trim() } });
      toast(`${anular.folio} anulado`);
      setAnular(null); load(); recargarDetalle(anular.id);
    } catch (e) { toast(e.message, true); }
  });

  /* ---------- catálogo de tipos ---------- */
  const enviarTipo = () => correr(async () => {
    const t = tipoEdit;
    try {
      await api(`/documentos/tipos/${t.codigo}`, { method: 'PATCH', body: {
        responsable: t.responsable, descripcion: t.descripcion, activo: t.activo, vence: t.vence,
        vigencia_meses: t.vence ? t.vigencia_meses : null, aviso_dias: Number(t.aviso_dias),
        roles_carga: t.roles_carga, roles_ver: t.roles_ver, exigible_en: t.exigible_en } });
      toast(`«${t.nombre}» actualizado`);
      setTipoEdit(null); load();
    } catch (e) { toast(e.message, true); }
  });

  const pendProc = pend.filter((p) => fProc === 'todos' || p.proceso === fProc);
  const tipoCarga = cargar && tipoPorCodigo.get(cargar.tipo);
  const listaEnts = tipoCarga ? ents[tipoCarga.hito] : null;
  const procesos = [...new Set(cat.tipos.map((t) => t.proceso))];

  const FiltroProceso = procesos.length > 1 && (
    <div className="filtros">
      {[['todos', 'Ambos procesos'], ...procesos.map((p) => [p, PROCESO[p]])].map(([id, label]) => (
        <button key={id} className={`fchip ${fProc === id ? 'on' : ''}`} onClick={() => { setFProc(id); setFTipo(''); }}>{label}</button>
      ))}
    </div>
  );

  return (
    <div>
      <PageHead eyebrow={EYEBROW} title="Repositorio documental"
        sub="Cada documento queda vinculado al hito del proceso que respalda, con todas sus versiones y el control de sus vencimientos.">
        {cargables.length > 0 && <button className="btn primary" onClick={() => abrirCarga()}>↑ Cargar documento</button>}
      </PageHead>

      <Tabs active={tab} onChange={(t) => setP({ t: t === 'docs' ? null : t, f: null })} tabs={[
        ['docs', 'Documentos'],
        ['pendientes', 'Pendientes', pend.length],
        ['tipos', 'Tipos documentales'],
      ]} />

      {/* ======================= documentos ======================= */}
      {tab === 'docs' && (<>
        {fHito && (
          <div className="alerta info" style={{ alignItems: 'center' }}>
            <b>Filtrado</b> Mostrando solo los documentos de {etiquetaHito}.
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {fRef && cargables.some((t) => t.hito === fHito) && (
                <button className="btn sm primary" onClick={() => abrirCarga({ hito: fHito, ref_id: fRef })}>↑ Cargar para este registro</button>
              )}
              <button className="btn sm" onClick={() => setP({ hito: null, ref: null })}>Ver todos</button>
            </span>
          </div>
        )}
        <div className="card">
          <div className="card-h" style={{ flexWrap: 'wrap' }}>
            <div className="filtros">
              {FILTROS.map(([id, label, n]) => (
                <button key={id} className={`fchip ${fVenc === id ? 'on' : ''}`} onClick={() => setP({ f: id === 'todos' ? null : id })}>
                  {label} <i>{n}</i>
                </button>
              ))}
            </div>
            <div className="doc-busca">
              {FiltroProceso}
              <Select value={fTipo} onChange={(e) => setFTipo(e.target.value)}>
                <option value="">Todos los tipos</option>
                {cat.tipos.filter((t) => fProc === 'todos' || t.proceso === fProc).map((t) => (
                  <option key={t.codigo} value={t.codigo}>{PROCESO[t.proceso]} · {t.nombre}</option>
                ))}
              </Select>
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar folio, título o hito" aria-label="Buscar documento" />
            </div>
          </div>
          <div className="tbl-wrap"><table>
            <thead><tr>
              <th>Documento</th><th>Tipo</th><th>Hito vinculado</th><th className="num">Versión</th>
              <th>Vencimiento</th><th>Última carga</th><th className="acc"></th>
            </tr></thead>
            <tbody>
              {visibles.map((d) => {
                const [tono, txt] = d.estado === 'anulado' ? ['neutral', 'Anulado'] : VENC[d.venc.clave];
                return (
                  <tr key={d.id} className={d.estado === 'anulado' ? 'anulada' : undefined}>
                    <td><b className="mono">{d.folio}</b><br /><span>{d.titulo}</span></td>
                    <td>{d.tipo_nombre}<br /><small style={{ color: 'var(--muted)' }}>{PROCESO[d.proceso]}</small></td>
                    <td><small style={{ color: 'var(--muted)' }}>{d.hito_nombre}</small><br />{d.ref_label}</td>
                    <td className="num mono">v{d.version_actual}</td>
                    <td>
                      <Chip tone={tono}>{txt}</Chip>
                      {d.vence_el && <><br /><small className="mono" style={{ color: 'var(--muted)' }}>{d.vence_el} · {textoDias(d.venc)}</small></>}
                    </td>
                    <td>
                      {d.ultima ? (<>
                        {d.ultima.subido_por}<br />
                        <small style={{ color: 'var(--muted)' }}>{fmtCuando(d.ultima.subido_el)} · {d.ultima.archivos} archivo(s)</small>
                      </>) : '—'}
                    </td>
                    <td className="num acc" style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn sm" onClick={() => abrirDetalle(d)}>Ver</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
          {visibles.length === 0 && (
            <Empty title={docs.length ? 'Sin documentos con estos filtros' : 'El repositorio está vacío'}>
              {docs.length ? 'Cambie los filtros o la búsqueda.'
                : cargables.length ? 'Cargue el primer documento con «Cargar documento». Las guías, certificados y actas que se adjuntan en cada proceso también llegan aquí.'
                  : 'Aún no hay documentos de los tipos que su perfil consulta.'}
            </Empty>
          )}
        </div>
        <div className="audit-note" style={{ marginTop: 12 }}>
          ⚙ Una versión nueva nunca borra la anterior: todas quedan disponibles en el detalle del documento, con quién la subió y por qué.
        </div>
      </>)}

      {/* ======================= pendientes ======================= */}
      {tab === 'pendientes' && (
        <div className="card">
          <div className="card-h" style={{ flexWrap: 'wrap' }}>
            <h3>Documentos exigibles sin cargar</h3>
            {FiltroProceso || <small>{pend.length} pendiente(s)</small>}
          </div>
          <div className="tbl-wrap"><table>
            <thead><tr><th>Documento que falta</th><th>Hito</th><th>Estado del hito</th><th>Responsable</th><th className="acc"></th></tr></thead>
            <tbody>
              {pendProc.map((p) => (
                <tr key={`${p.tipo}:${p.ref_id}`}>
                  <td>{p.tipo_nombre}<br /><small style={{ color: 'var(--muted)' }}>{PROCESO[p.proceso]}</small></td>
                  <td><small style={{ color: 'var(--muted)' }}>{cat.hitos[p.hito]?.nombre}</small><br />{p.ref_label}</td>
                  <td><Chip tone="neutral">{p.estado_nombre}</Chip></td>
                  <td>{p.responsable || '—'}</td>
                  <td className="num acc">
                    {p.puede_cargar && <button className="btn sm primary" onClick={() => abrirCarga({ tipo: p.tipo, ref_id: p.ref_id })}>Cargar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {pendProc.length === 0 && <Empty title="Sin pendientes">Todo lo exigible según el estado de cada hito está cargado.</Empty>}
          <div className="card-b" style={{ borderTop: '1px solid var(--line-2)' }}>
            <small style={{ color: 'var(--muted)' }}>
              Un documento pasa a ser exigible cuando su hito llega a ciertos estados (por ejemplo, la factura cuando el estado de pago queda facturado).
              Esa regla se ve y se ajusta en «Tipos documentales».
            </small>
          </div>
        </div>
      )}

      {/* ======================= tipos ======================= */}
      {tab === 'tipos' && (
        <div className="card">
          <div className="card-h" style={{ flexWrap: 'wrap' }}>
            <h3>Catálogo de tipos documentales</h3>
            {FiltroProceso}
          </div>
          <div className="tbl-wrap"><table>
            <thead><tr>
              <th>Tipo documental</th><th>Hito</th><th>Vencimiento</th><th>Carga</th><th>Consulta</th>
              <th>Exigible cuando</th><th>Responsable</th>{esCoord && <th className="acc"></th>}
            </tr></thead>
            <tbody>
              {cat.tipos.filter((t) => fProc === 'todos' || t.proceso === fProc).map((t) => (
                <tr key={t.codigo} className={t.activo ? undefined : 'anulada'}>
                  <td><b>{t.nombre}</b>{!t.activo && ' (inactivo)'}<br /><small style={{ color: 'var(--muted)' }}>{PROCESO[t.proceso]}{t.descripcion ? ` · ${t.descripcion}` : ''}</small></td>
                  <td>{cat.hitos[t.hito]?.nombre}</td>
                  <td>{t.vence
                    ? <>Vence{t.vigencia_meses ? ` · ${t.vigencia_meses} mes(es)` : ''}<br /><small style={{ color: 'var(--muted)' }}>aviso {t.aviso_dias} día(s) antes</small></>
                    : <span style={{ color: 'var(--muted)' }}>No vence</span>}</td>
                  <td>{t.roles_carga.map((r) => ROL_CORTO[r] ?? r).join(', ')}</td>
                  <td>{t.roles_ver.length ? t.roles_ver.map((r) => ROL_CORTO[r] ?? r).join(', ') : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                  <td>{t.exigible_en.length
                    ? t.exigible_en.map((e) => cat.hitos[t.hito]?.estados[e] ?? e).join(', ')
                    : <span style={{ color: 'var(--muted)' }}>Opcional</span>}</td>
                  <td>{t.responsable || '—'}</td>
                  {esCoord && (
                    <td className="num acc">
                      <button className="btn sm" onClick={() => setTipoEdit({ ...t, responsable: t.responsable ?? '', descripcion: t.descripcion ?? '', vigencia_meses: t.vigencia_meses ?? '' })}>Editar</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {/* ---- cargar documento ---- */}
      <Modal open={!!cargar} title="Cargar documento" onClose={() => setCargar(null)}
        footer={<>
          <button className="btn" onClick={() => setCargar(null)} disabled={busy}>Cancelar</button>
          <button className="btn primary" onClick={enviarCarga} disabled={busy}>{busy ? 'Cargando…' : 'Cargar documento'}</button>
        </>}>
        {cargar && <>
          <Field label="Tipo de documento" hint={tipoCarga ? [tipoCarga.descripcion, tipoCarga.responsable && `Responsable: ${tipoCarga.responsable}`].filter(Boolean).join(' · ') : null}>
            <Select value={cargar.tipo} onChange={(e) => elegirTipo(e.target.value)} placeholder="Seleccione el tipo">
              <option value="">Seleccione el tipo</option>
              {cargables.filter((t) => !cargar.hito || t.hito === cargar.hito).map((t) => (
                <option key={t.codigo} value={t.codigo}>{PROCESO[t.proceso]} · {t.nombre}</option>
              ))}
            </Select>
          </Field>
          {tipoCarga && (
            <Field label={cat.hitos[tipoCarga.hito]?.nombre ?? 'Hito'} hint="El hito del proceso que este documento respalda.">
              {!listaEnts ? <div className="loading" style={{ padding: 8 }}>Cargando…</div>
                : listaEnts.length === 0 ? <small style={{ color: 'var(--muted)' }}>No hay registros de este hito todavía.</small>
                  : (
                    <Select value={cargar.ref_id} onChange={(e) => setCargar({ ...cargar, ref_id: e.target.value })}>
                      <option value="">Seleccione…</option>
                      {listaEnts.map((e) => <option key={e.id} value={String(e.id)}>{e.label} · {e.estado_nombre}</option>)}
                    </Select>
                  )}
            </Field>
          )}
          <Field label="Título" hint="Opcional. Si lo deja en blanco se usa el tipo y el hito.">
            <input value={cargar.titulo} onChange={(e) => setCargar({ ...cargar, titulo: e.target.value })}
              placeholder={tipoCarga ? `${tipoCarga.nombre} · …` : 'Contrato de compraventa 2026'} />
          </Field>
          {tipoCarga?.vence && (
            <Field label="Vence el" hint={tipoCarga.vigencia_meses ? `Se propone la vigencia típica de ${tipoCarga.vigencia_meses} mes(es); ajústela a la del documento.` : 'Fecha en que el documento deja de estar vigente.'}>
              <DateField value={cargar.vence_el} onChange={(e) => setCargar({ ...cargar, vence_el: e.target.value })} />
            </Field>
          )}
          <Field label="Archivos" hint="PDF, imagen, Excel o Word; hasta 10 archivos de 20 MB.">
            <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx"
              onChange={(e) => setCargar({ ...cargar, archivos: [...e.target.files] })} />
            {cargar.archivos.length > 0 && <ListaLocal archivos={cargar.archivos} />}
          </Field>
          <Field label="Nota" hint="Opcional.">
            <textarea rows="2" value={cargar.nota} onChange={(e) => setCargar({ ...cargar, nota: e.target.value })} />
          </Field>
        </>}
      </Modal>

      {/* ---- detalle ---- */}
      <Modal open={!!detalle} title={detalle && `${detalle.folio} · ${detalle.tipo_nombre}`} onClose={() => setDetalle(null)} ancho
        footer={detalle && <>
          {esCoord && detalle.estado === 'vigente' && (
            <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => setAnular({ id: detalle.id, folio: detalle.folio, motivo: '' })}>Anular</button>
          )}
          {detalle.puede_cargar && detalle.estado === 'vigente' && (<>
            <button className="btn" onClick={() => setEditar({ id: detalle.id, titulo: detalle.titulo, vence: !!detalle.tipo_info?.vence, vence_el: detalle.vence_el ?? '' })}>Corregir datos</button>
            <button className="btn primary" onClick={() => setVersion({ doc: detalle, nota: '', archivos: [], conservar: false,
              vence_el: detalle.tipo_info?.vence ? sumarMeses(detalle.tipo_info.vigencia_meses) || detalle.vence_el || '' : '' })}>↑ Nueva versión</button>
          </>)}
          <button className="btn" onClick={() => setDetalle(null)}>Cerrar</button>
        </>}>
        {detalle && <>
          {detalle.estado === 'anulado' && (
            <div className="aviso bad"><b>Documento anulado</b> por {detalle.anulado_por}.<p>{detalle.anulado_motivo}</p></div>
          )}
          <h4 style={{ margin: '0 0 12px', fontSize: 15 }}>{detalle.titulo}</h4>
          <div className="grid g2" style={{ gap: 0, columnGap: 14 }}>
            <Field label="Hito vinculado">
              <div>{detalle.hito_nombre}: <b>{detalle.ref_label}</b>{detalle.ref_estado_nombre && <> · <Chip tone="neutral">{detalle.ref_estado_nombre}</Chip></>}</div>
            </Field>
            <Field label="Vencimiento">
              <div>
                {(() => { const [t, x] = VENC[detalle.venc.clave]; return <Chip tone={t}>{x}</Chip>; })()}
                {detalle.vence_el && <span className="mono"> {detalle.vence_el} · {textoDias(detalle.venc)}</span>}
              </div>
            </Field>
            <Field label="Proceso"><div>{PROCESO[detalle.proceso]}</div></Field>
            <Field label="Creado"><div>{detalle.creado_por} · {fmtCuando(detalle.creado_el)}</div></Field>
          </div>

          <h4 style={{ margin: '8px 0 8px', fontSize: 13 }}>Versiones ({detalle.versiones.length})</h4>
          <div className="doc-versiones">
            {detalle.versiones.map((v) => (
              <div key={v.version} className={`doc-version ${v.version === detalle.version_actual ? 'actual' : ''}`}>
                <div className="doc-version-h">
                  <b className="mono">v{v.version}</b>
                  {v.version === detalle.version_actual && <Chip tone="copper">Vigente</Chip>}
                  <span>{v.subido_por}{v.subido_rol && v.subido_rol !== 'sistema' ? ` · ${ROL_CORTO[v.subido_rol] ?? v.subido_rol}` : ''}</span>
                  <small>{fmtCuando(v.subido_el)}{v.vence_el ? ` · vence ${v.vence_el}` : ''}</small>
                </div>
                {v.nota && <div className="doc-version-nota">{v.nota}</div>}
                {archivosVer[v.version] ? (
                  <ul className="doc-files">
                    {archivosVer[v.version].map((a, i) => (
                      <li key={i}>
                        {a.url ? <a href={a.url} target="_blank" rel="noreferrer">📄 {a.nombre}</a> : <span>📄 {a.nombre} (no disponible)</span>}
                        <small>{fmtBytes(a.bytes)}</small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <button className="btn sm" onClick={() => verArchivos(detalle.id, v.version)}>Ver {v.archivos.length} archivo(s)</button>
                )}
              </div>
            ))}
          </div>
        </>}
      </Modal>

      {/* ---- versión nueva ---- */}
      <Modal open={!!version} title={version && `Nueva versión de ${version.doc.folio}`} onClose={() => setVersion(null)}
        footer={<>
          <button className="btn" onClick={() => setVersion(null)} disabled={busy}>Cancelar</button>
          <button className="btn primary" onClick={enviarVersion} disabled={busy}>{busy ? 'Cargando…' : `Cargar versión ${version ? version.doc.version_actual + 1 : ''}`}</button>
        </>}>
        {version && <>
          <p style={{ marginTop: 0, color: 'var(--ink-2)', fontSize: 13.5 }}>
            La versión {version.doc.version_actual} se conserva en el historial; la nueva pasa a ser la vigente.
          </p>
          <Field label="Qué cambia" hint="Obligatorio: queda en el historial del documento.">
            <textarea rows="2" value={version.nota} onChange={(e) => setVersion({ ...version, nota: e.target.value })}
              placeholder="Renovación anual del contrato · Se corrigió el monto · Copia firmada" />
          </Field>
          {version.doc.tipo_info?.vence && (
            <Field label="Vence el" hint="Vencimiento de esta versión.">
              <DateField value={version.vence_el} onChange={(e) => setVersion({ ...version, vence_el: e.target.value })} />
            </Field>
          )}
          <Field label="Archivos">
            <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx"
              onChange={(e) => setVersion({ ...version, archivos: [...e.target.files] })} />
            {version.archivos.length > 0 && <ListaLocal archivos={version.archivos} />}
          </Field>
          <label className="check-linea">
            <input type="checkbox" checked={version.conservar} onChange={(e) => setVersion({ ...version, conservar: e.target.checked })} />
            <span><b>Mantener los archivos de la versión anterior</b>
              <small>Para sumar un anexo o una página que faltaba. Si no se marca, la versión nueva contiene solo los archivos adjuntos aquí.</small></span>
          </label>
        </>}
      </Modal>

      {/* ---- corregir datos ---- */}
      <Modal open={!!editar} title="Corregir datos del documento" onClose={() => setEditar(null)}
        footer={<>
          <button className="btn" onClick={() => setEditar(null)} disabled={busy}>Cancelar</button>
          <button className="btn primary" onClick={enviarEdicion} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </>}>
        {editar && <>
          <Field label="Título">
            <input value={editar.titulo} onChange={(e) => setEditar({ ...editar, titulo: e.target.value })} />
          </Field>
          {editar.vence && (
            <Field label="Vence el" hint="Para corregir una fecha mal digitada. Si el documento se renovó, cargue una versión nueva.">
              <DateField value={editar.vence_el} onChange={(e) => setEditar({ ...editar, vence_el: e.target.value })} />
            </Field>
          )}
        </>}
      </Modal>

      {/* ---- anular ---- */}
      <Modal open={!!anular} title={anular && `Anular ${anular.folio}`} onClose={() => setAnular(null)}
        footer={<>
          <button className="btn" onClick={() => setAnular(null)} disabled={busy}>Cancelar</button>
          <button className="btn danger" onClick={enviarAnulacion} disabled={busy}>{busy ? 'Anulando…' : 'Anular documento'}</button>
        </>}>
        {anular && <>
          <p style={{ marginTop: 0 }}>El documento deja de contar como vigente. Sus versiones y archivos se conservan y siguen a la vista.</p>
          <Field label="Motivo" hint="Obligatorio.">
            <textarea rows="2" value={anular.motivo} onChange={(e) => setAnular({ ...anular, motivo: e.target.value })}
              placeholder="Se cargó en el hito equivocado · Documento duplicado" />
          </Field>
        </>}
      </Modal>

      {/* ---- editar tipo documental ---- */}
      <Modal open={!!tipoEdit} title={tipoEdit && `${PROCESO[tipoEdit.proceso]} · ${tipoEdit.nombre}`} onClose={() => setTipoEdit(null)} ancho
        footer={<>
          <button className="btn" onClick={() => setTipoEdit(null)} disabled={busy}>Cancelar</button>
          <button className="btn primary" onClick={enviarTipo} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </>}>
        {tipoEdit && <EditorTipo t={tipoEdit} set={setTipoEdit} hito={cat.hitos[tipoEdit.hito]} roles={cat.roles} />}
      </Modal>
    </div>
  );
}

// Archivos elegidos en el equipo, antes de subirlos.
function ListaLocal({ archivos }) {
  return (
    <ul className="doc-files" style={{ marginTop: 8 }}>
      {archivos.map((f, i) => <li key={i}><span>📄 {f.name}</span><small>{fmtBytes(f.size)}</small></li>)}
    </ul>
  );
}

function Checks({ opciones, valor, onChange, fijo = [] }) {
  const alternar = (k) => onChange(valor.includes(k) ? valor.filter((x) => x !== k) : [...valor, k]);
  return (
    <div className="checks">
      {opciones.map(([k, label]) => (
        <label key={k}>
          <input type="checkbox" checked={valor.includes(k)} disabled={fijo.includes(k)} onChange={() => alternar(k)} /> {label}
        </label>
      ))}
    </div>
  );
}

function EditorTipo({ t, set, hito, roles }) {
  const opRoles = roles.map((r) => [r, ROL_CORTO[r] ?? r]);
  return (<>
    <div className="grid g2" style={{ gap: 0, columnGap: 14 }}>
      <Field label="Responsable" hint="Quién debe aportar el documento.">
        <input value={t.responsable} onChange={(e) => set({ ...t, responsable: e.target.value })} />
      </Field>
      <Field label="Descripción">
        <input value={t.descripcion} onChange={(e) => set({ ...t, descripcion: e.target.value })} />
      </Field>
    </div>
    <Field label="Perfiles que lo cargan" hint="Pueden subir el documento y sus versiones. El coordinador siempre puede.">
      <Checks opciones={opRoles} valor={t.roles_carga} fijo={['coordinador']} onChange={(v) => set({ ...t, roles_carga: v })} />
    </Field>
    <Field label="Perfiles que solo lo consultan">
      <Checks opciones={opRoles.filter(([r]) => !t.roles_carga.includes(r) && r !== 'coordinador')} valor={t.roles_ver}
        onChange={(v) => set({ ...t, roles_ver: v })} />
    </Field>
    <Field label={`Exigible cuando el ${hito?.nombre.toLowerCase() ?? 'hito'} está`} hint="Sin marcar ninguno, el documento es opcional y nunca aparece como pendiente.">
      <Checks opciones={Object.entries(hito?.estados ?? {})} valor={t.exigible_en} onChange={(v) => set({ ...t, exigible_en: v })} />
    </Field>
    <label className="check-linea">
      <input type="checkbox" checked={t.vence} onChange={(e) => set({ ...t, vence: e.target.checked })} />
      <span><b>El documento vence</b><small>Se pide la fecha de vencimiento al cargarlo y se avisa antes de que venza.</small></span>
    </label>
    {t.vence && (
      <div className="grid g2" style={{ gap: 0, columnGap: 14 }}>
        <Field label="Vigencia típica (meses)" hint="Propone el vencimiento al cargar. Opcional.">
          <input type="number" min="1" max="120" value={t.vigencia_meses} onChange={(e) => set({ ...t, vigencia_meses: e.target.value })} />
        </Field>
        <Field label="Avisar con anticipación (días)">
          <input type="number" min="1" max="365" value={t.aviso_dias} onChange={(e) => set({ ...t, aviso_dias: e.target.value })} />
        </Field>
      </div>
    )}
    <label className="check-linea">
      <input type="checkbox" checked={t.activo} onChange={(e) => set({ ...t, activo: e.target.checked })} />
      <span><b>Tipo activo</b><small>Un tipo inactivo no admite cargas nuevas; sus documentos siguen a la vista.</small></span>
    </label>
  </>);
}
