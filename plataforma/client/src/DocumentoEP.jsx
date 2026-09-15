// Estado de pago en el formato del contrato (el mismo del formulario que usa
// la Gerencia W&L). Se genera con los datos ya registrados en la plataforma:
// nada se digita dos veces. Imprimible en una hoja.

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const corta = (iso) => {
  if (!iso) return '—';
  const [a, m, d] = String(iso).split('-');
  return `${d}-${MESES[+m - 1]}-${a.slice(2)}`;
};
const larga = (iso) => {
  if (!iso) return '—';
  const [a, m, d] = String(iso).split('-');
  return `${d}-${MESES[+m - 1]}-${a}`;
};
const clp = (n) => (n == null ? '—' : Number(n) === 0 ? '0' : Number(n).toLocaleString('es-CL', { maximumFractionDigits: 0 }));

const Fila = ({ glosa, valor, sangria, dato, fuerte }) => (
  <tr className={fuerte ? 'f' : ''}>
    <td className={sangria ? 'sg' : ''}>{glosa}</td>
    <td className="mo">CLP</td>
    <td className={`vl ${dato ? 'dato' : ''}`}>{valor}</td>
  </tr>
);

export default function DocumentoEP({ ep, contrato }) {
  const actualizado = Number(contrato.monto_original) + Number(contrato.modificaciones);
  return (
    <div className="doc-ep">
      <div className="d-pres">
        Fecha de Presentación: <span className="dato">{larga(ep.presentado_el)}</span>
      </div>

      <header className="d-head">
        <div className="d-marca">ESCONDIDA <span>|</span> BHP</div>
        <div className="d-ger">{contrato.gerencia}</div>
        <div className="d-contrato">Contrato N° {contrato.numero || '—'}</div>
        <div className="d-tit">{contrato.mandante}</div>
        <div className="d-tit">{contrato.glosa}</div>
        <div className="d-tit b">ESTADO DE PAGO</div>
        <div className="d-ep">
          <span>EP N°</span><span className="dato">{ep.numero ?? '—'}</span>
          <span>Rev.</span><span className="dato">{ep.revision ?? 0}</span>
        </div>
        <div className="d-ep">
          <span><b>Desde el</b></span><span className="dato">{corta(ep.desde)}</span>
          <span><b>hasta el</b></span><span className="dato">{corta(ep.hasta)}</span>
        </div>
      </header>

      <table className="d-tbl">
        <tbody>
          <Fila glosa="MONTO ORIGINAL DEL CONTRATO" valor={clp(contrato.monto_original)} dato />
          <Fila glosa="MODIFICACIONES" valor={clp(contrato.modificaciones)} dato />
          <Fila glosa="MONTO ACTUALIZADO DEL CONTRATO" valor={clp(actualizado)} fuerte />
        </tbody>
      </table>

      <table className="d-tbl">
        <tbody>
          <tr><td colSpan="3" className="d-sec">ESTADOS DE PAGO <small>(Neto sin Retención)</small></td></tr>
          <Fila glosa="ACUMULADOS AL EDP ANTERIOR" valor={clp(ep.acumulado_anterior)} sangria />
          <Fila glosa="PRESENTE EDP" valor={clp(ep.total)} sangria />
          <Fila glosa="ACUMULADO AL PRESENTE EDP" valor={clp(ep.acumulado_presente)} sangria />
          <tr><td colSpan="3" className="d-sec">DEVOLUCIÓN DE ANTICIPO</td></tr>
          <Fila glosa="ACUMULADO AL EDP ANTERIOR" valor={clp(0)} sangria />
          <Fila glosa="PRESENTE EDP" valor={clp(ep.anticipo)} sangria dato />
          <Fila glosa="ACUMULADO AL PRESENTE EDP" valor={clp(ep.anticipo)} sangria />
        </tbody>
      </table>

      <table className="d-tbl">
        <tbody>
          <tr><td colSpan="3" className="d-sec">TOTALES</td></tr>
          <Fila glosa="TOTAL NETO A FACTURAR MONEDA CONTRATO" valor={clp(ep.total)} sangria />
          <tr>
            <td className="sg pq">Tasa de cambio al <span className="dato">N/A</span></td>
            <td className="mo">CLP / CLP</td>
            <td className="vl tasa">1,00</td>
          </tr>
          <Fila glosa="TOTAL NETO A FACTURAR CLP" valor={clp(ep.total)} fuerte />
        </tbody>
      </table>

      <table className="d-tbl">
        <tbody>
          <tr><td colSpan="3" className="d-sec">CÁLCULO IVA</td></tr>
          <Fila glosa="VALOR NO AFECTO A IVA" valor={clp(ep.no_afecto_iva)} sangria dato />
          <Fila glosa="VALOR AFECTO A IVA" valor={clp(ep.afecto_iva)} sangria />
          <Fila glosa={`IVA ${Number(ep.iva_pct)}%`} valor={clp(ep.iva)} sangria />
          <Fila glosa="TOTAL NETO MÁS IVA" valor={clp(ep.total_con_iva)} fuerte />
        </tbody>
      </table>

      <div className="d-firmas">
        <div>
          <small>Por</small>
          <b>{contrato.mandante}</b>
          <div className="linea" />
          <small>( firma )</small>
          <div className="nom">Nombre: {contrato.firma_mandante || '—'}</div>
          <div className="nom">{ep.firmado_el ? `Fecha: ${ep.firmado_el}` : 'Fecha: ______________'}</div>
        </div>
        <div>
          <small>Por</small>
          <b>{contrato.contratista || '—'}</b>
          <div className="linea" />
          <small>( firma )</small>
          <div className="nom">Nombre: {contrato.firma_contratista || '—'}</div>
          <div className="nom">Fecha: ______________</div>
        </div>
      </div>
    </div>
  );
}
