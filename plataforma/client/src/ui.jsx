// Componentes base del sistema de diseño.
import { createContext, useContext, useState } from 'react';

export const Chip = ({ tone = 'neutral', children }) => <span className={`chip ${tone}`}>{children}</span>;

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
