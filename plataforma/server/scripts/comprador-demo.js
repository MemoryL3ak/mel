// Crea (o restablece) una cuenta de comprador de prueba del portal de obsoletos,
// con la due diligence ya aprobada para poder ofertar de inmediato.
// Uso:  npm run demo:comprador
//       npm run demo:comprador -- otro@correo.cl otraClave
// Solo para ambientes de prueba: en producción los compradores se registran en
// el portal y un administrador aprueba su DD.
import bcrypt from 'bcryptjs';
import { supa } from '../src/supa.js';

const email = (process.argv[2] || 'comprador@demo.cl').toLowerCase().trim();
const pass = process.argv[3] || 'gea2026';
const RAZON = 'Comercial Demo Ltda.';
const RUT = '76543210-3';

const morir = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

const { data: existente } = await supa.from('users').select('id').eq('username', email).maybeSingle();
const fila = {
  username: email, nombre: RAZON, role: 'comprador',
  password_hash: await bcrypt.hash(pass, 10), activo: true,   // habilitada: la DD queda aprobada
};
const { data: user, error: eUser } = existente
  ? await supa.from('users').update(fila).eq('id', existente.id).select('id').single()
  : await supa.from('users').insert(fila).select('id').single();
if (eUser) morir(`usuario: ${eUser.message}`);

// El RUT es único: si el comprador ya existía se reapunta a esta cuenta.
const { data: previo } = await supa.from('compradores').select('id').ilike('rut', RUT).maybeSingle();
const comprador = {
  user_id: user.id, razon_social: RAZON, rut: RUT, email,
  telefono: '+56 9 1234 5678', dd_estado: 'aprobada', dd_nota: 'Cuenta de prueba',
};
const { error: eComp } = previo
  ? await supa.from('compradores').update(comprador).eq('id', previo.id)
  : await supa.from('compradores').insert(comprador);
if (eComp) morir(`comprador: ${eComp.message}`);

console.log('\nCuenta de comprador de prueba lista (due diligence aprobada):\n');
console.table([{ portal: '/portal', usuario: email, contraseña: pass, razón_social: RAZON, rut: RUT }]);

// Sin publicaciones vigentes no hay nada que ofertar: se avisa.
const { data: pubs } = await supa.from('publicaciones').select('componente_id,oferta_minima').eq('estado', 'activa');
if (!pubs?.length) {
  console.log('Aviso: no hay publicaciones activas. Publica un componente desde Publicaciones para poder ofertar.\n');
} else {
  const { data: comps } = await supa.from('componentes').select('id,codigo,nombre').in('id', pubs.map((p) => p.componente_id));
  const nombre = new Map(comps.map((c) => [c.id, `${c.codigo} · ${c.nombre}`]));
  console.log('Publicaciones abiertas a oferta:');
  for (const p of pubs) {
    const min = p.oferta_minima ? ` (mínimo $ ${Number(p.oferta_minima).toLocaleString('es-CL')})` : '';
    console.log(`  • ${nombre.get(p.componente_id) ?? p.componente_id}${min}`);
  }
  console.log('');
}
