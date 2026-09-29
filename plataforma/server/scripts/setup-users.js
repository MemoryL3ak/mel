// Crea (o restablece) los usuarios iniciales de la plataforma con bcrypt.
// Uso:  npm run setup:users            → contraseñas aleatorias, impresas UNA vez
//       npm run setup:users -- --demo  → contraseña fija "gea2026" (solo ambientes de prueba)
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { supa } from '../src/supa.js';

const demo = process.argv.includes('--demo');
const clave = () => (demo ? 'gea2026' : randomBytes(9).toString('base64url'));

const USUARIOS = [
  { username: 'coordinador', nombre: 'Coordinador Logístico MEL', role: 'coordinador' },
  { username: 'ito',         nombre: 'ITO Enajenación',           role: 'ito' },
  { username: 'vendor',      nombre: 'Empresa Vendor Chatarra',   role: 'vendor' },
  { username: 'limpieza',    nombre: 'Empresa Limpieza de Patios', role: 'limpieza' },
  { username: 'lampa',       nombre: 'Responsable de Lampa',       role: 'lampa' },
  { username: 'ventas',      nombre: 'Administrador Plataforma de Venta', role: 'admin_venta' },
];

const filas = [];
for (const u of USUARIOS) {
  const pass = clave();
  const password_hash = await bcrypt.hash(pass, 10);
  const { error } = await supa.from('users').upsert(
    { username: u.username, nombre: u.nombre, role: u.role, password_hash, activo: true },
    { onConflict: 'username' }
  );
  if (error) {
    // Los roles nuevos exigen su migración: 'lampa' → 0006, 'admin_venta' → 0007.
    // Si aún no se aplicó, se avisa y se sigue con el resto en vez de abortar.
    if (['lampa', 'admin_venta'].includes(u.role) && /users_role_check/.test(error.message)) {
      const mig = u.role === 'lampa' ? 'db/0006_review.sql' : 'db/0007_obsoletos.sql';
      console.warn(`• ${u.username}: falta aplicar ${mig} para el rol '${u.role}'. Se omite por ahora.`);
      continue;
    }
    console.error(`✗ ${u.username}: ${error.message}`); process.exit(1);
  }
  filas.push({ usuario: u.username, rol: u.role, contraseña: pass });
}

console.log('\nUsuarios creados/restablecidos. Guarda estas credenciales AHORA (no vuelven a mostrarse):\n');
console.table(filas);
if (demo) console.log('Modo --demo: contraseña única "gea2026". No usar en producción.\n');
