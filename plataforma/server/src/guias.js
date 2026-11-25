// Qué cuenta como «una guía». Una guía es el documento de despacho de MEL, no
// cada registro de la plataforma: los componentes obsoletos que viajaron con la
// misma guía de MEL son una sola (la «guía madre» de Despachos y de la
// cuadratura). Un despacho normal cuenta por sí mismo, tenga o no N° de guía.
// Todas las pantallas y planillas que dicen «N guías» cuentan con esto.
import { tiene } from './esquema.js';

export const unidadGuia = (d) => (d.componente_id && d.guia_mel ? `M:${String(d.guia_mel).trim()}` : `D:${d.id}`);

export const contarGuias = (filas) => new Set(filas.map(unidadGuia)).size;

// Columnas de `despachos` que hacen falta para contar (según lo que la base tenga).
export const colsGuia = () => `id${tiene.guia_mel ? ', guia_mel' : ''}${tiene.desp_componente ? ', componente_id' : ''}`;
