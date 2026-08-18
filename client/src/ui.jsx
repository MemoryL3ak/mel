import { createContext, useContext, useRef, useState } from 'react';

/* ---------- marca ---------- */
export const BrandHex = ({ stroke = '#C46E3D', size = 44 }) => (
  <svg className="brand-hex" width={size} height={size} viewBox="0 0 44 44" aria-hidden="true">
    <path d="M22 2 39 12v20L22 42 5 32V12Z" fill="none" stroke={stroke} strokeWidth="2.5" />
    <path d="M22 12 31 17v10l-9 5-9-5V17Z" fill={stroke} />
  </svg>
);

/* ---------- piezas ---------- */
export const Chip = ({ tone = 'neutral', children }) => <span className={`chip ${tone}`}>{children}</span>;

export const KPI = ({ label, value, unit, delta }) => (
  <div className="card kpi">
    <div className="lbl">{label}</div>
    <div className="val">{value}{unit && <small> {unit}</small>}</div>
    {delta && <div className="delta">{delta}</div>}
  </div>
);

export const PageHead = ({ title, sub, children }) => (
  <div className="page-head">
    <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
    {children && <div className="head-actions">{children}</div>}
  </div>
);

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs">
      {tabs.map(([id, label]) => (
        <button key={id} className={`tab ${active === id ? 'active' : ''}`} onClick={() => onChange(id)}>{label}</button>
      ))}
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer }) {
  if (!open) return null;
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-h"><h3>{title}</h3><button className="modal-x" onClick={onClose}>✕</button></div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

export const Field = ({ label, children }) => (
  <div className="field"><label>{label}</label>{children}</div>
);

/* ---------- toast ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [msg, setMsg] = useState(null);
  const timer = useRef();
  const toast = (texto, err = false) => {
    setMsg({ texto, err });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 3000);
  };
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      {msg && (
        <div className={`toast ${msg.err ? 'err' : ''}`}>
          <span className="tick">{msg.err ? '✕' : '✓'}</span>{msg.texto}
        </div>
      )}
    </ToastCtx.Provider>
  );
}
