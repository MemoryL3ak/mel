import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmtUSD } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Select, Chip, Field, Logo, Modal, useToast } from '../ui.jsx';

// Portal público de venta de obsoletos. Consulta sin credenciales; para ofertar
// hay que registrarse (crea cuenta), pasar due diligence e iniciar sesión.
// Página autónoma con identidad propia: el comprador es externo y nunca ve el
// panel interno, así que aquí no se reusa el layout de la aplicación.
const DD = { aprobada: ['ok', 'Habilitado para ofertar'], pendiente: ['warn', 'Due diligence en revisión'], rechazada: ['bad', 'Registro no aprobado'] };
const EST_OF = { recibida: ['info', 'Recibida'], adjudicada: ['ok', 'Adjudicada'], descartada: ['neutral', 'No adjudicada'] };

// El cierre manda sobre el precio: una publicación vencida deja de recibir ofertas.
const ORDEN = {
  cierre: (a, b) => a.dias_restantes - b.dias_restantes,
  menor: (a, b) => (a.oferta_minima ?? Infinity) - (b.oferta_minima ?? Infinity),
  mayor: (a, b) => (b.oferta_minima ?? -Infinity) - (a.oferta_minima ?? -Infinity),
  nombre: (a, b) => String(a.componente).localeCompare(String(b.componente), 'es'),
};

const diasTxt = (n) => (n <= 0 ? 'Último día' : n === 1 ? 'Vence mañana' : `${n} días`);
const diasTono = (n) => (n <= 1 ? 'bad' : n <= 5 ? 'warn' : '');

const SinFoto = ({ size = 46 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#EDEAE6" strokeWidth="1.2" opacity=".8">
    <circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.6" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </svg>
);
const IcoLupa = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" strokeWidth="2.1" strokeLinecap="round">
    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" />
  </svg>
);
const IcoPin = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" />
  </svg>
);
const IcoDoc = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--copper)" strokeWidth="1.7">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" />
  </svg>
);

