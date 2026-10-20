// Lectura de la planilla de materiales de MEL: la hoja de control que exporta
// su aplicativo, en CSV separado por «;» o en Excel (.xlsx). Una fila por
// material SAP. Aquí solo se interpreta el archivo: números en formato chileno,
// fechas dd-mm-aaaa (o celdas de fecha de Excel) y el estado de terreno escrito
// como texto («No contado 120 · Encontrado 80»). Qué se hace con cada fila lo
// decide el importador en routes/obsoletos.js.
import ExcelJS from 'exceljs';

// Columnas que se leen, por su título en la planilla. Se buscan sin importar
// mayúsculas, tildes ni espacios: así un retoque menor del título no rompe la
// importación.
const COLUMNAS = {
  key: 'KEY', aprobado: 'Aprobado', memo_ref: 'MEMO', area: 'Área', subarea: 'Sub-área',
  mrp_controller: 'MRP Controller', mrp_type: 'MRP Type', planificacion: 'Planificación',
  encontrado_el: 'Fecha encontrado', responsable: 'Responsable', despachado_el: 'Último despacho',
  ficha: 'Ficha técnica', planta: 'Plant', codigo: 'Material', nombre: 'Descripción',
  precio_unitario: 'Precio unitario', monto: 'Monto total', cantidad: 'Cantidad',
  storage_location: 'Storage Location', bodega: 'Bodega', bin: 'Storage Bin', estado: 'Estado',
  cant_encontrada: 'Ctd. encontrada', ubicacion_real: 'Ubicación real',
  cant_no_encontrada: 'Ctd. no encontrada', cant_despachada: 'Ctd. despachada',
  observacion: 'Observación', guias_gd: 'Guías (GD)', guias_gv: 'Guías de venta (GV)',
};
const OBLIGATORIAS = ['codigo', 'nombre', 'cantidad', 'aprobado'];

const normal = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

// Excel guarda el CSV en UTF-8 (con o sin BOM) o en el código de página de
// Windows, según la versión: se prueba UTF-8 y, si no calza, 1252.
export function decodificar(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, ''); }
  catch { return new TextDecoder('windows-1252').decode(buffer); }
}

// Separa una línea por «;» respetando las comillas con que Excel envuelve un
// texto que trae el separador adentro.
export function celdas(linea) {
  const out = [];
  let actual = '';
  let comillas = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (comillas) {
      if (ch === '"' && linea[i + 1] === '"') { actual += '"'; i++; }
      else if (ch === '"') comillas = false;
      else actual += ch;
    } else if (ch === '"' && actual === '') comillas = true;
    else if (ch === ';') { out.push(actual.trim()); actual = ''; }
    else actual += ch;
  }
  out.push(actual.trim());
  return out;
}

// Texto de una celda, venga del CSV (ya es texto) o de Excel (número, fecha,
// fórmula con su resultado, texto enriquecido…).
function texto(v) {
  if (v == null) return '';
  if (v instanceof Date) return fechaDeDate(v);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return texto(v.result);
    if ('text' in v) return texto(v.text);
    return '';
  }
  return String(v).trim();
}

// «$293.748 » → 293748 · «$ - » → null · «3.274» → 3274 · «0» → 0 · «1,5» → 1.5
// Un número que ya viene como número (celda de Excel) se devuelve tal cual.
export function numero(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v && typeof v === 'object' && 'result' in v) return numero(v.result);
  const t = texto(v).replace(/[$\s]/g, '');
  if (!t || t === '-') return null;
  const limpio = t.replace(/\./g, '').replace(',', '.');
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

// Las celdas de fecha de Excel llegan como Date en UTC a medianoche.
const fechaDeDate = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

// «01-10-2026» → «2026-10-01». Acepta también aaaa-mm-dd y celdas de fecha.
export function fecha(v) {
  if (v instanceof Date) return fechaDeDate(v);
  const t = texto(v);
  let m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{4}-\d{2}-\d{2})/.exec(t);
  return m ? m[1] : null;
}

const si = (v) => v === true || /^(s[ií]|yes|true|1)$/i.test(texto(v));

// Estado de la plataforma a partir de las cantidades contadas. Lo que no se ha
// contado sigue «por identificar»; basta una unidad encontrada para que el
// material esté confirmado en terreno (la cantidad dice cuántas); si solo se
// registró como no encontrado, es «no encontrado».
export function estadoDesde({ cant_encontrada, cant_no_encontrada }) {
  if ((cant_encontrada ?? 0) > 0) return 'planificado';
  if ((cant_no_encontrada ?? 0) > 0) return 'no_encontrado';
  return 'por_identificar';
}

// ---- lectura del archivo a una matriz de filas ----

const esXlsx = (buffer, nombre = '') => /\.xlsx$/i.test(nombre) || (buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b);

function matrizCsv(buffer) {
  return decodificar(buffer).split(/\r?\n/).filter((l) => l.trim()).map(celdas);
}

// Toma la hoja que tenga la fila de títulos («Material» y «Descripción»); si
// ninguna la tiene, la primera. Un .xls antiguo no se puede leer.
async function matrizXlsx(buffer) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buffer);
  const hojas = libro.worksheets.filter((h) => h.rowCount > 0);
  if (!hojas.length) return [];
  const aMatriz = (hoja) => {
    const filas = [];
    hoja.eachRow({ includeEmpty: false }, (row, n) => {
      const vals = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => { vals[c - 1] = cell.value; });
      filas[n - 1] = vals;
    });
    return filas.filter(Boolean);
  };
  const conTitulos = hojas.find((h) => aMatriz(h).slice(0, 10).some((f) => tieneTitulos(f)));
  return aMatriz(conTitulos ?? hojas[0]);
}

