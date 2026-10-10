import { useCallback, useEffect, useMemo, useState } from 'react';

import Sidebar from './components/Sidebar';
import DetailsPanel from './components/DetailsPanel';
import NetworkGraph from './graph/NetworkGraph';
import RecordModal from './components/RecordModal';
import RelationshipModal from './components/RelationshipModal';
import BulkImportModal from './components/BulkImportModal';
import LoginModal from './components/LoginModal';

import {
  ApiError,
  getAuthSession,
  loadData,
  createRecord,
  updateRecord as updateRecordApi,
  deleteRecord as deleteRecordApi,
  createRelationship,
  deleteRelationship as deleteRelationshipApi,
  logoutAdmin,
  setAuthFailureHandler,
} from './lib/api';
import { MAX_NODES } from './lib/nodeLimits';
import type { BulkImportResult } from './lib/bulkImportTypes';
import type { AuthSession } from './lib/authTypes';

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
  const [authLoading, setAuthLoading] = useState(true);
  const [authSession, setAuthSession] = useState<AuthSession>({
    authenticated: false,
    csrfToken: '',
  });
  const [loginOpen, setLoginOpen] = useState(false);

  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | RecordType>('all');

  const [recordModal, setRecordModal] =
    useState<'new' | 'edit' | null>(null);

  const [relationModal, setRelationModal] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);

  // Los paneles laterales comienzan cerrados
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);

  const isAdmin = authSession.authenticated;

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

  useEffect(() => {
    let cancelled = false;

    setAuthFailureHandler(() => {
      if (!cancelled) {
        setAuthSession({ authenticated: false, csrfToken: '' });
        setError('La sesión expiró. Iniciá sesión nuevamente para continuar.');
      }
    });

    void getAuthSession()
      .then((session) => {
        if (!cancelled) {
          setAuthSession(session);
        }
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setAuthSession({ authenticated: false, csrfToken: '' });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAuthLoading(false);
        }
      });

    return () => {
      cancelled = true;
      setAuthFailureHandler(undefined);
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

      const apiError = err instanceof ApiError ? err.body : undefined;
      const errorCode =
        typeof apiError === 'object' && apiError !== null && 'error' in apiError
          ? String((apiError as { error: unknown }).error)
          : undefined;
      const apiMessage =
        typeof apiError === 'object' && apiError !== null && 'message' in apiError
          ? String((apiError as { message: unknown }).message)
          : undefined;

      setError(
        apiMessage && errorCode === 'duplicate_record_name'
          ? apiMessage
          : errorCode === 'node_limit_exceeded'
          ? `La red alcanzÃ³ el lÃ­mite de ${MAX_NODES.toLocaleString('es-AR')} nodos. EliminÃ¡ un registro antes de crear otro.`
          : recordModal === 'edit'
            ? 'No se pudo actualizar el registro.'
            : 'No se pudo crear el registro.'
      );
    }
  };

  const openNewRecord = () => {
    if (!isAdmin) {
      setLoginOpen(true);
      return;
    }

    if (data.records.length >= MAX_NODES) {
      setError(
        `La red alcanzÃ³ el lÃ­mite de ${MAX_NODES.toLocaleString('es-AR')} nodos. EliminÃ¡ un registro antes de crear otro.`
      );
      return;
    }

    setRecordModal('new');
  };

  const handleLoginSuccess = (session: AuthSession) => {
    setAuthSession(session);
    setLoginOpen(false);
    setError(undefined);
  };

  const handleLogout = async () => {
    try {
      await logoutAdmin();
    } catch (err) {
      console.error(err);
    } finally {
      setAuthSession({ authenticated: false, csrfToken: '' });
      setLoginOpen(false);
    }
  };

  const handleBulkImportSuccess = async (_result: BulkImportResult) => {
    try {
      const loadedData = await loadData();
      setData(loadedData);
      setSelectedId(undefined);
      setError(undefined);
    } catch (err) {
      console.error(err);
      setError(
        'La importación se completó, pero no se pudo actualizar la vista. Volvé a intentar la carga de datos.'
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
        nodeCount={data.records.length}
        onNew={openNewRecord}
        onBulkImport={() => setBulkImportOpen(true)}

        // Reset de datos eliminado.
        // D1 es ahora la fuente de verdad.
        onReset={() => {}}
        isAdmin={isAdmin}
        authLoading={authLoading}
        adminEmail={authSession.user?.email}
        onLogin={() => setLoginOpen(true)}
        onLogout={() => void handleLogout()}
      />

      <NetworkGraph
        records={data.records}
        relationships={data.relationships}
        selectedId={selectedId}
        onSelect={handleGraphSelect}
        onClear={clearGraphSelection}
        canEdit={isAdmin}
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
        isAdmin={isAdmin}
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

      {bulkImportOpen && (
        <BulkImportModal
          existingNodeCount={data.records.length}
          existingRecords={data.records}
          existingRelationships={data.relationships}
          onClose={() => setBulkImportOpen(false)}
          onImportSuccess={handleBulkImportSuccess}
        />
      )}

      {loginOpen && (
        <LoginModal
          onClose={() => setLoginOpen(false)}
          onSuccess={handleLoginSuccess}
        />
      )}
    </main>
  );
}
