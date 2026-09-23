import { useEffect, useMemo, useState } from 'react';

import Sidebar from './components/Sidebar';
import DetailsPanel from './components/DetailsPanel';
import NetworkGraph from './graph/NetworkGraph';
import RecordModal from './components/RecordModal';
import RelationshipModal from './components/RelationshipModal';

import {
  loadData,
  resetData,
  saveData,
} from './lib/storage';

import {
  addRecord,
  addRelationship,
  deleteRecord,
  deleteRelationship,
  updateRecord,
} from './lib/relations';

import type {
  AppData,
  ContactRecord,
  RecordType,
  Relationship,
} from './types/models';

export default function App() {
  const [data, setData] = useState<AppData>(() => loadData());

  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | RecordType>('all');

  const [recordModal, setRecordModal] = useState<'new' | 'edit' | null>(null);
  const [relationModal, setRelationModal] = useState(false);

  // Los paneles laterales comienzan cerrados
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);

  useEffect(() => {
    saveData(data);
  }, [data]);

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

  const saveRecord = (record: ContactRecord) => {
    setData((currentData) =>
      recordModal === 'edit'
        ? updateRecord(currentData, record)
        : addRecord(currentData, record)
    );

    setSelectedId(record.id);
    setRecordModal(null);
  };

  const removeRecord = () => {
    if (
      !selected ||
      !confirm(
        `¿Eliminar “${selected.name}” y todas sus relaciones?`
      )
    ) {
      return;
    }

    setData((currentData) =>
      deleteRecord(currentData, selected.id)
    );

    setSelectedId(undefined);
  };

  const saveRel = (relationship: Relationship) => {
    setData((currentData) =>
      addRelationship(currentData, relationship)
    );

    setRelationModal(false);
  };

  const removeRel = (id: string) => {
    if (confirm('¿Eliminar esta relación?')) {
      setData((currentData) =>
        deleteRelationship(currentData, id)
      );
    }
  };

  const reset = () => {
    if (
      confirm(
        'Esto eliminará los cambios realizados y restaurará los datos de ejemplo.'
      )
    ) {
      setData(resetData());
      setSelectedId(undefined);
      setQuery('');
      setFilter('all');
    }
  };

  return (
    <main
      className={`app-shell ${
        leftOpen ? 'left-open' : 'left-closed'
      } ${
        rightOpen ? 'right-open' : 'right-closed'
      }`}
    >
      <Sidebar
        open={leftOpen}
        onToggle={() => setLeftOpen((value) => !value)}
        records={shown}
        selectedId={selectedId}
        query={query}
        setQuery={setQuery}
        filter={filter}
        setFilter={setFilter}
        onSelect={setSelectedId}
        onNew={() => setRecordModal('new')}
        onReset={reset}
      />

      <NetworkGraph
        records={data.records}
        relationships={data.relationships}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onClear={() => setSelectedId(undefined)}
      />

      <DetailsPanel
        open={rightOpen}
        onToggle={() => setRightOpen((value) => !value)}
        record={selected}
        records={data.records}
        relationships={data.relationships}
        onSelect={setSelectedId}
        onEdit={() => setRecordModal('edit')}
        onDelete={removeRecord}
        onAddRelation={() => setRelationModal(true)}
        onDeleteRelation={removeRel}
      />

      {recordModal && (
        <RecordModal
          record={recordModal === 'edit' ? selected : undefined}
          onClose={() => setRecordModal(null)}
          onSave={saveRecord}
        />
      )}

      {relationModal && selected && (
        <RelationshipModal
          current={selected}
          records={data.records}
          relationships={data.relationships}
          onClose={() => setRelationModal(false)}
          onSave={saveRel}
        />
      )}
    </main>
  );
}