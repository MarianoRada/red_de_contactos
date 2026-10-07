import { useCallback, useEffect, useMemo, useState } from 'react';

import Sidebar from './components/Sidebar';
import DetailsPanel from './components/DetailsPanel';
import NetworkGraph from './graph/NetworkGraph';
import RecordModal from './components/RecordModal';
import RelationshipModal from './components/RelationshipModal';

import {
  loadData,
  createRecord,
  updateRecord as updateRecordApi,
  deleteRecord as deleteRecordApi,
  createRelationship,
  deleteRelationship as deleteRelationshipApi,
} from './lib/api';

import type {
  AppData,
  ContactRecord,
  RecordType,
  Relationship,
} from './types/models';

const EMPTY_DATA: AppData = {
  records: [],
  relationships: [],
};

export default function App() {
  const [data, setData] = useState<AppData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | RecordType>('all');

  const [recordModal, setRecordModal] =
    useState<'new' | 'edit' | null>(null);

  const [relationModal, setRelationModal] = useState(false);

  // Los paneles laterales comienzan cerrados
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);

  // ==========================================
  // CARGA INICIAL DESDE D1
  // ==========================================

  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(undefined);

        const loadedData = await loadData();

        if (!cancelled) {
          setData(loadedData);
        }
      } catch (err) {
        console.error(err);

        if (!cancelled) {
          setError(
            'No se pudieron cargar los datos.'
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchData();

    return () => {
      cancelled = true;
    };
  }, []);

  const selected = data.records.find(
    (record) => record.id === selectedId
  );

  const shown = useMemo(
    () =>
      data.records.filter(
        (record) =>
          (filter === 'all' || record.type === filter) &&
          `${record.name} ${record.description} ${record.location || ''}`
            .toLowerCase()
            .includes(query.toLowerCase())
      ),
    [data.records, filter, query]
  );

  // ==========================================
  // RECORDS
  // ==========================================

  const saveRecord = async (record: ContactRecord) => {
    try {
      setError(undefined);

      if (recordModal === 'edit') {
        const savedRecord = await updateRecordApi(record);

        setData((currentData) => ({
          ...currentData,
          records: currentData.records.map((currentRecord) =>
            currentRecord.id === savedRecord.id
              ? savedRecord
              : currentRecord
          ),
        }));
      } else {
        const savedRecord = await createRecord(record);

        setData((currentData) => ({
          ...currentData,
          records: [
            ...currentData.records,
            savedRecord,
          ],
        }));
      }

      setSelectedId(record.id);
      setRecordModal(null);
    } catch (err) {
      console.error(err);

      setError(
        recordModal === 'edit'
          ? 'No se pudo actualizar el registro.'
          : 'No se pudo crear el registro.'
      );
    }
  };

  const removeRecord = async () => {
    if (
      !selected ||
      !confirm(
        `¿Eliminar “${selected.name}” y todas sus relaciones?`
      )
    ) {
      return;
    }

    try {
      setError(undefined);

      await deleteRecordApi(selected.id);

      setData((currentData) => ({
        records: currentData.records.filter(
          (record) => record.id !== selected.id
        ),
        relationships: currentData.relationships.filter(
          (relationship) =>
            relationship.sourceId !== selected.id &&
            relationship.targetId !== selected.id
        ),
      }));

      setSelectedId(undefined);
    } catch (err) {
      console.error(err);

      setError(
        'No se pudo eliminar el registro.'
      );
    }
  };

  // ==========================================
  // RELATIONSHIPS
  // ==========================================

  const saveRel = async (
    relationship: Relationship
  ) => {
    try {
      setError(undefined);

      const savedRelationship =
        await createRelationship(relationship);

      setData((currentData) => ({
        ...currentData,
        relationships: [
          ...currentData.relationships,
          savedRelationship,
        ],
      }));

      setRelationModal(false);
    } catch (err) {
      console.error(err);

      setError(
        'No se pudo crear la relación.'
      );
    }
  };

  const removeRel = async (id: string) => {
    if (!confirm('¿Eliminar esta relación?')) {
      return;
    }

    try {
      setError(undefined);

      await deleteRelationshipApi(id);

      setData((currentData) => ({
        ...currentData,
        relationships:
          currentData.relationships.filter(
            (relationship) =>
              relationship.id !== id
          ),
      }));
    } catch (err) {
      console.error(err);

      setError(
        'No se pudo eliminar la relación.'
      );
    }
  };

  // ==========================================
  // GRAPH
  // ==========================================

  const handleGraphSelect = useCallback(
    (id: string) => {
      if (selectedId === id) {
        setRightOpen(true);
      } else {
        setSelectedId(id);
      }
    },
    [selectedId]
  );

  const clearGraphSelection = useCallback(
    () => setSelectedId(undefined),
    []
  );

  // ==========================================
  // LOADING
  // ==========================================

  if (loading) {
    return (
      <main className="app-shell">
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          Cargando red...
        </div>
      </main>
    );
  }

  // ==========================================
  // APP
  // ==========================================

  return (
    <main
      className={`app-shell ${
        leftOpen ? 'left-open' : 'left-closed'
      } ${
        rightOpen ? 'right-open' : 'right-closed'
      }`}
    >
      {error && (
        <div
          style={{
            position: 'fixed',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            background: '#fff',
            padding: '10px 16px',
            borderRadius: 8,
            boxShadow:
              '0 4px 20px rgba(0, 0, 0, 0.15)',
          }}
        >
          {error}
        </div>
      )}

      <Sidebar
        open={leftOpen}
        onToggle={() =>
          setLeftOpen((value) => !value)
        }
        records={shown}
        selectedId={selectedId}
        query={query}
        setQuery={setQuery}
        filter={filter}
        setFilter={setFilter}
        onSelect={setSelectedId}
        onNew={() => setRecordModal('new')}

        // Reset de datos eliminado.
        // D1 es ahora la fuente de verdad.
        onReset={() => {}}
      />

      <NetworkGraph
        records={data.records}
        relationships={data.relationships}
        selectedId={selectedId}
        onSelect={handleGraphSelect}
        onClear={clearGraphSelection}
      />

      <DetailsPanel
        open={rightOpen}
        onToggle={() =>
          setRightOpen((value) => !value)
        }
        record={selected}
        records={data.records}
        relationships={data.relationships}
        onSelect={setSelectedId}
        onEdit={() => setRecordModal('edit')}
        onDelete={removeRecord}
        onAddRelation={() =>
          setRelationModal(true)
        }
        onDeleteRelation={removeRel}
      />

      {recordModal && (
        <RecordModal
          record={
            recordModal === 'edit'
              ? selected
              : undefined
          }
          onClose={() =>
            setRecordModal(null)
          }
          onSave={saveRecord}
        />
      )}

      {relationModal && selected && (
        <RelationshipModal
          current={selected}
          records={data.records}
          relationships={data.relationships}
          onClose={() =>
            setRelationModal(false)
          }
          onSave={saveRel}
        />
      )}
    </main>
  );
}