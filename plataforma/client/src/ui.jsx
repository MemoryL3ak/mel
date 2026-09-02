// Componentes base del sistema de diseño.
import { createContext, useContext, useState } from 'react';

export const Chip = ({ tone = 'neutral', children }) => <span className={`chip ${tone}`}>{children}</span>;

export function PageHead({ title, sub, children }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {children && <div className="actions">{children}</div>}
    </div>
  );
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

export function Modal({ open, title, onClose, footer, children }) {
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
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

export const KPI = ({ label, value, unit, delta }) => (
  <div className="card kpi">
    <div className="lbl">{label}</div>
    <div className="val">{value}{unit && <small> {unit}</small>}</div>
    {delta && <div className="delta">{delta}</div>}
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
