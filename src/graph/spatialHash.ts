export type SpatialPoint = {
  x: number;
  y: number;
};

type SpatialEntry = {
  id: string;
  point: SpatialPoint;
  radius: number;
};

export class SpatialHash {
  private readonly cells = new Map<string, Set<string>>();
  private readonly entries = new Map<string, SpatialEntry>();

  constructor(private readonly cellSize: number) {}

  private cellKey(x: number, y: number) {
    return `${Math.floor(x / this.cellSize)}:${Math.floor(
      y / this.cellSize
    )}`;
  }

  insert(id: string, point: SpatialPoint, radius: number) {
    const entry = { id, point, radius };
    const key = this.cellKey(point.x, point.y);
    const cell = this.cells.get(key) ?? new Set<string>();

    cell.add(id);
    this.cells.set(key, cell);
    this.entries.set(id, entry);
  }

  nearby(point: SpatialPoint, searchRadius: number) {
    const minCellX = Math.floor(
      (point.x - searchRadius) / this.cellSize
    );
    const maxCellX = Math.floor(
      (point.x + searchRadius) / this.cellSize
    );
    const minCellY = Math.floor(
      (point.y - searchRadius) / this.cellSize
    );
    const maxCellY = Math.floor(
      (point.y + searchRadius) / this.cellSize
    );
    const result: SpatialEntry[] = [];

    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
        const ids = this.cells.get(`${cellX}:${cellY}`);

        if (!ids) {
          continue;
        }

        ids.forEach((id) => {
          const entry = this.entries.get(id);

          if (entry) {
            result.push(entry);
          }
        });
      }
    }

    return result;
  }
}
