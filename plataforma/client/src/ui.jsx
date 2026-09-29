// Componentes base del sistema de diseño.
import { createContext, useContext, useState, useRef, useEffect, Children, isValidElement } from 'react';

export const Chip = ({ tone = 'neutral', children }) => <span className={`chip ${tone}`}>{children}</span>;

// Desplegable propio de la plataforma: reemplaza al <select> nativo para que el
// menú abierto siga el lenguaje visual (y el modo oscuro) en vez del popup del
// sistema operativo. Es un reemplazo directo — mantiene los mismos <option>,
// `value` y `onChange` (que recibe {target:{value}}), así el resto del código
// no cambia. Accesible: role listbox/option, teclado y cierre por foco/Escape.
export function Select({ value, onChange, children, disabled, placeholder, id }) {
  const [open, setOpen] = useState(false);
  const [activo, setActivo] = useState(-1);
  const [arriba, setArriba] = useState(false);
  const box = useRef(null);
  const menu = useRef(null);

  const opts = Children.toArray(children)
    .filter((c) => isValidElement(c) && c.type === 'option')
    .map((c) => ({ value: c.props.value ?? '', label: c.props.children, disabled: !!c.props.disabled }));
  const val = value ?? '';
  const idx = opts.findIndex((o) => String(o.value) === String(val));
  const sel = idx >= 0 ? opts[idx] : null;
  const etiqueta = sel ? sel.label : (placeholder ?? '');

  // Cierre al hacer clic fuera.
  useEffect(() => {
    if (!open) return;
    const fuera = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [open]);

  // Al abrir: ítem activo en el seleccionado, y decide si abre hacia arriba
  // cuando no hay espacio suficiente abajo (p. ej. cerca del pie de un modal).
  useEffect(() => {
    if (open) {
      setActivo(idx >= 0 ? idx : 0);
      const rect = box.current?.getBoundingClientRect();
      if (rect) setArriba(window.innerHeight - rect.bottom < 264 && rect.top > window.innerHeight - rect.bottom);
      requestAnimationFrame(() => menu.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const elegir = (o) => { if (o.disabled) return; onChange?.({ target: { value: String(o.value) } }); setOpen(false); box.current?.focus(); };
  const mover = (d) => {
    setActivo((a) => {
      let n = a;
      do { n = (n + d + opts.length) % opts.length; } while (opts[n]?.disabled && n !== a);
      menu.current?.querySelectorAll('.sel-opt')[n]?.scrollIntoView({ block: 'nearest' });
      return n;
    });
  };
  const teclas = (e) => {
    if (disabled) return;
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); setOpen(true); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); mover(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); mover(-1); }
    else if (e.key === 'Home') { e.preventDefault(); setActivo(0); }
    else if (e.key === 'End') { e.preventDefault(); setActivo(opts.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (opts[activo]) elegir(opts[activo]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key === 'Tab') setOpen(false);
    else if (e.key.length === 1) {
      // Type-ahead: salta a la opción cuyo texto empieza por la tecla.
      const t = e.key.toLowerCase();
      const txt = (o) => String(o.label ?? '').toLowerCase();
      const desde = activo + 1;
      const orden = [...opts.slice(desde), ...opts.slice(0, desde)];
      const hit = orden.find((o) => !o.disabled && txt(o).startsWith(t));
      if (hit) setActivo(opts.indexOf(hit));
    }
  };

  return (
    <div className={`sel${open ? ' open' : ''}${disabled ? ' disabled' : ''}`} ref={box}>
      <button type="button" id={id} className="sel-btn" disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} onKeyDown={teclas}
        onClick={() => !disabled && setOpen((o) => !o)}>
        <span className={`sel-val${sel ? '' : ' ph'}`}>{etiqueta || ' '}</span>
        <svg className="sel-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <ul className={`sel-menu${arriba ? ' arriba' : ''}`} role="listbox" ref={menu} tabIndex={-1}>
          {opts.map((o, i) => (
            <li key={i} role="option" aria-selected={String(o.value) === String(val)}
              className={`sel-opt${i === activo ? ' activo' : ''}${o.disabled ? ' off' : ''}${String(o.value) === String(val) ? ' checked' : ''}`}
              onMouseEnter={() => setActivo(i)} onMouseDown={(e) => { e.preventDefault(); elegir(o); }}>
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Calendario propio: reemplaza al <input type="date"> nativo con la marca y el
// modo oscuro. Drop-in: `value` es ISO 'YYYY-MM-DD' y `onChange` recibe
// {target:{value}} (vacío al borrar). Lunes primero, con "Hoy" y "Borrar".
const DIAS_SEM = ['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const pad2 = (n) => String(n).padStart(2, '0');
const isoLocal = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const hoyISO = () => isoLocal(new Date());
const parseISO = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const fmtDMY = (s) => { const d = parseISO(s); return d ? `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}` : ''; };

export function DateField({ value, onChange, disabled, id }) {
  const [open, setOpen] = useState(false);
  const [arriba, setArriba] = useState(false);
  const [vista, setVista] = useState(() => { const d = parseISO(value) || new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const box = useRef(null);

  useEffect(() => {
    if (!open) return;
    const d = parseISO(value) || new Date();
    setVista({ y: d.getFullYear(), m: d.getMonth() });
    const r = box.current?.getBoundingClientRect();
    if (r) setArriba(window.innerHeight - r.bottom < 360 && r.top > window.innerHeight - r.bottom);
    const fuera = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const cerrar = () => { setOpen(false); box.current?.querySelector('.dp-btn')?.focus(); };
  const elegir = (d) => { onChange?.({ target: { value: isoLocal(d) } }); cerrar(); };
  const mes = (delta) => setVista((v) => { const d = new Date(v.y, v.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });

  const off = (new Date(vista.y, vista.m, 1).getDay() + 6) % 7;   // lunes primero
  const dias = Array.from({ length: 42 }, (_, i) => new Date(vista.y, vista.m, 1 - off + i));
  const hoy = isoLocal(new Date());

  return (
    <div className={`dp${disabled ? ' disabled' : ''}`} ref={box}>
      <button type="button" id={id} className="dp-btn" disabled={disabled}
        aria-haspopup="dialog" aria-expanded={open}
        onKeyDown={(e) => { if (!open && ['Enter', ' ', 'ArrowDown'].includes(e.key)) { e.preventDefault(); setOpen(true); } else if (e.key === 'Escape') cerrar(); }}
        onClick={() => !disabled && setOpen((o) => !o)}>
        <span className={value ? '' : 'ph'}>{fmtDMY(value) || 'dd-mm-aaaa'}</span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></svg>
      </button>
      {open && (
        <div className={`dp-pop${arriba ? ' arriba' : ''}`} role="dialog">
          <div className="dp-head">
            <button type="button" className="dp-nav" onClick={() => mes(-1)} aria-label="Mes anterior">‹</button>
            <b>{MESES[vista.m]} {vista.y}</b>
            <button type="button" className="dp-nav" onClick={() => mes(1)} aria-label="Mes siguiente">›</button>
          </div>
          <div className="dp-sem">{DIAS_SEM.map((d) => <span key={d}>{d}</span>)}</div>
          <div className="dp-grid">
            {dias.map((d, i) => {
              const iso = isoLocal(d);
              return (
                <button type="button" key={i}
                  className={`dp-day${d.getMonth() !== vista.m ? ' fuera' : ''}${iso === value ? ' sel' : ''}${iso === hoy ? ' hoy' : ''}`}
                  onClick={() => elegir(d)}>{d.getDate()}</button>
              );
            })}
          </div>
          <div className="dp-foot">
            <button type="button" className="dp-link" onClick={() => { onChange?.({ target: { value: '' } }); cerrar(); }}>Borrar</button>
            <button type="button" className="dp-link" onClick={() => elegir(new Date())}>Hoy</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PageHead({ eyebrow = 'Fase 1 · Proceso de chatarra', title, sub, children }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

export function Avatar({ name, className = 'avatar' }) {
  const ini = (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return <span className={className} aria-hidden="true">{ini}</span>;
}

export function Field({ label, hint, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <small>{hint}</small>}
    </div>
  );
}

/* ---- peso con unidad ---- */
// La plataforma guarda SIEMPRE kilos, pero las básculas se leen tanto en kg
// como en toneladas. El campo deja elegir la unidad y muestra la equivalencia
// para que nunca haya duda de la cifra que va a quedar registrada.
const UNIDAD_PREF = 'gea_unidad_peso';
export const unidadGuardada = () => (localStorage.getItem(UNIDAD_PREF) === 't' ? 't' : 'kg');
export const aKg = (valor, unidad) => {
  const n = parseFloat(String(valor ?? '').replace(',', '.'));
  if (!(n > 0)) return null;
  return Math.round((unidad === 't' ? n * 1000 : n) * 10) / 10;
};
// Kilos de la base → texto en la unidad que prefiere quien está operando.
export const desdeKg = (kg) => {
  const unidad = unidadGuardada();
  return { valor: String(unidad === 't' ? Number(kg) / 1000 : Number(kg)), unidad };
};

export function CampoPeso({ label, hint, valor, unidad, onValor, onUnidad }) {
  const kg = aKg(valor, unidad);
  const cambiar = (u) => { localStorage.setItem(UNIDAD_PREF, u); onUnidad(u); };
  return (
    <Field label={label} hint={hint}>
      <div className="peso">
        <input type="number" min="0" step={unidad === 't' ? '0.01' : '1'} value={valor}
          onChange={(e) => onValor(e.target.value)} placeholder="0" />
        <div className="peso-u" role="group" aria-label="Unidad del pesaje">
          {['kg', 't'].map((u) => (
            <button key={u} type="button" className={u === unidad ? 'on' : ''}
              aria-pressed={u === unidad} onClick={() => cambiar(u)}>{u}</button>
          ))}
        </div>
      </div>
      {kg != null && (
        <div className="peso-eq">
          Se registrará <b>{kg.toLocaleString('es-CL', { maximumFractionDigits: 1 })} kg</b>
          {unidad === 'kg' && kg >= 1000 && <> · equivale a {(kg / 1000).toLocaleString('es-CL', { maximumFractionDigits: 2 })} t</>}
        </div>
      )}
    </Field>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs">
      {tabs.map(([id, label, badge]) => (
        <button key={id} className={`tab ${active === id ? 'active' : ''}`} onClick={() => onChange(id)}>
          {label}{badge > 0 && <span className="badge">{badge}</span>}
        </button>
      ))}
    </div>
  );
}

// `ancho` para los modales que muestran una tabla: a 560 px las columnas se
// cortan y quedan fuera de vista, que es justo lo que hay que evitar.
export function Modal({ open, title, onClose, footer, children, ancho }) {
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${ancho ? ' ancho' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-h"><h3>{title}</h3><button onClick={onClose} aria-label="Cerrar">×</button></div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ title, children }) {
  return <div className="empty"><b>{title}</b>{children}</div>;
}

export const KPI = ({ label, value, unit, delta, ico }) => (
  <div className="card kpi">
    {ico && (
      <span className="ico">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ico}</svg>
      </span>
    )}
    <div>
      <div className="lbl">{label}</div>
      <div className="val">{value}{unit && <small> {unit}</small>}</div>
      {delta && <div className="delta">{delta}</div>}
    </div>
  </div>
);

/* ---- toasts ---- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = (msg, err = false) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, msg, err }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4200);
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast ${t.err ? 'err' : ''}`}>{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---- logo GEA ---- */
export const Logo = ({ size = 34 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <path d="M16 2 28 9v14L16 30 4 23V9Z" fill="#A4562E" />
    <path d="M16 7l8 4.6v9.2L16 25.4 8 20.8v-9.2Z" fill="#232930" />
    <path d="M16 12l4 2.3v4.6L16 21.2l-4-2.3v-4.6Z" fill="#DE8A52" />
  </svg>
);
