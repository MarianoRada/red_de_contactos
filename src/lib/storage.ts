import { demoData } from '../data/demo';
import type { AppData } from '../types/models';

const KEY = 'red-contactos:v1';
const NODE_POSITIONS_KEY = 'red-contactos:node-positions:v1';

export type StoredNodePoint = {
  x: number;
  y: number;
};

export type StoredNodePositions = Map<
  string,
  Map<string, StoredNodePoint>
>;

const clone = () =>
  JSON.parse(JSON.stringify(demoData)) as AppData;

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(KEY);

    if (raw) {
      const data = JSON.parse(raw) as AppData;
      let changed = false;

      if (
        !Array.isArray(data.records) ||
        !Array.isArray(data.relationships)
      ) {
        throw new Error('Datos inválidos');
      }

      for (const record of data.records) {
        // Leemos el tipo como string porque puede venir de datos
        // guardados con la versión anterior de la aplicación.
        const oldType = (record as { type: string }).type;

        if (oldType === 'organization') {
          record.type = 'company';
          changed = true;
        }

        if (oldType === 'project') {
          record.type = 'institution';
          changed = true;
        }
      }

      if (changed) {
        saveData(data);
      }

      return data;
    }
  } catch {
    // Si los datos guardados son inválidos,
    // se cargan nuevamente los datos demo.
  }

  const data = clone();
  saveData(data);

  return data;
}

export function saveData(data: AppData) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function loadNodePositions(): StoredNodePositions {
  try {
    const raw = localStorage.getItem(NODE_POSITIONS_KEY);

    if (!raw) {
      return new Map();
    }

    const parsed = JSON.parse(raw) as Record<
      string,
      Record<string, StoredNodePoint>
    >;

    return new Map(
      Object.entries(parsed).map(([view, nodes]) => [
        view,
        new Map(
          Object.entries(nodes).filter(
            ([, point]) =>
              Number.isFinite(point?.x) &&
              Number.isFinite(point?.y)
          )
        ),
      ])
    );
  } catch {
    return new Map();
  }
}

export function saveNodePositions(positions: StoredNodePositions) {
  try {
    const serialized = Object.fromEntries(
      [...positions].map(([view, nodes]) => [
        view,
        Object.fromEntries(nodes),
      ])
    );

    localStorage.setItem(
      NODE_POSITIONS_KEY,
      JSON.stringify(serialized)
    );
  } catch {
    // Las posiciones siguen funcionando en memoria si el almacenamiento falla.
  }
}

export function resetData() {
  localStorage.removeItem(KEY);

  const data = clone();
  saveData(data);

  return data;
}
