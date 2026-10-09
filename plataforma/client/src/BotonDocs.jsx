import { useNavigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';

// Acceso al repositorio documental filtrado por un registro del proceso (una
// guía, un traslado, un EP, una adjudicación…). Desde ahí se ven sus
// documentos y se cargan los que falten, ya vinculados a ese registro.
export default function BotonDocs({ hito, refId, children = 'Documentos', className = 'btn sm' }) {
  const { can } = useAuth();
  const nav = useNavigate();
  if (!refId || !can('documentos')) return null;
  return (
    <button type="button" className={className} title="Documentos de este registro en el repositorio documental"
      onClick={() => nav(`/documentos?hito=${hito}&ref=${refId}`)}>
      {children}
    </button>
  );
}
