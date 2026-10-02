import { useState } from 'react';
import { api } from './api.js';
import { useAuth } from './auth.jsx';
import { Field, Modal, useToast } from './ui.jsx';

// Cambio de la propia contraseña.
//
// Las cuentas nacen con una clave generada que el coordinador entrega por fuera
// de la plataforma, así que la vio alguien más que su dueño. Al entrar con ella
// se ofrece reemplazarla; quien prefiera hacerlo después tiene la opción
// siempre disponible en el menú lateral.
export default function CambiarClave({ open, inicial, onClose }) {
  const { user, setUser } = useAuth();
  const [f, setF] = useState({ actual: '', nueva: '', repetir: '' });
  const [guardando, setGuardando] = useState(false);
  const toast = useToast();

  async function guardar() {
    if (f.nueva.length < 8) return toast('La nueva contraseña debe tener al menos 8 caracteres', true);
    if (f.nueva !== f.repetir) return toast('Las dos contraseñas nuevas no coinciden', true);
    setGuardando(true);
    try {
      await api('/auth/password', { method: 'POST', body: { actual: f.actual, nueva: f.nueva } });
      toast('Contraseña actualizada');
      setUser({ ...user, clave_inicial: false });
      setF({ actual: '', nueva: '', repetir: '' });
      onClose();
    } catch (e) { toast(e.message, true); }
    finally { setGuardando(false); }
  }

  return (
    <Modal open={open} title={inicial ? 'Defina su contraseña' : 'Cambiar contraseña'} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose} disabled={guardando}>
          {inicial ? 'Más tarde' : 'Cancelar'}
        </button>
        <button className="btn primary" onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar contraseña'}
        </button>
      </>}>
      {inicial && (
        <div className="aviso">
          <b>Está usando la contraseña que le entregaron</b>
          <p>Esa clave la generó el coordinador y viajó por correo o mensaje, así que la conoce más
          de una persona. Defina una propia para que su cuenta quede solo a su nombre: lo que haga
          con ella queda registrado en la bitácora con su nombre.</p>
        </div>
      )}
      <Field label="Contraseña actual" hint={inicial ? 'La que le entregaron.' : null}>
        <input type="password" value={f.actual} autoComplete="current-password"
          onChange={(e) => setF({ ...f, actual: e.target.value })} placeholder="••••••••" />
      </Field>
      <div className="grid g2" style={{ gap: 0, columnGap: 14 }}>
        <Field label="Nueva contraseña" hint="Mínimo 8 caracteres.">
          <input type="password" value={f.nueva} autoComplete="new-password"
            onChange={(e) => setF({ ...f, nueva: e.target.value })} placeholder="••••••••" />
        </Field>
        <Field label="Repita la nueva">
          <input type="password" value={f.repetir} autoComplete="new-password"
            onChange={(e) => setF({ ...f, repetir: e.target.value })} placeholder="••••••••" />
        </Field>
      </div>
    </Modal>
  );
}
