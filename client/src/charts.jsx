import { useState } from 'react';

const fmt = (n) => Math.round(n).toLocaleString('es-CL');
const TONO = { ok: '#3E8E5A', info: '#2a78d6', warn: '#C98500', bad: '#C0453A', neutral: '#948B80', copper: '#A4562E' };

function useTip() {
  const [tip, setTip] = useState(null);
  const move = (html) => (e) => {
    const r = e.currentTarget.closest('.chart-box').getBoundingClientRect();
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, html });
  };
  const leave = () => setTip(null);
  const el = tip && (
    <div className="tip" style={{ left: tip.x, top: tip.y }} dangerouslySetInnerHTML={{ __html: tip.html }} />
  );
  return { move, leave, el };
}

export function BarChart({ labels, data, unit = '', color = '#A4562E' }) {
  const { move, leave, el } = useTip();
  const W = 520, H = 230, P = { l: 38, r: 8, t: 14, b: 26 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const max = Math.max(10, Math.ceil((Math.max(...data) * 1.15) / 50) * 50);
  const bw = Math.min(30, (iw / data.length) * 0.55);
  return (
    <div className="chart-box">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gráfico de barras">
        {[0, 1, 2, 3, 4].map((i) => {
          const y = P.t + ih - (ih * i) / 4;
          return (
            <g key={i}>
              <line x1={P.l} y1={y} x2={W - P.r} y2={y} stroke={i ? 'var(--grid)' : 'var(--axis)'} strokeWidth="1" />
              <text x={P.l - 6} y={y + 3} textAnchor="end" fontSize="9.5" fill="var(--axis)">{fmt((max * i) / 4)}</text>
            </g>
          );
        })}
        {data.map((v, i) => {
          const x = P.l + (iw * (i + 0.5)) / data.length - bw / 2;
          const h = (ih * v) / max, y = P.t + ih - h;
          return (
            <g key={i}>
              <path d={`M${x} ${y + 4} q0-4 4-4 h${bw - 8} q4 0 4 4 V${P.t + ih} H${x}Z`} fill={color}
                onMouseMove={move(`${labels[i]} · <b>${fmt(v)}${unit}</b>`)} onMouseLeave={leave} />
              <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--axis)">{labels[i]}</text>
            </g>
          );
        })}
      </svg>
      {el}
    </div>
  );
}

export function LineChart({ labels, series, unit = ' M' }) {
  const { move, leave, el } = useTip();
  const W = 520, H = 230, P = { l: 38, r: 8, t: 14, b: 26 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const all = series.flatMap((s) => s.data);
  const max = Math.max(10, Math.ceil((Math.max(...all) * 1.15) / 20) * 20);
  const X = (i) => P.l + (iw * (i + 0.5)) / labels.length;
  const Y = (v) => P.t + ih - (ih * v) / max;
  return (
    <div className="chart-box">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gráfico de líneas">
        {[0, 1, 2, 3, 4].map((i) => {
          const y = P.t + ih - (ih * i) / 4;
          return (
            <g key={i}>
              <line x1={P.l} y1={y} x2={W - P.r} y2={y} stroke={i ? 'var(--grid)' : 'var(--axis)'} strokeWidth="1" />
              <text x={P.l - 6} y={y + 3} textAnchor="end" fontSize="9.5" fill="var(--axis)">{fmt((max * i) / 4)}</text>
            </g>
          );
        })}
        {labels.map((l, i) => (
          <text key={l + i} x={X(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--axis)">{l}</text>
        ))}
        {series.map((s) => (
          <g key={s.name}>
            <polyline points={s.data.map((v, i) => `${X(i)},${Y(v)}`).join(' ')} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
            {s.data.map((v, i) => (
              <circle key={i} cx={X(i)} cy={Y(v)} r="3.6" fill={s.color} stroke="var(--surface)" strokeWidth="2"
                onMouseMove={move(labels[i] + ' · ' + series.map((sr) => `${sr.name} <b>${fmt(sr.data[i])}${unit}</b>`).join(' · '))}
                onMouseLeave={leave} />
            ))}
          </g>
        ))}
      </svg>
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}
        </div>
      )}
      {el}
    </div>
  );
}

export function HBarChart({ rows, unit = '' }) {
  const { move, leave, el } = useTip();
  const W = 520, rh = 34, P = { l: 165, r: 62, t: 6 };
  const H = P.t + rows.length * rh + 6;
  const max = Math.max(1, ...rows.map((r) => r.v));
  return (
    <div className="chart-box">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gráfico de barras horizontales">
        {rows.map((r, i) => {
          const y = P.t + i * rh;
          const w = ((W - P.l - P.r) * r.v) / max;
          const color = TONO[r.tono] || TONO.copper;
          return (
            <g key={r.k}>
              <text x={P.l - 10} y={y + rh / 2 + 3} textAnchor="end" fontSize="11" fill="var(--ink-2)">{r.k}</text>
              <path d={`M${P.l} ${y + 8} h${Math.max(w - 4, 4)} q4 0 4 4 v${rh - 24} q0 4 -4 4 h-${Math.max(w - 4, 4)}Z`}
                fill={color} onMouseMove={move(`${r.k} · <b>${r.lbl ?? fmt(r.v) + unit}</b>`)} onMouseLeave={leave} />
              <text x={P.l + w + 8} y={y + rh / 2 + 3} fontSize="11" fontWeight="700" fill="var(--ink)">{r.lbl ?? fmt(r.v) + unit}</text>
            </g>
          );
        })}
      </svg>
      {el}
    </div>
  );
}

export const mesLabel = (m) => ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'][+m.slice(5, 7)];
