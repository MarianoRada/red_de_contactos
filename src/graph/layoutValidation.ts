import { SpatialHash, type SpatialPoint } from './spatialHash';

export type LayoutBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type LayoutCollision = {
  firstId: string;
  secondId: string;
  distance: number;
  minimumDistance: number;
};

export type LayoutValidation = {
  valid: boolean;
  collisions: LayoutCollision[];
  outOfBounds: string[];
};

const CELL_SIZE = 96;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function isAvailable(
  id: string,
  point: SpatialPoint,
  radius: number,
  occupied: SpatialHash,
  maxRadius: number,
  gap: number
) {
  return occupied
    .nearby(point, radius + maxRadius + gap)
    .every((entry) => {
      const distance = Math.hypot(
        point.x - entry.point.x,
        point.y - entry.point.y
      );

      return (
        distance >= radius + entry.radius + gap &&
        entry.id !== id
      );
    });
}

function findAvailablePoint(
  id: string,
  start: SpatialPoint,
  bounds: LayoutBounds,
  radius: number,
  occupied: SpatialHash,
  maxRadius: number,
  gap: number
) {
  const initial = {
    x: clamp(start.x, bounds.minX, bounds.maxX),
    y: clamp(start.y, bounds.minY, bounds.maxY),
  };

  if (isAvailable(id, initial, radius, occupied, maxRadius, gap)) {
    return initial;
  }

  const baseAngle =
    (Math.abs(hash(id)) % 360) * (Math.PI / 180);

  for (let attempt = 1; attempt <= 12000; attempt++) {
    const distance = 7 * Math.sqrt(attempt);
    const angle = baseAngle + attempt * GOLDEN_ANGLE;
    const candidate = {
      x: start.x + Math.cos(angle) * distance,
      y: start.y + Math.sin(angle) * distance * 0.78,
    };

    if (
      candidate.x < bounds.minX ||
      candidate.x > bounds.maxX ||
      candidate.y < bounds.minY ||
      candidate.y > bounds.maxY
    ) {
      continue;
    }

    if (isAvailable(id, candidate, radius, occupied, maxRadius, gap)) {
      return candidate;
    }
  }

  /*
   * Si una zona local no tiene espacio, recorremos el viewport con una
   * secuencia de baja discrepancia. Esto evita que un layout saturado termine
   * devolviendo silenciosamente una posición en colisión.
   */
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;

  for (let attempt = 0; attempt <= 20000; attempt++) {
    const u = (attempt * 0.61803398875 + 0.17) % 1;
    const v = (attempt * 0.75487766625 + 0.31) % 1;
    const candidate = {
      x: bounds.minX + u * width,
      y: bounds.minY + v * height,
    };

    if (isAvailable(id, candidate, radius, occupied, maxRadius, gap)) {
      return candidate;
    }
  }

  /*
   * Último fallback exacto: barrido uniforme del área segura. No define la
   * estética del layout; únicamente evita que un hueco estrecho quede sin
   * detectar por el muestreo orgánico cuando la densidad es alta.
   */
  const step = 8;
  const offset = Math.abs(hash(id)) % step;

  for (
    let y = bounds.minY + offset;
    y <= bounds.maxY;
    y += step
  ) {
    for (
      let x = bounds.minX + offset;
      x <= bounds.maxX;
      x += step
    ) {
      const candidate = { x, y };

      if (isAvailable(id, candidate, radius, occupied, maxRadius, gap)) {
        return candidate;
      }
    }
  }

  throw new Error(
    `No hay espacio suficiente para ubicar el nodo ${id} sin colisiones.`
  );
}

function hash(value: string) {
  return [...value].reduce(
    (result, character) =>
      ((result << 5) - result + character.charCodeAt(0)) | 0,
    0
  );
}

export function repairLayout(
  desired: ReadonlyMap<string, SpatialPoint>,
  radii: ReadonlyMap<string, number>,
  bounds: LayoutBounds,
  gap: number,
  priorityIds: ReadonlySet<string> = new Set()
) {
  const maxRadius = Math.max(...radii.values(), 0);
  const occupied = new SpatialHash(CELL_SIZE);
  const repaired = new Map<string, SpatialPoint>();
  const priorityOrder = [...desired.keys()].filter((id) =>
    priorityIds.has(id)
  );
  const regularOrder = [...desired.keys()]
    .filter((id) => !priorityIds.has(id))
    .sort(
      (firstId, secondId) =>
        (radii.get(secondId) ?? 0) -
        (radii.get(firstId) ?? 0)
    );
  const orderedIds = [
    ...priorityOrder,
    ...regularOrder,
  ];

  orderedIds.forEach((id) => {
    const point = desired.get(id);
    const radius = radii.get(id) ?? 0;

    if (!point) {
      return;
    }

    const repairedPoint = findAvailablePoint(
      id,
      point,
      bounds,
      radius,
      occupied,
      maxRadius,
      gap
    );

    repaired.set(id, repairedPoint);
    occupied.insert(id, repairedPoint, radius);
  });

  return repaired;
}

export function validateLayout(
  positions: ReadonlyMap<string, SpatialPoint>,
  radii: ReadonlyMap<string, number>,
  viewport: LayoutBounds,
  gap: number
): LayoutValidation {
  const maxRadius = Math.max(...radii.values(), 0);
  const occupied = new SpatialHash(CELL_SIZE);
  const collisions: LayoutCollision[] = [];
  const outOfBounds: string[] = [];

  positions.forEach((point, id) => {
    const radius = radii.get(id) ?? 0;

    if (
      point.x - radius < viewport.minX ||
      point.x + radius > viewport.maxX ||
      point.y - radius < viewport.minY ||
      point.y + radius > viewport.maxY
    ) {
      outOfBounds.push(id);
    }

    occupied
      .nearby(point, radius + maxRadius + gap)
      .forEach((entry) => {
        const distance = Math.hypot(
          point.x - entry.point.x,
          point.y - entry.point.y
        );
        const minimumDistance = radius + entry.radius + gap;

        if (distance < minimumDistance) {
          collisions.push({
            firstId: entry.id,
            secondId: id,
            distance,
            minimumDistance,
          });
        }
      });

    occupied.insert(id, point, radius);
  });

  return {
    valid: collisions.length === 0 && outOfBounds.length === 0,
    collisions,
    outOfBounds,
  };
}
