import {
  Building2,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  LogIn,
  LogOut,
  Network,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Upload,
  UserRound,
} from 'lucide-react';
import type { ContactRecord, RecordType } from '../types/models';
import { MAX_NODES } from '../lib/nodeLimits';

const icon = { person: UserRound, company: Building2, institution: FolderKanban };
const label = { person: 'Persona', company: 'Ecosistema', institution: 'Proyecto' };

type SidebarProps = {
  open: boolean;
  onToggle: () => void;
  records: ContactRecord[];
  nodeCount: number;
  selectedId?: string;
  query: string;
  setQuery: (value: string) => void;
  filter: 'all' | RecordType;
  setFilter: (value: 'all' | RecordType) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onBulkImport: () => void;
  onReset: () => void;
  isAdmin: boolean;
  authLoading: boolean;
  adminEmail?: string;
  onLogin: () => void;
  onLogout: () => void;
};

export default function Sidebar({
  open,
  onToggle,
  records,
  nodeCount,
  selectedId,
  query,
  setQuery,
  filter,
  setFilter,
  onSelect,
  onNew,
  onBulkImport,
  onReset,
  isAdmin,
  authLoading,
  adminEmail,
  onLogin,
  onLogout,
}: SidebarProps) {
  return (
    <>
      <aside className={`sidebar ${open ? 'panel-open' : 'panel-closed'}`} aria-hidden={!open}>
        <div className="brand">
          <span className="brand-mark"><Network size={20} /></span>
          <div><strong>Red de contactos</strong><small>Mapa de vínculos</small></div>
          <button className="panel-toggle inside" onClick={onToggle} aria-label="Ocultar panel de contactos" title="Ocultar panel"><ChevronLeft size={19} /></button>
        </div>

        <div className="auth-control">
          {authLoading ? (
            <span className="auth-loading">Verificando sesión…</span>
          ) : isAdmin ? (
            <>
              <div className="auth-session" title={adminEmail}>
                <ShieldCheck size={16} />
                <span>Administrador</span>
              </div>
              <button type="button" className="auth-logout" onClick={onLogout}>
                <LogOut size={14} /> Cerrar sesión
              </button>
            </>
          ) : (
            <button type="button" className="auth-login" onClick={onLogin}>
              <LogIn size={16} /> Iniciar sesión
            </button>
          )}
        </div>

        <div className="search">
          <Search size={17} />
          <input aria-label="Buscar registros" placeholder="Buscar en la red..." value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="filters">
          {([
            ['all', 'Todos'],
            ['person', 'Personas'],
            ['company', 'Ecosistemas'],
            ['institution', 'Proyectos'],
          ] as const).map(([value, text]) => (
            <button className={filter === value ? 'active' : ''} key={value} onClick={() => setFilter(value)}>{text}</button>
          ))}
        </div>
        <div className="node-capacity" aria-label="Capacidad de nodos">
          Nodos: {nodeCount.toLocaleString('es-AR')} / {MAX_NODES.toLocaleString('es-AR')}
        </div>
        <div className="record-list">
          {records.map((record) => {
            const Icon = icon[record.type];
            return (
              <button key={record.id} className={'record-row ' + (selectedId === record.id ? 'selected' : '')} onClick={() => onSelect(record.id)}>
                <span className={'type-icon ' + record.type}><Icon size={16} /></span>
                <span><strong>{record.name}</strong><small>{label[record.type]}</small></span>
              </button>
            );
          })}
          {records.length === 0 && <div className="empty-list">No encontramos registros.</div>}
        </div>
        {isAdmin && (
          <div className="sidebar-actions">
            <button className="btn primary wide" onClick={onNew}><Plus size={17} /> Nuevo registro</button>
            <button className="btn primary wide" onClick={onBulkImport}><Upload size={17} /> Carga masiva</button>
            <button className="reset" onClick={onReset}><RotateCcw size={15} /> Restablecer demo</button>
          </div>
        )}
      </aside>
      {!open && <button className="panel-reopen left" onClick={onToggle} aria-label="Mostrar panel de contactos" title="Mostrar Red de contactos"><ChevronRight size={22} /><Network size={18} /></button>}
    </>
  );
}
