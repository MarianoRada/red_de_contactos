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
  RECORD_HEADERS,
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
import type { RecordType, RelationshipType } from '../types/models';

type BulkImportModalProps = {
  existingNodeCount: number;
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

function fileKindLabel(kind: BulkImportFileKind) {
  return kind === 'records' ? 'Registros' : 'Relaciones';
}

function expectedHeaders(kind: BulkImportFileKind) {
  return kind === 'records' ? RECORD_HEADERS : RELATIONSHIP_HEADERS;
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importSessionRef = useRef<{ signature: string; importId: string }>();

  const validation = useMemo(
    () => validateBulkImport(recordsFile, relationshipsFile),
    [recordsFile, relationshipsFile]
  );

  const payloadData = useMemo(() => {
    const records = validation.rows
      .filter((row) => row.fileKind === 'records')
      .map((row) => ({
        record_key: row.values.record_key ?? '',
        ...(row.values.id?.trim() ? { id: row.values.id.trim() } : {}),
        name: row.values.name ?? '',
        description: row.values.description ?? '',
        email: row.values.email ?? '',
        location: row.values.location ?? '',
        type: (row.values.type ?? '') as RecordType,
      }));

    const relationships = validation.rows
      .filter((row) => row.fileKind === 'relationships')
      .map((row) => ({
        relationship_key: row.values.relationship_key ?? '',
        source_ref: row.values.source_ref ?? '',
        target_ref: row.values.target_ref ?? '',
        type: (row.values.type ?? '') as RelationshipType,
      }));

    return { records, relationships };
  }, [validation.rows]);

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
    validation.recordsCount > 0 &&
    validation.blockingErrorCount === 0 &&
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
                  [column]: newValue,
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

  const rowHasIssue = (row: ImportPreviewRow, column: string) =>
    row.issues.some((currentIssue) => currentIssue.column === column);

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
          <span>Registros es obligatorio; relaciones es opcional.</span>
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
            Las referencias con prefijo <code>id:</code> quedan pendientes de validación contra D1. El backend volverá a validar todo antes de escribir.
          </span>
        </div>

        {(localGlobalIssues.length > 0 || serverIssues.length > 0 || importError) && (
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
                      {expectedHeaders(visibleRows[0].fileKind).map((header) => (
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
                        {expectedHeaders(row.fileKind).map((header) => (
                          <td key={header}>
                            <input
                              className={rowHasIssue(row, header) ? 'bulk-cell-error' : ''}
                              aria-label={`${header}, fila ${row.rowNumber}`}
                              value={row.values[header] ?? ''}
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
