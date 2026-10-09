import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react';
import Modal from './Modal';
import { ApiError, importBulkData } from '../lib/api';
import { MAX_NODES } from '../lib/nodeLimits';
import {
  detectCsvFileKind,
  parseCsvFile,
} from '../lib/csv';
import {
  CONTACT_HEADERS,
  RELATIONSHIP_HEADERS,
  validateBulkImport,
} from '../lib/bulkImportValidation';
import type {
  BulkImportFileKind,
  BulkImportPayload,
  BulkImportResult,
  ImportIssue,
  ImportPreviewRow,
  ParsedCsvFile,
} from '../lib/bulkImportTypes';
import type { ContactRecord, RecordType, Relationship, RelationshipType } from '../types/models';

type BulkImportModalProps = {
  existingNodeCount: number;
  existingRecords: ContactRecord[];
  existingRelationships: Relationship[];
  onClose: () => void;
  onImportSuccess: (result: BulkImportResult) => Promise<void> | void;
};

type PreviewFilter = 'all' | 'errors' | 'warnings';
type ModalStatus = 'idle' | 'reading' | 'ready' | 'submitting' | 'success' | 'error';
type ServerIssue = {
  code?: string;
  message: string;
  row?: number;
  column?: string;
};

const PAGE_SIZE = 25;

type ResolutionCandidate = {
  ref: string;
  name: string;
  label: string;
  kind: 'new' | 'existing';
};

type RelationshipResolution = {
  row: ImportPreviewRow;
  sourceName: string;
  targetName: string;
  sourceCandidates: ResolutionCandidate[];
  targetCandidates: ResolutionCandidate[];
  sourceRef: string;
  targetRef: string;
  issues: string[];
};

function fileKindLabel(kind: BulkImportFileKind) {
  return kind === 'records' ? 'Contactos' : 'Relaciones';
}

function normalizedName(value: string) {
  return value.trim().toLocaleLowerCase('es-AR');
}

function sourceRefIsExisting(ref: string) {
  return ref.startsWith('id:');
}

function isLegacyRow(row: ImportPreviewRow) {
  return row.values.__legacy === 'true';
}

function previewHeaders(kind: BulkImportFileKind, file: ParsedCsvFile | undefined) {
  if (file) {
    return file.headers;
  }

  return kind === 'records'
    ? CONTACT_HEADERS
    : RELATIONSHIP_HEADERS;
}

function canonicalPreviewColumn(kind: BulkImportFileKind, column: string) {
  if (kind === 'relationships' && column === 'source') {
    return 'source_ref';
  }

  if (kind === 'relationships' && column === 'target') {
    return 'target_ref';
  }

  return column;
}

function previewValue(row: ImportPreviewRow, column: string) {
  return row.values[canonicalPreviewColumn(row.fileKind, column)] ?? row.values[column] ?? '';
}

