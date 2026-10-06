import { useEffect, useState } from 'react';
import Modal from './Modal';
import type { ContactRecord, RecordType } from '../types/models';

type RecordModalProps = {
  record?: ContactRecord;
  onClose: () => void;
  onSave: (record: ContactRecord) => void;
};

export default function RecordModal({ record, onClose, onSave }: RecordModalProps) {
  const [type, setType] = useState<RecordType>(record?.type || 'person');
  const [name, setName] = useState(record?.name || '');
  const [description, setDescription] = useState(record?.description || '');
  const [email, setEmail] = useState(record?.email || '');
  const [location, setLocation] = useState(record?.location || '');

  useEffect(() => {}, []);

  return (
    <Modal title={record ? 'Editar registro' : 'Nuevo registro'} onClose={onClose}>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        onSave({
          id: record?.id || crypto.randomUUID(),
          name: name.trim(),
          description: description.trim(),
          email: email.trim() || undefined,
          location: location.trim() || undefined,
          type,
        });
      }}>
        <div className="form-grid">
          <label>
            Tipo
            <select value={type} onChange={(event) => setType(event.target.value as RecordType)}>
              <option value="person">Persona</option>
              <option value="company">Ecosistema</option>
              <option value="institution">Proyecto</option>
            </select>
          </label>
          <label>
            Nombre *
            <input autoFocus required value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="full">
            Descripción
            <textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          {type !== 'institution' && (
            <label>
              Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
          )}
          <label>
            Ubicación
            <input value={location} onChange={(event) => setLocation(event.target.value)} />
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>Cancelar</button>
          <button className="btn primary">Guardar</button>
        </div>
      </form>
    </Modal>
  );
}
