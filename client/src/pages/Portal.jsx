import { useEffect, useState } from 'react';
import { api, fmtCLP } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Chip, Field, Modal, PageHead, useToast } from '../ui.jsx';

const CONTACTO = {
  wsp: '56955550000', // número de demostración
  correo: 'ventas.componentes@gea-escondida.cl',
};

// Ficha técnica imprimible: se abre en una ventana lista para imprimir o guardar como PDF
function generarFicha(p, diasTxt) {
  const w = window.open('', '_blank', 'width=760,height=920');
  if (!w) return;
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Ficha ${p.codigo} · GEA</title>
<style>
  body{font-family:Archivo,system-ui,sans-serif;color:#24201B;margin:0;background:#fff}
  .top{background:#232930;color:#EDEAE6;padding:26px 34px;display:flex;justify-content:space-between;align-items:center}
  .top b{font-size:20px;letter-spacing:.06em}
  .top small{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#9AA3AC}
  .cod{font-family:monospace;font-size:13px;background:#A4562E;color:#fff;border-radius:6px;padding:4px 12px}
  main{padding:30px 34px;max-width:640px}
  h1{font-size:24px;margin:0 0 4px}
  .sub{color:#6B6259;margin:0 0 22px}
  table{border-collapse:collapse;width:100%;font-size:14px;margin-bottom:22px}
  td{padding:9px 0;border-bottom:1px solid #EFEBE4;vertical-align:top}
  td:first-child{width:200px;color:#948B80;font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:700}
  .precio{font-size:22px;font-weight:800;color:#83421F}
  .cond{background:#FAF8F5;border:1px solid #E5E0D8;border-radius:10px;padding:14px 18px;font-size:13px;color:#6B6259}
  .contacto{margin-top:18px;font-size:13.5px}
  .contacto b{color:#83421F}
  .foot{margin-top:26px;padding-top:14px;border-top:1px solid #E5E0D8;font-size:11px;color:#948B80}
  .btn-print{position:fixed;right:22px;bottom:22px;background:#A4562E;color:#fff;border:0;border-radius:8px;padding:11px 20px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit}
  @media print{.btn-print{display:none}}
</style></head><body>
<div class="top"><div><b>GEA</b><small>Venta de componentes · Minera Escondida</small></div><span class="cod">${p.codigo}</span></div>
<main>
  <h1>${p.nombre}</h1>
  <p class="sub">Ficha técnica de publicación · portal público de venta</p>
  <table>
    <tr><td>Descripción</td><td>${p.descripcion}</td></tr>
    <tr><td>Oferta mínima</td><td class="precio">$ ${p.valor_ref.toLocaleString('es-CL')} CLP</td></tr>
    <tr><td>Plazo de publicación</td><td>${diasTxt}</td></tr>
    <tr><td>Publicado el</td><td>${p.publicado_el}</td></tr>
    <tr><td>Retiro</td><td>En faena, coordinado con Logística MEL tras la adjudicación</td></tr>
  </table>
  <div class="cond">Condiciones: venta en el estado en que se encuentra («as is, where is»). Para ofertar se requiere registro de comprador con due diligence aprobada. Pago por transferencia según bases; comisión y baja del activo según contrato.</div>
  <div class="contacto">Consultas: <b>WhatsApp +56 9 5555 0000</b> · <b>${CONTACTO.correo}</b></div>
  <div class="foot">Documento generado por la plataforma GEA · datos de demostración · los plazos se rigen por la publicación vigente en el portal</div>
</main>
<button class="btn-print" onclick="print()">Imprimir / guardar PDF</button>
</body></html>`);
  w.document.close();
}

const TONO = {
  steel: 'linear-gradient(140deg,#5A6B7C,#38434E)',
  copper: 'linear-gradient(140deg,#8C6A4E,#5C4232)',
  green: 'linear-gradient(140deg,#4E6B5A,#324538)',
  violet: 'linear-gradient(140deg,#6B5E7C,#453B52)',
};
const ICONS = {
  steel: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.6" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
  copper: <><path d="M3 16 5 8h14l2 8Z" /><path d="M5 16v3h14v-3" /><circle cx="8" cy="20" r="1.4" /><circle cx="16" cy="20" r="1.4" /></>,
  green: <><circle cx="7" cy="12" r="4.4" /><circle cx="17" cy="12" r="4.4" /></>,
  violet: <><path d="M4 8h16M4 12h16M4 16h16" /><circle cx="7" cy="8" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="17" cy="16" r="1.6" fill="currentColor" stroke="none" /></>,
};

export default function Portal() {
  const [pubs, setPubs] = useState(null);
  const [misOfertas, setMisOfertas] = useState([]);
  const [oferta, setOferta] = useState(null);
  const [form, setForm] = useState({ monto: '', plazo_retiro: '5 días hábiles', forma_pago: 'Transferencia 100%', comentarios: '' });
  const [registro, setRegistro] = useState(false);
  const [reg, setReg] = useState({ razon_social: '', rut: '', email: '', telefono: '' });
  const { user } = useAuth();
  const toast = useToast();
  const esComprador = user.role === 'comprador';

  const load = () => {
    api('/public/publicaciones').then(setPubs).catch((e) => toast(e.message, true));
    if (esComprador) api('/public/mis-ofertas').then(setMisOfertas).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  if (!pubs) return <div className="loading">Cargando portal…</div>;

  async function ofertar() {
    try {
      await api('/public/ofertas', { method: 'POST', body: { componente_id: oferta.id, ...form, monto: +form.monto } });
      toast('Oferta registrada — recibirá confirmación por correo');
      setOferta(null); setForm({ ...form, monto: '', comentarios: '' });
      load();
    } catch (e) { toast(e.message, true); }
  }
  async function registrar() {
    try {
      const r = await api('/public/compradores', { method: 'POST', body: reg });
      toast(r.mensaje);
      setRegistro(false); setReg({ razon_social: '', rut: '', email: '', telefono: '' });
    } catch (e) { toast(e.message, true); }
  }

  return (
    <div className="page">
      <PageHead title="Portal público de venta"
        sub={esComprador
          ? 'Publicaciones vigentes. Puede presentar ofertas y seguir el estado de sus adjudicaciones.'
          : 'Vista del comprador externo — acceso sin credenciales para consultar; registro y due diligence para ofertar.'} />
      <div className="browser">
        <div className="browser-bar"><i /><i /><i /><span className="browser-url">https://venta.gea-escondida.cl</span></div>
        <div className="portal-hd">
          <div><h2>Venta de componentes industriales</h2><p>Publicaciones vigentes · Minera Escondida Limitada · Antofagasta, Chile</p></div>
          {!esComprador && <button className="btn" style={{ background: '#fff' }} onClick={() => setRegistro(true)}>Registrarse como comprador</button>}
        </div>
        <div className="portal-grid">
          {pubs.map((p) => (
            <div className="pcard" key={p.id}>
              <div className="pimg" style={{ background: TONO[p.tono] || TONO.steel }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">{ICONS[p.tono] || ICONS.steel}</svg>
              </div>
              <div className="pbody">
                <b>{p.nombre}</b>
                <span className="specs">{p.descripcion}</span>
                <span className="pprice">Oferta mínima {fmtCLP(p.valor_ref)}</span>
                <div className="pfoot">
                  <Chip tone={p.dias_restantes <= 1 ? 'bad' : 'info'}>
                    {p.dias_restantes <= 0 ? 'Cierra hoy' : p.dias_restantes === 1 ? 'Vence mañana' : `${p.dias_restantes} días restantes`}
                  </Chip>
                  <button className="btn sm primary" disabled={!esComprador}
                    title={esComprador ? '' : 'Inicie sesión como comprador para ofertar'}
                    onClick={() => { setOferta(p); setForm({ ...form, monto: String(p.valor_ref) }); }}>
                    Presentar oferta
                  </button>
                </div>
                <div className="pcontact">
                  <button className="btn sm" onClick={() => generarFicha(p, p.dias_restantes === 1 ? 'Vence mañana' : `${p.dias_restantes} días restantes`)}>
                    ⎙ Generar ficha
                  </button>
                  <a className="btn sm" href={`https://wa.me/${CONTACTO.wsp}?text=${encodeURIComponent(`Consulta por publicación ${p.codigo} · ${p.nombre}`)}`}
                    target="_blank" rel="noreferrer">WhatsApp</a>
                  <a className="btn sm" href={`mailto:${CONTACTO.correo}?subject=${encodeURIComponent(`Consulta ${p.codigo} · ${p.nombre}`)}`}>Correo</a>
                </div>
              </div>
            </div>
          ))}
          {!pubs.length && <div className="loading">No hay publicaciones vigentes.</div>}
        </div>
      </div>

      {esComprador && misOfertas.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-h"><h3>Mis ofertas</h3><small>{user.name}</small></div>
          <div className="tbl-wrap"><table>
            <thead><tr><th>Componente</th><th>Fecha</th><th className="num">Monto</th><th>Estado</th></tr></thead>
            <tbody>
              {misOfertas.map((o) => (
                <tr key={o.id}>
                  <td>{o.componente} <span className="mono" style={{ color: 'var(--muted)' }}>{o.codigo}</span></td>
                  <td>{o.fecha}</td><td className="num">{fmtCLP(o.monto)}</td>
                  <td>{o.estado === 'adjudicada' ? <Chip tone="ok">Adjudicada</Chip>
                    : o.estado === 'no_adjudicada' ? <Chip tone="neutral">No adjudicada</Chip>
                    : <Chip tone="info">En evaluación</Chip>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      <Modal open={!!oferta} title={`Presentar oferta · ${oferta?.nombre}`} onClose={() => setOferta(null)}
        footer={<>
          <button className="btn" onClick={() => setOferta(null)}>Cancelar</button>
          <button className="btn primary" onClick={ofertar}>Enviar oferta</button>
        </>}>
        <Field label="Empresa oferente"><input value={user.name} readOnly /></Field>
        <Field label="Monto ofertado (CLP)"><input type="number" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} /></Field>
        <Field label="Plazo de retiro comprometido">
          <select value={form.plazo_retiro} onChange={(e) => setForm({ ...form, plazo_retiro: e.target.value })}>
            <option>5 días hábiles</option><option>10 días hábiles</option><option>15 días hábiles</option>
          </select>
        </Field>
        <Field label="Forma de pago">
          <select value={form.forma_pago} onChange={(e) => setForm({ ...form, forma_pago: e.target.value })}>
            <option>Transferencia 100%</option><option>50% + 50% a 30 días</option>
          </select>
        </Field>
        <Field label="Comentarios"><textarea rows="2" value={form.comentarios} onChange={(e) => setForm({ ...form, comentarios: e.target.value })} placeholder="Condiciones, equipos de izaje, etc." /></Field>
        <small style={{ color: 'var(--muted)' }}>Al ofertar acepta las bases de venta. Su oferta queda en el cuadro comparativo del administrador.</small>
      </Modal>

      <Modal open={registro} title="Registro de comprador" onClose={() => setRegistro(false)}
        footer={<>
          <button className="btn" onClick={() => setRegistro(false)}>Cancelar</button>
          <button className="btn primary" onClick={registrar}>Crear cuenta</button>
        </>}>
        <div className="grid g2" style={{ gap: 10 }}>
          <Field label="Razón social"><input value={reg.razon_social} onChange={(e) => setReg({ ...reg, razon_social: e.target.value })} placeholder="Empresa SpA" /></Field>
          <Field label="RUT"><input value={reg.rut} onChange={(e) => setReg({ ...reg, rut: e.target.value })} placeholder="76.XXX.XXX-X" /></Field>
          <Field label="Correo de contacto"><input value={reg.email} onChange={(e) => setReg({ ...reg, email: e.target.value })} placeholder="contacto@empresa.cl" /></Field>
          <Field label="Teléfono"><input value={reg.telefono} onChange={(e) => setReg({ ...reg, telefono: e.target.value })} placeholder="+56 9 …" /></Field>
        </div>
        <small style={{ color: 'var(--muted)' }}>El registro pasa por verificación y due diligence antes de habilitar la presentación de ofertas.</small>
      </Modal>
    </div>
  );
}