function templateDownload(filename: string, contents: string) {
  const blob = new Blob([contents], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function serverIssuesFrom(error: unknown): ServerIssue[] {
  if (!(error instanceof ApiError)) {
    return [];
  }

  const body = error.body;
  if (typeof body !== 'object' || body === null || !('issues' in body)) {
    return [];
  }

  const issues = (body as { issues: unknown }).issues;
  if (!Array.isArray(issues)) {
    return [];
  }

  return issues.filter(
    (issue): issue is ServerIssue =>
      typeof issue === 'object' &&
      issue !== null &&
      'message' in issue &&
      typeof (issue as { message: unknown }).message === 'string'
  );
}

function serverIssueLabel(issue: ServerIssue) {
  const location = [
    issue.row ? `fila ${issue.row}` : '',
    issue.column ? `columna ${issue.column}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return location ? `${location}: ${issue.message}` : issue.message;
}

export default function BulkImportModal({
  existingNodeCount,
  existingRecords,
  existingRelationships,
  onClose,
  onImportSuccess,
}: BulkImportModalProps) {
  const [recordsFile, setRecordsFile] = useState<ParsedCsvFile>();
  const [relationshipsFile, setRelationshipsFile] = useState<ParsedCsvFile>();
  const [status, setStatus] = useState<ModalStatus>('idle');
  const [fileMessage, setFileMessage] = useState<string>();
  const [importError, setImportError] = useState<string>();
  const [serverIssues, setServerIssues] = useState<ServerIssue[]>([]);
  const [lastResult, setLastResult] = useState<BulkImportResult>();
  const [previewFilter, setPreviewFilter] = useState<PreviewFilter>('all');
  const [page, setPage] = useState(1);
  const [relationshipSelections, setRelationshipSelections] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importSessionRef = useRef<{ signature: string; importId: string }>();

  const validation = useMemo(
    () => validateBulkImport(recordsFile, relationshipsFile),
    [recordsFile, relationshipsFile]
  );

  const newCandidates = useMemo<ResolutionCandidate[]>(
    () =>
      validation.rows
        .filter((row) => row.fileKind === 'records' && row.values.name)
        .map((row) => ({
          ref: row.values.record_key,
          name: row.values.name,
          label: `Nuevo: ${row.values.name} (fila ${row.rowNumber})`,
          kind: 'new',
        })),
    [validation.rows]
  );

  const existingCandidates = useMemo<ResolutionCandidate[]>(
    () =>
      existingRecords.map((record, index) => ({
        ref: `id:${record.id}`,
        name: record.name,
        label: `Existente ${index + 1}: ${record.name}${record.email ? ` · ${record.email}` : ''}${record.location ? ` · ${record.location}` : ''}`,
        kind: 'existing',
      })),
    [existingRecords]
  );

  const candidatesByName = useMemo(() => {
    const candidates = [...newCandidates, ...existingCandidates];
    const grouped = new Map<string, ResolutionCandidate[]>();

    candidates.forEach((candidate) => {
      const key = normalizedName(candidate.name);
      const current = grouped.get(key) ?? [];
      current.push(candidate);
      grouped.set(key, current);
    });

    return grouped;
  }, [existingCandidates, newCandidates]);

  const relationshipResolutions = useMemo<RelationshipResolution[]>(() => {
    const resolutions = validation.rows
      .filter((row) => row.fileKind === 'relationships')
      .map((row) => {
        const sourceName = row.values.source_ref ?? '';
        const targetName = row.values.target_ref ?? '';

        if (isLegacyRow(row)) {
          const sourceRef = sourceName;
          const targetRef = targetName;
          const issues = sourceRef && targetRef && sourceRef === targetRef
            ? ['Una relación no puede apuntar al mismo registro en ambos extremos.']
            : [];

          return {
            row,
            sourceName,
            targetName,
            sourceCandidates: [],
            targetCandidates: [],
            sourceRef,
            targetRef,
            issues,
          };
        }

        const sourceCandidates = candidatesByName.get(normalizedName(sourceName)) ?? [];
        const targetCandidates = candidatesByName.get(normalizedName(targetName)) ?? [];
        const sourceKey = `${row.rowNumber}:source`;
        const targetKey = `${row.rowNumber}:target`;
        const sourceRef = relationshipSelections[sourceKey] ?? (sourceCandidates.length === 1 ? sourceCandidates[0].ref : '');
        const targetRef = relationshipSelections[targetKey] ?? (targetCandidates.length === 1 ? targetCandidates[0].ref : '');
        const issues: string[] = [];

        if (sourceName && sourceCandidates.length === 0) {
          issues.push(`No existe un contacto llamado "${sourceName}".`);
        } else if (sourceCandidates.length > 1 && !sourceRef) {
          issues.push(`Hay varias coincidencias para el origen "${sourceName}".`);
        }

        if (targetName && targetCandidates.length === 0) {
          issues.push(`No existe un contacto llamado "${targetName}".`);
        } else if (targetCandidates.length > 1 && !targetRef) {
          issues.push(`Hay varias coincidencias para el destino "${targetName}".`);
        }

        if (sourceRef && targetRef && sourceRef === targetRef) {
          issues.push('Una relación no puede apuntar al mismo contacto en ambos extremos.');
        }

        if (sourceRefIsExisting(sourceRef) && sourceRefIsExisting(targetRef)) {
          const duplicateInDatabase = existingRelationships.some(
            (relationship) =>
              relationship.sourceId === sourceRef.slice(3) &&
              relationship.targetId === targetRef.slice(3) &&
              relationship.type === row.values.type
          );

          if (duplicateInDatabase) {
            issues.push('Esta relación ya existe en la base de datos.');
          }
        }

        return {
          row,
          sourceName,
          targetName,
          sourceCandidates,
          targetCandidates,
          sourceRef,
          targetRef,
          issues,
        };
      });

    const seen = new Map<string, number>();
    return resolutions.map((resolution) => {
      if (resolution.sourceRef && resolution.targetRef && resolution.row.values.type) {
        const signature = `${resolution.sourceRef}\u0000${resolution.targetRef}\u0000${resolution.row.values.type}`;
        const previous = seen.get(signature);
        if (previous) {
          resolution.issues.push(`Esta relación está repetida; también aparece en la fila ${previous}.`);
        } else {
          seen.set(signature, resolution.row.rowNumber);
        }
      }
      return resolution;
    });
  }, [candidatesByName, existingRelationships, relationshipSelections, validation.rows]);

  const duplicateNameWarnings = useMemo(() => {
    return [...candidatesByName.entries()]
      .filter(([, candidates]) => candidates.length > 1)
      .map(([name, candidates]) => `"${name}" tiene ${candidates.length} coincidencias; las relaciones con ese nombre requerirán selección.`);
  }, [candidatesByName]);

  const resolutionIssues = relationshipResolutions.flatMap((resolution) =>
    resolution.issues.map((message) => ({
      message,
      row: resolution.row.rowNumber,
      column: message.includes('origen') || message.includes('contacto llamado') ? 'source' : undefined,
    }))
  );

  const payloadData = useMemo(() => {
    const records = validation.rows
      .filter((row) => row.fileKind === 'records')
      .map((row) => ({
        record_key: row.values.record_key ?? `__import_record_${row.rowNumber}`,
        ...(row.values.id?.trim() ? { id: row.values.id.trim() } : {}),
        name: row.values.name ?? '',
        description: row.values.description ?? '',
        email: row.values.email ?? '',
        location: row.values.location ?? '',
        type: (row.values.type ?? '') as RecordType,
      }));

    const relationships = validation.rows
      .filter((row) => row.fileKind === 'relationships')
      .map((row) => {
        const resolution = relationshipResolutions.find(
          (current) => current.row.rowNumber === row.rowNumber
        );
        const relationship = {
          ...(row.values.relationship_key?.trim()
            ? { relationship_key: row.values.relationship_key.trim() }
            : {}),
          type: (row.values.type ?? '') as RelationshipType,
        } as {
          relationship_key?: string;
          source?: string;
          target?: string;
          source_ref?: string;
          target_ref?: string;
          type: RelationshipType;
        };

        if (isLegacyRow(row)) {
          relationship.source_ref = row.values.source_ref ?? '';
          relationship.target_ref = row.values.target_ref ?? '';
        } else {
          relationship.source = row.values.source_ref ?? '';
          relationship.target = row.values.target_ref ?? '';
          relationship.source_ref = resolution?.sourceRef ?? '';
          relationship.target_ref = resolution?.targetRef ?? '';
        }

        return relationship;
      });

    return { records, relationships };
  }, [relationshipResolutions, validation.rows]);

  const payloadSignature = JSON.stringify(payloadData);
  if (importSessionRef.current?.signature !== payloadSignature) {
    importSessionRef.current = {
      signature: payloadSignature,
      importId: crypto.randomUUID(),
    };
  }

  const payload: BulkImportPayload = {
    ...payloadData,
    importId: importSessionRef.current.importId,
  };

  const newNodeCount = validation.recordsCount;
  const resultingNodeCount = existingNodeCount + newNodeCount;
  const availableNodeCount = Math.max(MAX_NODES - existingNodeCount, 0);
  const overNodeLimit = resultingNodeCount > MAX_NODES;
  const isSubmitting = status === 'submitting';
  const canSubmit =
    status !== 'reading' &&
    status !== 'success' &&
    !isSubmitting &&
    validation.recordsCount + validation.relationshipsCount > 0 &&
    validation.blockingErrorCount === 0 &&
    resolutionIssues.length === 0 &&
    !overNodeLimit;

  const previewRows = useMemo(() => {
    if (previewFilter === 'errors') {
      return validation.rows.filter((row) =>
        row.issues.some((currentIssue) => currentIssue.severity === 'error')
      );
    }

    if (previewFilter === 'warnings') {
      return validation.rows.filter((row) =>
        row.issues.some((currentIssue) => currentIssue.severity === 'warning')
      );
    }

    return validation.rows;
  }, [previewFilter, validation.rows]);

  const pageCount = Math.max(1, Math.ceil(previewRows.length / PAGE_SIZE));
  const visibleRows = previewRows.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );

  useEffect(() => {
    setPage(1);
  }, [previewFilter, recordsFile, relationshipsFile]);

  const openFilePicker = () => {
    if (!isSubmitting) {
      fileInputRef.current?.click();
    }
  };

  const clearFiles = () => {
    if (isSubmitting) {
      return;
    }

    setRecordsFile(undefined);
    setRelationshipsFile(undefined);
    setFileMessage(undefined);
    setImportError(undefined);
    setServerIssues([]);
    setLastResult(undefined);
    setStatus('idle');
    setRelationshipSelections({});
    setPage(1);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const clearFileKind = (kind: BulkImportFileKind) => {
    if (isSubmitting) {
      return;
    }

    if (kind === 'records') {
      setRecordsFile(undefined);
    } else {
      setRelationshipsFile(undefined);
    }

    setImportError(undefined);
    setServerIssues([]);
    setLastResult(undefined);
    setStatus('ready');
    setRelationshipSelections({});
    setPage(1);
  };

  const loadFiles = async (files: File[]) => {
    if (isSubmitting) {
      return;
    }

    const csvFiles = files.filter(
      (file) => file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv')
    );

    if (csvFiles.length === 0) {
      setFileMessage('Seleccioná al menos un archivo con extensión .csv.');
      return;
    }

    setStatus('reading');
    setFileMessage(undefined);
    setImportError(undefined);
    setServerIssues([]);
    setLastResult(undefined);

    try {
      const parsedFiles = await Promise.all(csvFiles.map(parseCsvFile));
      let nextRecordsFile = recordsFile;
      let nextRelationshipsFile = relationshipsFile;
      const unrecognizedFiles: string[] = [];

      parsedFiles.forEach((parsedFile) => {
        const detectedKind =
          detectCsvFileKind(parsedFile.headers) ??
          (!nextRecordsFile ? 'records' : !nextRelationshipsFile ? 'relationships' : undefined);

        if (!detectedKind) {
          unrecognizedFiles.push(parsedFile.file.name);
          return;
        }

        if (detectedKind === 'records') {
          nextRecordsFile = parsedFile;
        } else {
          nextRelationshipsFile = parsedFile;
        }
      });

      setRecordsFile(nextRecordsFile);
      setRelationshipsFile(nextRelationshipsFile);
      setStatus('ready');
      setPage(1);

      if (unrecognizedFiles.length > 0) {
        setFileMessage(
          `No se pudo identificar el formato de: ${unrecognizedFiles.join(', ')}.`
        );
      }
    } catch {
      setStatus('error');
      setFileMessage('No se pudo leer uno de los archivos CSV.');
    }
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    void loadFiles(Array.from(event.target.files ?? []));
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    void loadFiles(Array.from(event.dataTransfer.files));
  };

  const updateCell = (
    row: ImportPreviewRow,
    column: string,
    newValue: string
  ) => {
    if (isSubmitting) {
      return;
    }

    const updateFile = (
      file: ParsedCsvFile | undefined,
      setFile: (nextFile: ParsedCsvFile | undefined) => void
    ) => {
      if (!file) {
        return;
      }

      setFile({
        ...file,
        rows: file.rows.map((currentRow) =>
          currentRow.rowNumber === row.rowNumber
            ? {
                ...currentRow,
                values: {
                  ...currentRow.values,
                  [canonicalPreviewColumn(row.fileKind, column)]: newValue,
                },
              }
            : currentRow
        ),
      });
    };

    if (row.fileKind === 'records') {
      updateFile(recordsFile, setRecordsFile);
    } else {
      updateFile(relationshipsFile, setRelationshipsFile);
    }

    setImportError(undefined);
    setServerIssues([]);
    setLastResult(undefined);
    setStatus('ready');
  };

  const handleSubmit = async () => {
    if (!canSubmit) {
      return;
    }

    const confirmed = window.confirm(
      `Vas a importar ${newNodeCount} registros y ${validation.relationshipsCount} relaciones. ¿Querés continuar?`
    );

    if (!confirmed) {
      return;
    }

    setStatus('submitting');
    setImportError(undefined);
    setServerIssues([]);

    try {
      const result = await importBulkData(payload);
      await onImportSuccess(result);
      setLastResult(result);
      setStatus('success');
    } catch (error) {
      console.error(error);
      setServerIssues(serverIssuesFrom(error));
      setImportError(
        error instanceof ApiError
          ? error.message
          : 'No se pudo completar la importación. Intentá nuevamente.'
      );
      setStatus('error');
    }
  };

  const rowHasIssue = (row: ImportPreviewRow, column: string) => {
    const canonicalColumn = canonicalPreviewColumn(row.fileKind, column);
    return row.issues.some(
      (currentIssue) => currentIssue.column === column || currentIssue.column === canonicalColumn
    );
  };

  const localGlobalIssues = validation.issues.filter(
    (currentIssue) => !currentIssue.rowNumber
  );

  return (
    <Modal
      title="Carga masiva CSV"
      onClose={onClose}
      closeDisabled={isSubmitting}
      className="bulk-import-modal"
    >
      <div className="bulk-import-content">
        <div
          className="bulk-dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <Upload size={26} />
          <strong>Arrastrá uno o dos archivos CSV</strong>
          <span>Podés importar contactos, relaciones o ambos archivos.</span>
          <button
            type="button"
            className="btn secondary"
            onClick={openFilePicker}
            disabled={isSubmitting}
          >
            <FileText size={16} /> Seleccionar archivos
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            multiple
            hidden
            onChange={handleFileInput}
            disabled={isSubmitting}
          />
        </div>

        <div className="bulk-template-actions">
          <button
            type="button"
            className="btn secondary small"
            onClick={() =>
              templateDownload(
                'plantilla-contactos.csv',
                'name,type,description,email,location\nJuan Pérez,person,Desarrollador,juan@gmail.com,Buenos Aires\n'
              )
            }
          >
            Descargar plantilla de contactos
          </button>
          <button
            type="button"
            className="btn secondary small"
            onClick={() =>
              templateDownload(
                'plantilla-relaciones.csv',
                'source,target,type\nJuan Pérez,Empresa ABC,trabaja en\n'
              )
            }
          >
            Descargar plantilla de relaciones
          </button>
        </div>

        <div className="bulk-file-list">
          {(
            [
              ['records', recordsFile],
              ['relationships', relationshipsFile],
            ] as const
          ).map(([kind, file]) => (
            <div className={`bulk-file ${file ? 'loaded' : ''}`} key={kind}>
              <div>
                <strong>{fileKindLabel(kind)}</strong>
                <small>
                  {file
                    ? `${file.file.name} · ${file.rows.length} filas`
                    : kind === 'records'
                      ? 'Archivo obligatorio'
                      : 'Archivo opcional'}
                </small>
              </div>
              {file && (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => clearFileKind(kind)}
                  aria-label={`Quitar archivo de ${fileKindLabel(kind)}`}
                  title="Quitar archivo"
                  disabled={isSubmitting}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          ))}
        </div>

        {fileMessage && <p className="form-error bulk-file-message">{fileMessage}</p>}

        <div className="bulk-status" aria-live="polite">
          {status === 'reading' ? (
            <>
              <RefreshCw className="bulk-spin" size={16} /> Leyendo y validando archivos…
            </>
          ) : status === 'submitting' ? (
            <>
              <RefreshCw className="bulk-spin" size={16} /> Guardando importación…
            </>
          ) : status === 'success' ? (
            <>
              <CheckCircle2 size={16} /> Importación completada correctamente.
            </>
          ) : status === 'error' ? (
            <>
              <AlertTriangle size={16} /> La importación no se aplicó.
            </>
          ) : status === 'ready' ? (
            <>
              <CheckCircle2 size={16} /> Validación local actualizada.
            </>
          ) : (
            'Esperando archivos CSV'
          )}
        </div>

        <div className="bulk-summary" aria-label="Resumen de validación">
          <div>
            <strong>{validation.recordsCount}</strong>
            <span>registros</span>
          </div>
          <div>
            <strong>{validation.relationshipsCount}</strong>
            <span>relaciones</span>
          </div>
          <div className="valid">
            <strong>{validation.validRowCount}</strong>
            <span>filas válidas</span>
          </div>
          <div className="warning">
            <strong>{validation.warningCount}</strong>
            <span>advertencias</span>
          </div>
          <div className="invalid">
            <strong>{validation.blockingErrorCount}</strong>
            <span>errores</span>
          </div>
        </div>

        {recordsFile && (
          <div className={`bulk-capacity ${overNodeLimit ? 'exceeded' : ''}`}>
            <strong>Capacidad de nodos</strong>
            <span>
              {existingNodeCount} existentes + {newNodeCount} nuevos = {resultingNodeCount} / {MAX_NODES}
            </span>
            {overNodeLimit && (
              <p>
                La importación supera el límite de {MAX_NODES.toLocaleString('es-AR')} nodos. Actualmente podés agregar hasta {availableNodeCount} registros.
              </p>
            )}
          </div>
        )}

        <div className="bulk-validation-notes">
          <AlertTriangle size={16} />
          <span>
            Contactos nuevos se identifican automáticamente. Si un nombre coincide con varios contactos, seleccioná la coincidencia correcta antes de confirmar.
          </span>
        </div>

        {duplicateNameWarnings.length > 0 && (
          <div className="bulk-global-issues">
            {duplicateNameWarnings.map((warning) => (
              <p className="warning" key={warning}>{warning}</p>
            ))}
          </div>
        )}

        {relationshipResolutions.length > 0 && (
          <div className="bulk-resolution-panel">
            <strong>Resolver relaciones</strong>
            <p className="muted">
              Las coincidencias únicas se resuelven automáticamente. Las ambiguas requieren una selección.
            </p>
            {relationshipResolutions.map((resolution) => {
              const hasSelection = resolution.sourceCandidates.length > 1 || resolution.targetCandidates.length > 1;
              if (!hasSelection && resolution.issues.length === 0) {
                return null;
              }

              const renderSelector = (
                side: 'source' | 'target',
                name: string,
                candidates: ResolutionCandidate[],
                selectedRef: string
              ) => {
                if (candidates.length <= 1) {
                  return null;
                }

                const selectionKey = `${resolution.row.rowNumber}:${side}`;
                return (
                  <label className="bulk-resolution-field">
                    {side === 'source' ? 'Origen' : 'Destino'}: “{name}”
                    <select
                      value={selectedRef}
                      onChange={(event) =>
                        setRelationshipSelections((current) => ({
                          ...current,
                          [selectionKey]: event.target.value,
                        }))
                      }
                    >
                      <option value="">Seleccioná una coincidencia</option>
                      {candidates.map((candidate) => (
                        <option value={candidate.ref} key={candidate.ref}>
                          {candidate.label}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              };

              return (
                <div className="bulk-resolution-row" key={resolution.row.rowNumber}>
                  <strong>Fila {resolution.row.rowNumber}</strong>
                  {renderSelector('source', resolution.sourceName, resolution.sourceCandidates, resolution.sourceRef)}
                  {renderSelector('target', resolution.targetName, resolution.targetCandidates, resolution.targetRef)}
                  {resolution.issues.map((message) => (
                    <p className="error" key={message}>{message}</p>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {(localGlobalIssues.length > 0 || resolutionIssues.length > 0 || serverIssues.length > 0 || importError) && (
          <div className="bulk-global-issues">
            {localGlobalIssues.map((currentIssue: ImportIssue, index) => (
              <p className={currentIssue.severity} key={`${currentIssue.code}-${index}`}>
                {currentIssue.message}
              </p>
            ))}
            {importError && <p className="error">{importError}</p>}
            {serverIssues.map((issue, index) => (
              <p className="error" key={`${issue.code ?? 'server'}-${index}`}>
                {serverIssueLabel(issue)}
              </p>
            ))}
            {resolutionIssues.map((issue, index) => (
              <p className="error" key={`${issue.row}-${issue.message}-${index}`}>
                Fila {issue.row}: {issue.message}
              </p>
            ))}
          </div>
        )}

        {status === 'success' && lastResult && (
          <div className="bulk-success-message">
            Se agregaron {lastResult.inserted.records} registros y {lastResult.inserted.relationships} relaciones.
            {lastResult.idempotent && ' La respuesta correspondió a una importación ya confirmada.'}
          </div>
        )}

        {validation.rows.length > 0 && (
          <>
            <div className="bulk-preview-toolbar">
              <strong>Vista previa</strong>
              <div className="bulk-filters" role="group" aria-label="Filtrar filas">
                {([
                  ['all', 'Todas'],
                  ['errors', 'Con errores'],
                  ['warnings', 'Con advertencias'],
                ] as const).map(([filter, label]) => (
                  <button
                    type="button"
                    key={filter}
                    className={previewFilter === filter ? 'active' : ''}
                    onClick={() => setPreviewFilter(filter)}
                    disabled={isSubmitting}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="bulk-table-wrap">
              {visibleRows.length === 0 ? (
                <p className="muted">No hay filas para este filtro.</p>
              ) : (
                <table className="bulk-preview-table">
                  <thead>
                    <tr>
                      <th>Archivo</th>
                      <th>Fila</th>
                      {previewHeaders(
                        visibleRows[0].fileKind,
                        visibleRows[0].fileKind === 'records' ? recordsFile : relationshipsFile
                      ).map((header) => (
                        <th key={header}>{header}</th>
                      ))}
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <tr
                        key={`${row.fileKind}-${row.rowNumber}`}
                        className={
                          row.issues.some((currentIssue) => currentIssue.severity === 'error')
                            ? 'has-error'
                            : row.issues.length > 0
                              ? 'has-warning'
                              : ''
                        }
                      >
                        <td>{fileKindLabel(row.fileKind)}</td>
                        <td>{row.rowNumber}</td>
                        {previewHeaders(
                          row.fileKind,
                          row.fileKind === 'records' ? recordsFile : relationshipsFile
                        ).map((header) => (
                          <td key={header}>
                            <input
                              className={rowHasIssue(row, header) ? 'bulk-cell-error' : ''}
                              aria-label={`${header}, fila ${row.rowNumber}`}
                              value={previewValue(row, header)}
                              onChange={(event) =>
                                updateCell(row, header, event.target.value)
                              }
                              disabled={isSubmitting}
                            />
                          </td>
                        ))}
                        <td className="bulk-row-issues">
                          {row.issues.length === 0 ? (
                            <span className="bulk-ok">Correcta</span>
                          ) : (
                            <ul>
                              {row.issues.map((currentIssue, index) => (
                                <li
                                  className={currentIssue.severity}
                                  key={`${currentIssue.code}-${index}`}
                                >
                                  {currentIssue.message}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="bulk-pagination">
              <button
                type="button"
                className="btn secondary small"
                disabled={page <= 1 || isSubmitting}
                onClick={() => setPage((currentPage) => currentPage - 1)}
              >
                Anterior
              </button>
              <span>
                Página {Math.min(page, pageCount)} de {pageCount}
              </span>
              <button
                type="button"
                className="btn secondary small"
                disabled={page >= pageCount || isSubmitting}
                onClick={() => setPage((currentPage) => currentPage + 1)}
              >
                Siguiente
              </button>
            </div>
          </>
        )}

        <div className="bulk-import-actions modal-actions">
          <button
            type="button"
            className="btn secondary"
            onClick={clearFiles}
            disabled={isSubmitting}
          >
            <RefreshCw size={15} /> Reemplazar archivos
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cerrar
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
            title={
              overNodeLimit
                ? 'La importación supera la capacidad disponible'
                : undefined
            }
          >
            Confirmar importación
          </button>
        </div>
      </div>
    </Modal>
  );
}
