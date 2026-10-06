import {
  Building2,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  Network,
  Plus,
  RotateCcw,
  Search,
  UserRound,
} from 'lucide-react';
import type { ContactRecord, RecordType } from '../types/models';

const icon = { person: UserRound, company: Building2, institution: FolderKanban };
const label = { person: 'Persona', company: 'Ecosistema', institution: 'Proyecto' };

type SidebarProps = {
  open: boolean;
  onToggle: () => void;
  records: ContactRecord[];
  selectedId?: string;
  query: string;
  setQuery: (value: string) => void;
  filter: 'all' | RecordType;
  setFilter: (value: 'all' | RecordType) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onReset: () => void;
};

export default function Sidebar({
  open,
  onToggle,
  records,
  selectedId,
  query,
  setQuery,
  filter,
  setFilter,
  onSelect,
  onNew,
  onReset,
}: SidebarProps) {
  return (
    <>
      <aside className={`sidebar ${open ? 'panel-open' : 'panel-closed'}`} aria-hidden={!open}>
        <div className="brand">
          <span className="brand-mark"><Network size={20} /></span>
          <div><strong>Red de contactos</strong><small>Mapa de vínculos</small></div>
          <button className="panel-toggle inside" onClick={onToggle} aria-label="Ocultar panel de contactos" title="Ocultar panel"><ChevronLeft size={19} /></button>
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
        <div className="sidebar-actions">
          <button className="btn primary wide" onClick={onNew}><Plus size={17} /> Nuevo registro</button>
          <button className="reset" onClick={onReset}><RotateCcw size={15} /> Restablecer demo</button>
        </div>
      </aside>
      {!open && <button className="panel-reopen left" onClick={onToggle} aria-label="Mostrar panel de contactos" title="Mostrar Red de contactos"><ChevronRight size={22} /><Network size={18} /></button>}
    </>
  );
}