export default function Portal() {
  const { user, login, logout } = useAuth();
  const nav = useNavigate();
  const esComprador = user?.role === 'comprador';
  const [pubs, setPubs] = useState(null);
  const [cuenta, setCuenta] = useState(null);
  const [misOfertas, setMisOfertas] = useState([]);
  const [registro, setRegistro] = useState(false);
  const [acceso, setAcceso] = useState(false);
  const [oferta, setOferta] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [abriendo, setAbriendo] = useState(null);   // id en curso: evita doble clic
  const [foto, setFoto] = useState(0);
  const [busqueda, setBusqueda] = useState('');
  const [sitioF, setSitioF] = useState('');
  const [orden, setOrden] = useState('cierre');
  const [rf, setRf] = useState({ razon_social: '', rut: '', email: '', telefono: '', password: '' });
  const [lf, setLf] = useState({ email: '', password: '' });
  const [of, setOf] = useState({ monto: '', plazo_retiro: '5 días hábiles', forma_pago: 'Transferencia 100%', comentarios: '' });
  const toast = useToast();

  const cargarPubs = () => api('/portal/publicaciones').then(setPubs).catch(() => setPubs([]));
  useEffect(() => { cargarPubs(); }, []);
  useEffect(() => {
    if (!esComprador) { setCuenta(null); setMisOfertas([]); return; }
    api('/portal/mi-cuenta').then(setCuenta).catch(() => {});
    api('/portal/mis-ofertas').then(setMisOfertas).catch(() => {});
  }, [esComprador]);

  async function registrar() {
    try {
      const r = await api('/portal/registro', { method: 'POST', body: rf });
      toast(r.mensaje || 'Registro recibido');
      setRegistro(false); setRf({ razon_social: '', rut: '', email: '', telefono: '', password: '' });
    } catch (e) { toast(e.message, true); }
  }
  async function ingresar() {
    try {
      const u = await login(lf.email.trim().toLowerCase(), lf.password);
      if (u.role !== 'comprador') { logout(); return toast('Esa cuenta no es de comprador. Use el acceso interno de la plataforma.', true); }
      toast(`Bienvenido, ${u.name}`);
      setAcceso(false); setLf({ email: '', password: '' });
    } catch (e) { toast(e.message, true); }
  }
  async function enviarOferta() {
    try {
      const r = await api('/portal/ofertas', { method: 'POST', body: {
        publicacion_id: oferta.id, monto: Number(String(of.monto).replace(/\D/g, '')),
        plazo_retiro: of.plazo_retiro, forma_pago: of.forma_pago, comentarios: of.comentarios } });
      toast(r.mensaje || 'Oferta registrada');
      setOferta(null); setOf({ ...of, monto: '', comentarios: '' });
      api('/portal/mis-ofertas').then(setMisOfertas).catch(() => {});
    } catch (e) { toast(e.message, true); }
  }

  // Ficha del componente: fotos y ficha técnica se piden recién al abrirla,
  // porque sus URLs vienen firmadas y solo duran una hora.
  async function abrirDetalle(p) {
    if (abriendo) return;
    setAbriendo(p.id);
    try {
      const d = await api(`/portal/publicaciones/${p.id}`);
      setDetalle(d); setFoto(0);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      toast(e.message, true);
      if (/cerr|no encontrada/i.test(e.message)) cargarPubs();   // la publicación ya venció
    } finally { setAbriendo(null); }
  }

  // Salida del portal hacia el panel interno. Con sesión de comprador hay que
  // cerrarla primero: su rol no ve ninguna pantalla interna y "/" lo devolvería
  // al portal, dejándolo encerrado aquí.
  const irInterno = () => { if (esComprador) logout(); nav('/'); };

  const puedeOfertar = esComprador && cuenta?.dd_estado === 'aprobada';
  const clickOferta = (p) => {
    if (!esComprador) return setAcceso(true);
    if (!puedeOfertar) return toast('Su due diligence aún no está aprobada.', true);
    setOferta(p); setOf((s) => ({ ...s, monto: '' }));
  };

  const sitios = [...new Set((pubs ?? []).map((p) => p.sitio).filter(Boolean))].sort();
  const texto = busqueda.trim().toLowerCase();
  const lista = (pubs ?? [])
    .filter((p) => !sitioF || p.sitio === sitioF)
    .filter((p) => !texto || `${p.componente} ${p.codigo ?? ''} ${p.especificaciones ?? ''}`.toLowerCase().includes(texto))
    .sort(ORDEN[orden] ?? ORDEN.cierre);
  const filtrando = !!texto || !!sitioF;

  return (
    <div className="pt">
      <nav className="pt-nav">
        <div className="pt-in">
          <div className="pt-brand">
            <Logo size={30} />
            <div><b>Venta de activos</b><small>Minera Escondida</small></div>
          </div>
          <div className="pt-nav-act">
            <button className="pt-b plain" onClick={irInterno}
              title={esComprador ? 'Cierra su sesión de comprador y vuelve al acceso interno' : 'Ir al panel interno de GEA'}>
              ← Plataforma interna
            </button>
            {esComprador ? (<>
              <span className="pt-who">{user.name}</span>
              <button className="pt-b ghost" onClick={logout}>Salir</button>
            </>) : (<>
              <button className="pt-b ghost" onClick={() => setAcceso(true)}>Ingresar</button>
              <button className="pt-b cta" onClick={() => setRegistro(true)}>Registrarse</button>
            </>)}
          </div>
        </div>
      </nav>

      {!detalle && (
        <header className="pt-hero">
          <div className="pt-in">
            <div className="pt-eyebrow">Enajenación de activos · Antofagasta, Chile</div>
            <h1>Componentes industriales en venta</h1>
            <p>Equipos y componentes dados de baja por Minera Escondida Limitada, disponibles
              para su compra mediante presentación de ofertas. Cada publicación recibe ofertas
              por un plazo acotado y se adjudica con una matriz de evaluación.</p>
            <div className="pt-stats">
              <div className="pt-stat"><b>{pubs?.length ?? '—'}</b><small>Publicaciones vigentes</small></div>
              <div className="pt-stat"><b>15</b><small>Días de plazo por aviso</small></div>
              <div className="pt-stat"><b>USD</b><small>Moneda de transacción</small></div>
            </div>
          </div>
        </header>
      )}

      <main className="pt-body">
        <div className="pt-in">
          {esComprador && cuenta && (
            <div className="card" style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <b>{cuenta.razon_social}</b>
              <Chip tone={DD[cuenta.dd_estado]?.[0] ?? 'neutral'}>{DD[cuenta.dd_estado]?.[1] ?? cuenta.dd_estado}</Chip>
              {cuenta.dd_estado !== 'aprobada' && <small style={{ color: 'var(--muted)' }}>Podrá ofertar cuando su due diligence quede aprobada.</small>}
            </div>
          )}

          {/* ───────────────────────── ficha de detalle ───────────────────────── */}
          {detalle ? (<>
            <button className="pt-back" onClick={() => setDetalle(null)}>← Volver al catálogo</button>
            <div className="pt-det">
              <div>
                <div className="pt-gal-main">
                  {detalle.fotos?.length
                    ? <img src={detalle.fotos[Math.min(foto, detalle.fotos.length - 1)]} alt={detalle.componente} />
                    : <SinFoto size={64} />}
                </div>
                {detalle.fotos?.length > 1 && (
                  <div className="pt-thumbs">
                    {detalle.fotos.map((u, i) => (
                      <button key={u} className={`pt-thumb${i === foto ? ' on' : ''}`} onClick={() => setFoto(i)}
                        aria-label={`Foto ${i + 1} de ${detalle.fotos.length}`}>
                        <img src={u} alt="" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-info">
                <h2>{detalle.componente}</h2>
                <ul className="pt-facts">
                  {detalle.codigo && <li><span>Código SKU</span><b className="mono">{detalle.codigo}</b></li>}
                  {detalle.sitio && <li><span>Sitio</span><b>{detalle.sitio}</b></li>}
                  {detalle.ubicacion && <li><span>Ubicación</span><b>{detalle.ubicacion}</b></li>}
                  <li><span>Publicado el</span><b className="mono">{detalle.publicado_el}</b></li>
                  <li><span>Cierre de ofertas</span><b style={diasTono(detalle.dias_restantes) ? { color: 'var(--bad-tx)' } : undefined}>
                    {diasTxt(detalle.dias_restantes)}</b></li>
                </ul>

                {detalle.oferta_minima != null && (
                  <div className="pt-price"><small>Oferta mínima</small><b>{fmtUSD(detalle.oferta_minima)}</b></div>
                )}

                {detalle.ficha && (
                  <a className="pt-ficha" href={detalle.ficha.url} target="_blank" rel="noreferrer">
                    <IcoDoc />
                    <div><b>Ficha técnica</b><small>{detalle.ficha.tipo}</small></div>
                    <span className="pt-dl">Descargar ↓</span>
                  </a>
                )}

                {detalle.especificaciones && (
                  <div className="pt-desc"><h4>Especificaciones</h4><p>{detalle.especificaciones}</p></div>
                )}

                <div className="pt-act">
                  <button className="btn primary" onClick={() => clickOferta(detalle)}>
                    {esComprador ? 'Presentar oferta' : 'Ingresar para ofertar'}
                  </button>
                  {!esComprador && <div className="pt-note">Para ofertar debe registrarse y aprobar la due diligence.</div>}
                  {esComprador && !puedeOfertar && <div className="pt-note">Su due diligence aún está en revisión.</div>}
                </div>
              </div>
            </div>
          </>) : (<>
            {/* ───────────────────────── catálogo ───────────────────────── */}
            {pubs == null && <div className="loading">Cargando publicaciones…</div>}

            {pubs?.length > 0 && (
              <div className="pt-bar">
                <div className="pt-search">
                  <IcoLupa />
                  <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
                    placeholder="Buscar por componente, SKU o especificación…" aria-label="Buscar publicaciones" />
                </div>
                {sitios.length > 1 && (
                  <div className="pt-f">
                    <Select value={sitioF} onChange={(e) => setSitioF(e.target.value)}>
                      <option value="">Todos los sitios</option>
                      {sitios.map((s) => <option key={s} value={s}>{s}</option>)}
                    </Select>
                  </div>
                )}
                <div className="pt-f">
                  <Select value={orden} onChange={(e) => setOrden(e.target.value)}>
                    <option value="cierre">Próximos a cerrar</option>
                    <option value="menor">Menor precio</option>
                    <option value="mayor">Mayor precio</option>
                    <option value="nombre">Nombre (A-Z)</option>
                  </Select>
                </div>
                <span className="pt-count">{lista.length} de {pubs.length}</span>
              </div>
            )}

            {pubs && pubs.length === 0 && (
              <div className="empty" style={{ marginTop: 30 }}><b>No hay publicaciones vigentes</b>Vuelva a consultar más adelante.</div>
            )}
            {pubs?.length > 0 && lista.length === 0 && (
              <div className="empty" style={{ marginTop: 20 }}><b>Sin resultados</b>Ninguna publicación coincide con su búsqueda.</div>
            )}

            <div className="pt-grid">
              {lista.map((p) => (
                <div key={p.id} className="pt-card" role="button" tabIndex={0}
                  aria-disabled={abriendo === p.id} onClick={() => abrirDetalle(p)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirDetalle(p); } }}>
                  <div className="pt-shot">
                    {p.foto ? <img src={p.foto} alt={p.componente} /> : <SinFoto />}
                    <span className={`pt-days ${diasTono(p.dias_restantes)}`}>{diasTxt(p.dias_restantes)}</span>
                  </div>
                  <div className="pt-cbody">
                    {p.codigo && <span className="pt-sku">{p.codigo}</span>}
                    <h3>{p.componente}</h3>
                    <span className="pt-spec">{p.especificaciones || 'Sin especificaciones registradas.'}</span>
                    {p.sitio && <span className="pt-place"><IcoPin /> {p.sitio}</span>}
                    <div className="pt-cfoot">
                      <div className="pt-min">
                        {p.oferta_minima != null
                          ? <><small>Oferta mínima</small><b>{fmtUSD(p.oferta_minima)}</b></>
                          : <><small>Oferta mínima</small><b>A convenir</b></>}
                      </div>
                      <span className="pt-more">{abriendo === p.id ? 'Abriendo…' : 'Ver ficha →'}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {esComprador && misOfertas.length > 0 && (
              <div className="card" style={{ marginTop: 28 }}>
                <div className="card-h"><h3>Mis ofertas</h3><small>{misOfertas.length}</small></div>
                <div className="tbl-wrap"><table>
                  <thead><tr><th>Componente</th><th className="num">Monto</th><th>Plazo de retiro</th><th>Estado</th></tr></thead>
                  <tbody>
                    {misOfertas.map((o) => (
                      <tr key={o.id}>
                        <td><b>{o.componente}</b><br /><small className="mono" style={{ color: 'var(--muted)' }}>{o.codigo}</small></td>
                        <td className="num">{fmtUSD(o.monto)}</td>
                        <td>{o.plazo_retiro || '—'}</td>
                        <td><Chip tone={EST_OF[o.estado]?.[0] ?? 'neutral'}>{EST_OF[o.estado]?.[1] ?? o.estado}</Chip></td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              </div>
            )}
          </>)}
        </div>
      </main>

      <footer className="pt-foot">
        <div className="pt-in">
          <span>Minera Escondida Limitada · Enajenación de activos · Antofagasta, Chile</span>
          <span>Las ofertas se evalúan con matriz de adjudicación. Los montos se expresan en dólares (USD).</span>
        </div>
      </footer>

      <Modal open={registro} title="Registro de comprador" onClose={() => setRegistro(false)}
        footer={<><button className="btn" onClick={() => setRegistro(false)}>Cancelar</button><button className="btn primary" onClick={registrar}>Crear cuenta</button></>}>
        <div className="grid g2" style={{ gap: 0, columnGap: 14 }}>
          <Field label="Razón social"><input value={rf.razon_social} onChange={(e) => setRf({ ...rf, razon_social: e.target.value })} placeholder="Empresa SpA" /></Field>
          <Field label="RUT"><input value={rf.rut} onChange={(e) => setRf({ ...rf, rut: e.target.value })} placeholder="76.XXX.XXX-X" /></Field>
          <Field label="Correo (será su usuario)"><input value={rf.email} onChange={(e) => setRf({ ...rf, email: e.target.value })} placeholder="contacto@empresa.cl" /></Field>
          <Field label="Teléfono"><input value={rf.telefono} onChange={(e) => setRf({ ...rf, telefono: e.target.value })} placeholder="+56 9 …" /></Field>
        </div>
        <Field label="Contraseña" hint="Mínimo 8 caracteres. La usará para ingresar a ofertar una vez aprobada la due diligence.">
          <input type="password" value={rf.password} onChange={(e) => setRf({ ...rf, password: e.target.value })} placeholder="••••••••" />
        </Field>
        <small style={{ color: 'var(--muted)' }}>El registro pasa por verificación y due diligence antes de habilitar la presentación de ofertas.</small>
      </Modal>

      <Modal open={acceso} title="Ingresar a ofertar" onClose={() => setAcceso(false)}
        footer={<><button className="btn" onClick={() => setAcceso(false)}>Cancelar</button><button className="btn primary" onClick={ingresar}>Ingresar</button></>}>
        <Field label="Correo"><input value={lf.email} onChange={(e) => setLf({ ...lf, email: e.target.value })} placeholder="contacto@empresa.cl" /></Field>
        <Field label="Contraseña"><input type="password" value={lf.password} onChange={(e) => setLf({ ...lf, password: e.target.value })} placeholder="••••••••" /></Field>
        <small style={{ color: 'var(--muted)' }}>Su cuenta se habilita cuando aprobamos la due diligence. ¿No tiene cuenta? Regístrese primero.</small>
      </Modal>

      <Modal open={!!oferta} title={oferta && `Presentar oferta · ${oferta.componente}`} onClose={() => setOferta(null)}
        footer={<><button className="btn" onClick={() => setOferta(null)}>Cancelar</button><button className="btn primary" onClick={enviarOferta}>Enviar oferta</button></>}>
        <Field label="Monto ofertado (USD)"><input value={of.monto} onChange={(e) => setOf({ ...of, monto: e.target.value })} placeholder="31500" /></Field>
        <div className="grid g2" style={{ gap: 0, columnGap: 14 }}>
          <Field label="Plazo de retiro comprometido">
            <Select value={of.plazo_retiro} onChange={(e) => setOf({ ...of, plazo_retiro: e.target.value })}>
              <option>5 días hábiles</option><option>10 días hábiles</option><option>15 días hábiles</option>
            </Select>
          </Field>
          <Field label="Forma de pago">
            <Select value={of.forma_pago} onChange={(e) => setOf({ ...of, forma_pago: e.target.value })}>
              <option>Transferencia 100%</option><option>50% + 50% a 30 días</option><option>Otra (indicar en comentarios)</option>
            </Select>
          </Field>
        </div>
        <Field label="Comentarios"><textarea rows="2" value={of.comentarios} onChange={(e) => setOf({ ...of, comentarios: e.target.value })} placeholder="Condiciones, equipos de izaje, etc." /></Field>
        {oferta?.oferta_minima != null && <small style={{ color: 'var(--muted)' }}>Oferta mínima de esta publicación: {fmtUSD(oferta.oferta_minima)}.</small>}
      </Modal>
    </div>
  );
}
