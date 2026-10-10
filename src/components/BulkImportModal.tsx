import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
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
  validateBulkImport,
} from '../lib/bulkImportValidation';
import {
  consolidateBlockingErrors,
} from '../lib/bulkImportCounters';
import type {
  BulkImportFileKind,
  BulkImportPayload,
  BulkImportResult,
  ImportPreviewRow,
  ParsedCsvFile,
} from '../lib/bulkImportTypes';
import type { ContactRecord, RecordType, Relationship, RelationshipType } from '../types/models';

type BulkImportModalProps = {
  existingNodeCount: number;
  existingRecords: ContactRecord[];
  existingRelationships: Relationship[];
  onClose: () => void;
  onImportSuccess: (result: BulkImportResult) => Promise<boolean | void> | boolean | void;
};

type ModalStatus = 'idle' | 'reading' | 'ready' | 'submitting' | 'success' | 'error';
type ServerIssue = {
  code?: string;
  message: string;
  row?: number;
  column?: string;
};

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
  diagnosticSourceRef: string;
  diagnosticTargetRef: string;
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

function serverIssueKind(issue: ServerIssue): BulkImportFileKind | undefined {
  if (issue.code?.startsWith('record_') || issue.code === 'duplicate_record_name') {
    return 'records';
  }

  if (
    issue.code?.startsWith('relationship_') ||
    issue.code?.includes('reference') ||
    issue.code?.includes('self')
  ) {
    return 'relationships';
  }

  return undefined;
}

type DisplayedError = {
  row?: number;
  message: string;
};

