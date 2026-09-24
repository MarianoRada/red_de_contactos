import { demoData } from '../data/demo';
import type { AppData } from '../types/models';

const KEY = 'red-contactos:v1';

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

export function resetData() {
  localStorage.removeItem(KEY);

  const data = clone();
  saveData(data);

  return data;
}