import bcrypt from 'bcryptjs';
const { supa, q } = await import('file:///C:/mel/plataforma/server/src/supa.js');
const u = await q(supa.from('users').select('id,username').eq('username','coordinador').maybeSingle());
if (!u) { console.error('no existe coordinador'); process.exit(1); }
const { error } = await supa.from('users').update({ password_hash: await bcrypt.hash('tmp_ev_123', 10) }).eq('id', u.id);
console.log(error ? 'ERROR: ' + error.message : 'clave temporal puesta');
