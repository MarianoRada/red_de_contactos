import Papa from 'papaparse';
import type {
  BulkImportFileKind,
  CsvRow,
  ParsedCsvFile,
} from './bulkImportTypes';

type PapaRow = string[];

function normalizeHeader(header: string) {
  return header.replace(/^\uFEFF/, '').trim().toLowerCase();
}

function normalizeCell(value: string | undefined) {
  return (value ?? '').replace(/^\uFEFF/, '');
}

function makeRowValues(headers: string[], row: string[]) {
  return Object.fromEntries(
    headers.map((header, index) => [header, normalizeCell(row[index])])
  );
}

export function detectCsvFileKind(headers: string[]): BulkImportFileKind | undefined {
  const normalized = new Set(headers.map(normalizeHeader));

  if (normalized.has('record_key') || normalized.has('name')) {
    return 'records';
  }

  if (
    normalized.has('relationship_key') ||
    normalized.has('source_ref') ||
    normalized.has('target_ref')
  ) {
    return 'relationships';
  }

  return undefined;
}

export function parseCsvFile(file: File): Promise<ParsedCsvFile> {
  return new Promise((resolve) => {
    Papa.parse<PapaRow>(file, {
      header: false,
      dynamicTyping: false,
      skipEmptyLines: 'greedy',
      // Para este volumen evitamos depender del script auxiliar que Papa
      // Parse intenta resolver automáticamente cuando worker=true en Vite.
      worker: false,
      complete: (results) => {
        const rawRows = results.data;
        const rawHeaders = rawRows[0] ?? [];
        const headers = rawHeaders.map(normalizeHeader);
        const parseIssues = results.errors.map((error) => ({
          rowNumber:
            typeof error.row === 'number' ? error.row + 1 : undefined,
          message: error.message,
        }));

        const rows: CsvRow[] = rawRows.slice(1).map((row, index) => ({
          rowNumber: index + 2,
          values: makeRowValues(headers, row),
          fieldCount: row.length,
        }));

        resolve({
          file,
          rawHeaders,
          headers,
          rows,
          delimiter: results.meta.delimiter || undefined,
          parseIssues,
        });
      },
      error: (error) => {
        resolve({
          file,
          rawHeaders: [],
          headers: [],
          rows: [],
          parseIssues: [{ message: error.message }],
        });
      },
    });
  });
}