const tieneTitulos = (fila) => {
  const t = (fila ?? []).map((v) => normal(texto(v)));
  return t.includes(normal(COLUMNAS.codigo)) && t.includes(normal(COLUMNAS.nombre));
};

// Lee el archivo completo. Devuelve las filas interpretadas y las que se
// omitieron con su motivo. La fila «Total» del final no es un material.
export async function leerPlanilla(buffer, nombre = '') {
  let matriz;
  if (esXlsx(buffer, nombre)) {
    try { matriz = await matrizXlsx(buffer); }
    catch (e) { return { error: `No se pudo leer el Excel: ${e.message}. Guarde la planilla como .xlsx o como CSV.` }; }
  } else if (/\.xls$/i.test(nombre)) {
    return { error: 'El formato .xls antiguo no se puede leer: guarde la planilla como .xlsx o como CSV.' };
  } else {
    matriz = matrizCsv(buffer);
  }
  if (!matriz.length) return { error: 'El archivo está vacío' };

  // La fila de títulos puede no ser la primera (una hoja de Excel con un
  // encabezado arriba): se busca entre las primeras diez.
  const iTitulos = matriz.slice(0, 10).findIndex(tieneTitulos);
  if (iTitulos < 0) {
    return { error: `La planilla no trae las columnas «${COLUMNAS.codigo}» y «${COLUMNAS.nombre}». ¿Es el archivo de materiales exportado desde la hoja de control?` };
  }
  const titulos = matriz[iTitulos].map((v) => normal(texto(v)));
  const col = {};
  for (const [campo, titulo] of Object.entries(COLUMNAS)) {
    const i = titulos.indexOf(normal(titulo));
    if (i >= 0) col[campo] = i;
  }
  const faltan = OBLIGATORIAS.filter((c) => col[c] === undefined).map((c) => COLUMNAS[c]);
  if (faltan.length) return { error: `La planilla no trae estas columnas: ${faltan.join(', ')}.` };
  const v = (c, campo) => (col[campo] === undefined ? '' : (c[col[campo]] ?? ''));
  const t = (c, campo) => texto(v(c, campo));

  const filas = [];
  const omitidas = [];
  const vistos = new Map();
  for (let n = iTitulos + 1; n < matriz.length; n++) {
    const c = matriz[n];
    const key = t(c, 'key');
    const codigo = t(c, 'codigo');
    if (/^total$/i.test(key) || (!codigo && !t(c, 'nombre'))) continue;
    const fila = n + 1;   // número de fila como lo ve Excel
    if (!codigo) { omitidas.push({ fila, motivo: 'sin código de material' }); continue; }
    const nombre = t(c, 'nombre');
    if (!nombre) { omitidas.push({ fila, codigo, motivo: 'sin descripción' }); continue; }
    if (vistos.has(codigo)) { omitidas.push({ fila, codigo, motivo: `código repetido (ya venía en la fila ${vistos.get(codigo)})` }); continue; }
    vistos.set(codigo, fila);

    const cantidad = numero(v(c, 'cantidad'));
    const bodega = t(c, 'bodega');
    const bin = t(c, 'bin');
    const ubicacionReal = t(c, 'ubicacion_real');
    const ficha = t(c, 'ficha');
    const r = {
      fila, key, codigo, nombre,
      aprobado: si(v(c, 'aprobado')),
      memo_ref: t(c, 'memo_ref') || null,
      area: t(c, 'area') || null,
      subarea: t(c, 'subarea') || null,
      planta: t(c, 'planta') || null,
      mrp_controller: t(c, 'mrp_controller') || null,
      mrp_type: t(c, 'mrp_type') || null,
      storage_location: t(c, 'storage_location') || null,
      bodega: bodega || null, bin: bin || null,
      // La ubicación real (si el conteo la corrigió) manda sobre bodega + bin.
      ubicacion: ubicacionReal || [bodega, bin].filter(Boolean).join(' · ') || null,
      precio_unitario_clp: numero(v(c, 'precio_unitario')),
      monto_clp: numero(v(c, 'monto')),
      cantidad,
      cant_encontrada: numero(v(c, 'cant_encontrada')),
      cant_no_encontrada: numero(v(c, 'cant_no_encontrada')),
      cant_despachada: numero(v(c, 'cant_despachada')),
      estado_planilla: t(c, 'estado') || null,
      encontrado_el: fecha(v(c, 'encontrado_el')),
      despachado_el: fecha(v(c, 'despachado_el')),
      responsable: t(c, 'responsable') || null,
      ficha_sap: /^creada$/i.test(ficha) ? true : (ficha ? false : null),
      observacion: t(c, 'observacion') || null,
      guias_gd: t(c, 'guias_gd') || null,
      guias_gv: t(c, 'guias_gv') || null,
    };
    if (!(cantidad > 0)) {
      if (r.aprobado) omitidas.push({ fila, codigo, motivo: 'aprobado pero sin cantidad' });
      else continue;   // no aprobado y sin cantidad: no hay nada que mostrar
    } else {
      r.estado = estadoDesde(r);
      filas.push(r);
    }
  }
  return { filas, omitidas };
}

// Agrupa por área y sub-área: cada grupo recibe su memo en la importación.
export function agrupar(filas) {
  const grupos = new Map();
  for (const f of filas) {
    const clave = [f.area ?? 'Sin área', f.subarea ?? ''].filter(Boolean).join(' · ');
    if (!grupos.has(clave)) grupos.set(clave, { clave, area: f.area, subarea: f.subarea, memo_ref: null, filas: [] });
    const g = grupos.get(clave);
    g.filas.push(f);
    if (f.memo_ref && !g.memo_ref) g.memo_ref = f.memo_ref;
  }
  return [...grupos.values()].sort((a, b) => a.clave.localeCompare(b.clave, 'es'));
}