function uniqueDisplayedErrors(errors: DisplayedError[]) {
  const seen = new Set<string>();

  return errors.filter((error) => {
    const key = `${error.row ?? ''}:${error.message}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function displayedErrorText(error: DisplayedError) {
  return error.row ? `Fila ${error.row}: ${error.message}` : error.message;
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
  const [contactErrorsExpanded, setContactErrorsExpanded] = useState(false);
  const [relationshipErrorsExpanded, setRelationshipErrorsExpanded] = useState(false);
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

  const duplicateImportedNames = useMemo(() => {
    const counts = new Map<string, number>();

    validation.rows
      .filter((row) => row.fileKind === 'records' && row.values.name)
      .forEach((row) => {
        const key = normalizedName(row.values.name);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      });

    return new Set(
      [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([key]) => key)
    );
  }, [validation.rows]);

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
            diagnosticSourceRef: sourceRef,
            diagnosticTargetRef: targetRef,
            issues,
          };
        }

        const sourceCandidates = candidatesByName.get(normalizedName(sourceName)) ?? [];
        const targetCandidates = candidatesByName.get(normalizedName(targetName)) ?? [];
        const sourceRef = sourceCandidates.length === 1 ? sourceCandidates[0].ref : '';
        const targetRef = targetCandidates.length === 1 ? targetCandidates[0].ref : '';
        const issues: string[] = [];
        const sourceConflictsWithExisting = existingRecords.some(
          (record) => normalizedName(record.name) === normalizedName(sourceName)
        ) && validation.rows.some(
          (currentRow) =>
            currentRow.fileKind === 'records' &&
            normalizedName(currentRow.values.name ?? '') === normalizedName(sourceName)
        );
        const targetConflictsWithExisting = existingRecords.some(
          (record) => normalizedName(record.name) === normalizedName(targetName)
        ) && validation.rows.some(
          (currentRow) =>
            currentRow.fileKind === 'records' &&
            normalizedName(currentRow.values.name ?? '') === normalizedName(targetName)
        );
        const sourceExistingCandidates = sourceCandidates.filter((candidate) => candidate.kind === 'existing');
        const targetExistingCandidates = targetCandidates.filter((candidate) => candidate.kind === 'existing');
        const sourceImportedCandidates = sourceCandidates.filter((candidate) => candidate.kind === 'new');
        const targetImportedCandidates = targetCandidates.filter((candidate) => candidate.kind === 'new');
        const diagnosticSourceRef = sourceRef || (
          sourceConflictsWithExisting &&
          sourceExistingCandidates.length === 1 &&
          sourceImportedCandidates.length === 1
            ? sourceExistingCandidates[0].ref
            : ''
        );
        const diagnosticTargetRef = targetRef || (
          targetConflictsWithExisting &&
          targetExistingCandidates.length === 1 &&
          targetImportedCandidates.length === 1
            ? targetExistingCandidates[0].ref
            : ''
        );

        if (sourceName && sourceCandidates.length === 0) {
          issues.push(`No existe un contacto llamado "${sourceName}".`);
        } else if (
          sourceCandidates.length > 1 &&
          !sourceRef &&
          !duplicateImportedNames.has(normalizedName(sourceName)) &&
          !sourceConflictsWithExisting
        ) {
          issues.push(`El nombre "${sourceName}" está duplicado en D1.`);
        }

        if (targetName && targetCandidates.length === 0) {
          issues.push(`No existe un contacto llamado "${targetName}".`);
        } else if (
          targetCandidates.length > 1 &&
          !targetRef &&
          !duplicateImportedNames.has(normalizedName(targetName)) &&
          !targetConflictsWithExisting
        ) {
          issues.push(`El nombre "${targetName}" está duplicado en D1.`);
        }

        if (sourceRef && targetRef && sourceRef === targetRef) {
          issues.push('Una relación no puede apuntar al mismo contacto en ambos extremos.');
        }

        if (sourceRefIsExisting(diagnosticSourceRef) && sourceRefIsExisting(diagnosticTargetRef)) {
          const duplicateInDatabase = existingRelationships.some(
            (relationship) =>
              relationship.sourceId === diagnosticSourceRef.slice(3) &&
              relationship.targetId === diagnosticTargetRef.slice(3) &&
              relationship.type === row.values.type
          );

          if (duplicateInDatabase) {
            issues.push('Esta relación ya existe.');
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
          diagnosticSourceRef,
          diagnosticTargetRef,
          issues,
        };
      });

    const seen = new Map<string, number>();
    return resolutions.map((resolution) => {
      if (resolution.diagnosticSourceRef && resolution.diagnosticTargetRef && resolution.row.values.type) {
        const signature = `${resolution.diagnosticSourceRef}\u0000${resolution.diagnosticTargetRef}\u0000${resolution.row.values.type}`;
        const previous = seen.get(signature);
        if (previous) {
          resolution.issues.push(`Esta relación está repetida en el CSV (fila ${previous}).`);
        } else {
          seen.set(signature, resolution.row.rowNumber);
        }
      }
      return resolution;
    });
  }, [candidatesByName, duplicateImportedNames, existingRecords, existingRelationships, validation.rows]);

  const recordNameConflicts = useMemo(() => {
    return validation.rows
      .filter((row) => row.fileKind === 'records' && row.values.name)
      .flatMap((row) => {
        const existing = existingRecords.find(
          (record) => normalizedName(record.name) === normalizedName(row.values.name)
        );

        return existing
          ? [{ row: row.rowNumber, name: row.values.name, existing: existing.name }]
          : [];
      });
  }, [existingRecords, validation.rows]);

  const resolutionIssues = relationshipResolutions.flatMap((resolution) =>
    resolution.issues.map((message) => ({
      message,
      row: resolution.row.rowNumber,
      column: message.includes('origen') || message.includes('contacto llamado') ? 'source' : undefined,
    }))
  );

  const consolidatedBlockingErrors = useMemo(() => {
    return consolidateBlockingErrors({
      validationIssues: validation.issues,
      recordNameConflicts,
      resolutionIssues,
      serverIssues: serverIssues.map((issue) => ({
        ...issue,
        fileKind: serverIssueKind(issue),
      })),
      importError,
    });
  }, [importError, recordNameConflicts, resolutionIssues, serverIssues, validation.issues]);

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
    consolidatedBlockingErrors.length === 0 &&
    !overNodeLimit;

  useEffect(() => {
    setContactErrorsExpanded(false);
    setRelationshipErrorsExpanded(false);
  }, [recordsFile, relationshipsFile]);

  const openFilePicker = () => {
    if (!isSubmitting) {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
        fileInputRef.current.click();
      }
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
      const dataUpdated = await onImportSuccess(result);
      if (dataUpdated === false) {
        setImportError(
          'La importación se completó, pero no se pudo actualizar la vista. Volvé a intentar la carga de datos.'
        );
        setStatus('error');
        return;
      }

      setLastResult(result);
      setStatus('success');
      onClose();
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

  const localGlobalIssues = validation.issues.filter(
    (currentIssue) => !currentIssue.rowNumber
  );

  const contactErrors = uniqueDisplayedErrors([
    ...recordNameConflicts.map((conflict) => ({
      row: conflict.row,
      message: `"${conflict.name}" ya existe.`,
    })),
    ...localGlobalIssues
      .filter((issue) => issue.severity === 'error' && issue.fileKind === 'records')
      .map((issue) => ({ row: issue.rowNumber, message: issue.message })),
    ...serverIssues
      .filter((issue) => serverIssueKind(issue) === 'records')
      .map((issue) => ({ row: issue.row, message: issue.message })),
  ]);

  const relationshipErrors = uniqueDisplayedErrors([
    ...resolutionIssues.map((issue) => ({ row: issue.row, message: issue.message })),
    ...localGlobalIssues
      .filter((issue) => issue.severity === 'error' && issue.fileKind === 'relationships')
      .map((issue) => ({ row: issue.rowNumber, message: issue.message })),
    ...serverIssues
      .filter((issue) => serverIssueKind(issue) === 'relationships')
      .map((issue) => ({ row: issue.row, message: issue.message })),
  ]);

  const unclassifiedErrors = localGlobalIssues
    .filter((issue) => issue.severity === 'error' && !issue.fileKind)
    .map((issue) => ({ row: issue.rowNumber, message: issue.message }));

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
            <span>contactos</span>
          </div>
          <div>
            <strong>{validation.relationshipsCount}</strong>
            <span>relaciones</span>
          </div>
          <div className="valid">
            <strong>{validation.validRowCount}</strong>
            <span>filas con formato válido</span>
          </div>
          <div className="warning">
            <strong>{validation.warningCount}</strong>
            <span>advertencias</span>
          </div>
          <div className="invalid">
            <strong>{consolidatedBlockingErrors.length}</strong>
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

        {(contactErrors.length > 0 || relationshipErrors.length > 0) && (
          <div className="bulk-error-sections">
            {contactErrors.length > 0 && (
              <section className={`bulk-error-section ${contactErrorsExpanded ? 'expanded' : ''}`}>
                <button
                  type="button"
                  className="bulk-error-toggle"
                  aria-expanded={contactErrorsExpanded}
                  aria-controls="bulk-contact-errors"
                  onClick={() => setContactErrorsExpanded((expanded) => !expanded)}
                >
                  <span className="bulk-error-toggle-label">
                    <AlertTriangle size={16} aria-hidden="true" />
                    <span>Errores en contactos ({contactErrors.length})</span>
                  </span>
                  <ChevronDown
                    className={`bulk-error-chevron ${contactErrorsExpanded ? 'expanded' : ''}`}
                    size={16}
                    aria-hidden="true"
                  />
                </button>
                <div
                  id="bulk-contact-errors"
                  className="bulk-error-list"
                  hidden={!contactErrorsExpanded}
                >
                  <ul>
                    {contactErrors.map((error, index) => (
                      <li key={`contact-error-${error.row ?? 'global'}-${index}`}>
                        {displayedErrorText(error)}
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}

            {relationshipErrors.length > 0 && (
              <section className={`bulk-error-section ${relationshipErrorsExpanded ? 'expanded' : ''}`}>
                <button
                  type="button"
                  className="bulk-error-toggle"
                  aria-expanded={relationshipErrorsExpanded}
                  aria-controls="bulk-relationship-errors"
                  onClick={() => setRelationshipErrorsExpanded((expanded) => !expanded)}
                >
                  <span className="bulk-error-toggle-label">
                    <AlertTriangle size={16} aria-hidden="true" />
                    <span>Errores en relaciones ({relationshipErrors.length})</span>
                  </span>
                  <ChevronDown
                    className={`bulk-error-chevron ${relationshipErrorsExpanded ? 'expanded' : ''}`}
                    size={16}
                    aria-hidden="true"
                  />
                </button>
                <div
                  id="bulk-relationship-errors"
                  className="bulk-error-list"
                  hidden={!relationshipErrorsExpanded}
                >
                  <ul>
                    {relationshipErrors.map((error, index) => (
                      <li key={`relationship-error-${error.row ?? 'global'}-${index}`}>
                        {displayedErrorText(error)}
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}
          </div>
        )}

        {(unclassifiedErrors.length > 0 || (importError && serverIssues.length === 0)) && (
          <div className="bulk-global-issues">
            {unclassifiedErrors.map((error, index) => (
              <p className="error" key={`global-error-${index}`}>
                {displayedErrorText(error)}
              </p>
            ))}
            {importError && serverIssues.length === 0 && <p className="error">{importError}</p>}
          </div>
        )}

        {status === 'success' && lastResult && (
          <div className="bulk-success-message">
            Se agregaron {lastResult.inserted.records} registros y {lastResult.inserted.relationships} relaciones.
            {lastResult.idempotent && ' La respuesta correspondió a una importación ya confirmada.'}
          </div>
        )}

        <div className="bulk-import-actions modal-actions">
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
