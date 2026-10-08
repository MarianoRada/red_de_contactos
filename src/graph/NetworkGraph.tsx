import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { MouseEvent, PointerEvent, WheelEvent } from 'react';
import {
  Info,
  MousePointer2,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

import type { ContactRecord, Relationship } from '../types/models';

import {
  loadNodePositions,
  saveNodePositions,
} from '../lib/storage';
import InfoModal from '../components/InfoModal';
import { SpatialHash } from './spatialHash';
import {
  repairLayout,
  validateLayout,
} from './layoutValidation';

type P = {
  x: number;
  y: number;
};

type Bounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type DragState = {
  id: string;
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
  moved: boolean;
  position?: P;
};

type ViewBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
};

type ZoomDirection = 'in' | 'out';

const INTRO_MS = 6200;
const INTRO_GROWTH_MS = 2000;
const INTRO_CORE_RADIUS = 4;

/* Área lógica moderada para que 400–600 nodos grandes entren sin colisiones. */
const VIEW_WIDTH = 2000;
const VIEW_HEIGHT = 1250;

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

const CX = VIEW_WIDTH / 2;
const CY = VIEW_HEIGHT / 2;

/*
 * Separación mínima entre los núcleos visibles. El hover puede ampliar
 * visualmente un núcleo, pero no participa del layout.
 */
const NODE_GAP = 4;
const SPATIAL_CELL_SIZE = 96;
const MIN_NODE_RADIUS = 3.5;
const NODE_RADIUS_STEP = 1.35;
const BASE_MAX_NODE_RADIUS = 16;
const EXTRA_NODE_RADIUS_STEP = 1.35;
const EXTRA_CONNECTIONS_START = 10;
const EXTRA_CONNECTIONS_PER_STEP = 2;
// Safety cap for pathological records; normal high-degree nodes continue
// growing well beyond 10 connections before reaching it.
const MAX_NODE_RADIUS = 28;
// The layout bounds use the same maximum as the visible core.
const MAX_LAYOUT_RADIUS = MAX_NODE_RADIUS;

/*
 * Cantidad de brazos de la galaxia.
 */
const GALAXY_ARMS = 5;

let performanceMeasureId = 0;

function measureDev<T>(
  name: string,
  detail: Record<string, number>,
  callback: () => T
) {
  if (!import.meta.env.DEV) {
    return callback();
  }

  const started = performance.now();
  const result = callback();

  try {
    performance.measure(name, {
      start: started,
      end: performance.now(),
      detail,
    });
  } catch {
    /* Las métricas de desarrollo nunca deben afectar el render. */
  }

  return result;
}

const hash = (s: string) =>
  [...s].reduce(
    (a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0,
    0
  );

/*
 * ============================================================
 * POSICIONES
 * ============================================================
 */
export function positions(
  records: ContactRecord[],
  rels: Relationship[],
  selected?: string
) {
  const map = new Map<string, P>();
  const spatialHash = new SpatialHash(SPATIAL_CELL_SIZE);

  const neighborsByNode = new Map<string, Set<string>>();

  rels.forEach((rel) => {
    const sourceNeighbors =
      neighborsByNode.get(rel.sourceId) ?? new Set<string>();
    const targetNeighbors =
      neighborsByNode.get(rel.targetId) ?? new Set<string>();

    sourceNeighbors.add(rel.targetId);
    targetNeighbors.add(rel.sourceId);
    neighborsByNode.set(rel.sourceId, sourceNeighbors);
    neighborsByNode.set(rel.targetId, targetNeighbors);
  });

  const radiusFor = (id: string) =>
    nodeSizes(neighborsByNode.get(id)?.size ?? 0).core;

  const registerPosition = (id: string, point: P) => {
    map.set(id, point);
    spatialHash.insert(id, point, radiusFor(id));
  };

  const placeWithoutOverlap = (
    id: string,
    start: P,
    bounds: Bounds
  ): P => {
    const candidateIsAvailable = (candidate: P) => {
      const nearby = spatialHash.nearby(
        candidate,
        radiusFor(id) + MAX_LAYOUT_RADIUS + NODE_GAP
      );

      return nearby.every((existing) => {
        const dx = candidate.x - existing.point.x;
        const dy = candidate.y - existing.point.y;
        const requiredDistance =
          radiusFor(id) +
          existing.radius +
          NODE_GAP;

        return Math.hypot(dx, dy) >= requiredDistance;
      });
    };

    const initial = {
      x: Math.max(bounds.minX, Math.min(bounds.maxX, start.x)),
      y: Math.max(bounds.minY, Math.min(bounds.maxY, start.y)),
    };

    if (candidateIsAvailable(initial)) {
      return initial;
    }

    /*
     * Golden-angle sampling conserva el punto original como primera opción
     * y luego explora posiciones cercanas de forma irregular. A diferencia de
     * empujar el nodo repetidamente, no queda atrapado contra otro nodo o un
     * borde cuando la zona inicial está muy cargada.
     */
    const baseAngle =
      (Math.abs(hash(id)) % 360) * (Math.PI / 180);
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));

    for (let attempt = 1; attempt <= 6000; attempt++) {
      const distance = 7 * Math.sqrt(attempt);
      const angle = baseAngle + attempt * goldenAngle;
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

      if (candidateIsAvailable(candidate)) {
        return candidate;
      }
    }

    /*
     * Este es solo el primer intento local. El layout completo se repara y
     * valida después con repairLayout(), que también busca en todo el área.
     */
    return initial;
  };

  const finalizeLayout = () => {
    const radii = new Map(
      [...map.keys()].map((id) => [id, radiusFor(id)])
    );
    const repaired = repairLayout(
      map,
      radii,
      {
        minX: MAX_LAYOUT_RADIUS + NODE_GAP,
        maxX: VIEW_WIDTH - MAX_LAYOUT_RADIUS - NODE_GAP,
        minY: MAX_LAYOUT_RADIUS + NODE_GAP,
        maxY: VIEW_HEIGHT - MAX_LAYOUT_RADIUS - NODE_GAP,
      },
      NODE_GAP
    );
    const validation = validateLayout(
      repaired,
      radii,
      {
        minX: 0,
        maxX: VIEW_WIDTH,
        minY: 0,
        maxY: VIEW_HEIGHT,
      },
      NODE_GAP
    );

    if (!validation.valid) {
      throw new Error(
        `Layout inválido: ${validation.collisions.length} colisiones y ${validation.outOfBounds.length} nodos fuera del viewport.`
      );
    }

    return repaired;
  };

  /*
   * ============================================================
   * CUANDO HAY UN NODO SELECCIONADO
   * ============================================================
   */
  if (selected) {
    registerPosition(selected, {
      x: CX,
      y: CY,
    });

    const neighbors = [
      ...(neighborsByNode.get(selected) ?? []),
    ];

    /*
     * Vecinos directos alrededor del nodo seleccionado.
     */
    const neighborRadiusX = Math.min(
      460,
      Math.max(270, neighbors.length * 28)
    );

    const neighborRadiusY = Math.min(
      330,
      Math.max(205, neighbors.length * 20)
    );

    neighbors.forEach((id, i) => {
      const angle =
        (Math.PI * 2 * i) /
          Math.max(neighbors.length, 1) -
        Math.PI / 2;

      const wobble =
        (Math.abs(hash(id)) % 30) - 15;

      registerPosition(
        id,
        placeWithoutOverlap(
          id,
          {
            x:
              CX +
              Math.cos(angle) *
                (neighborRadiusX + wobble),
            y:
              CY +
              Math.sin(angle) *
                (neighborRadiusY + wobble * 0.5),
          },
          {
            minX: 90,
            maxX: VIEW_WIDTH - 90,
            minY: 110,
            maxY: VIEW_HEIGHT - 110,
          }
        )
      );
    });

    /*
     * Resto de los nodos.
     */
    const rest = records.filter(
      (record) => !map.has(record.id)
    );

    const nodesPerRing = 36;

    rest.forEach((record, i) => {
      const ringIndex = Math.floor(
        i / nodesPerRing
      );

      const indexInRing =
        i % nodesPerRing;

      const remaining =
        rest.length -
        ringIndex * nodesPerRing;

      const countInRing = Math.min(
        nodesPerRing,
        remaining
      );

      const angle =
        (Math.PI * 2 * indexInRing) /
          Math.max(countInRing, 1) -
        Math.PI / 2 +
        ringIndex * 0.15;

      const radiusX =
        470 + ringIndex * 115;

      const radiusY =
        320 + ringIndex * 75;

      const wobble =
        (Math.abs(hash(record.id)) % 24) - 12;

      let x =
        CX +
        Math.cos(angle) *
          (radiusX + wobble);

      let y =
        CY +
        Math.sin(angle) *
          (radiusY + wobble);

      x = Math.max(
        110,
        Math.min(VIEW_WIDTH - 110, x)
      );

      y = Math.max(
        150,
        Math.min(VIEW_HEIGHT - 150, y)
      );

      registerPosition(
        record.id,
        placeWithoutOverlap(
          record.id,
          { x, y },
          {
            minX: 110,
            maxX: VIEW_WIDTH - 110,
            minY: 150,
            maxY: VIEW_HEIGHT - 150,
          }
        )
      );
    });

    return finalizeLayout();
  }

  /*
   * ============================================================
   * VISTA GENERAL — GALAXIA ESPIRAL
   * ============================================================
   */

  const total = records.length;

  if (total === 0) {
    return map;
  }

  /*
   * Límites de seguridad.
   *
   * Dejamos espacio para:
   * - título
   * - leyenda
   * - controles laterales
   */
  const leftLimit = 105;
  const rightLimit = VIEW_WIDTH - 105;

  const topLimit = 155;
  const bottomLimit = VIEW_HEIGHT - 155;

  /*
   * Tamaño máximo de la galaxia.
   *
   * Es más ancha que alta porque la pantalla
   * tiene formato horizontal.
   */
  const maxRadiusX = (rightLimit - leftLimit) * 0.46;
  const maxRadiusY = (bottomLimit - topLimit) * 0.46;

  /*
   * Separamos los registros en brazos.
   */
  records.forEach((record, i) => {
    const h =
      Math.abs(hash(record.id));

    /*
     * Cada nodo pertenece a uno de los brazos.
     */
    const arm =
      i % GALAXY_ARMS;

    /*
     * Posición dentro de su brazo.
     *
     * 0 = centro
     * 1 = extremo exterior
     */
    const indexInArm =
      Math.floor(
        i / GALAXY_ARMS
      );

    const nodesInThisArm =
      Math.ceil(
        (total - arm) /
          GALAXY_ARMS
      );

    const progress =
      nodesInThisArm <= 1
        ? 0
        : indexInArm /
          (nodesInThisArm - 1);

    /*
     * sqrt hace que el centro tenga densidad,
     * pero evita que todos queden acumulados ahí.
     */
    const radialProgress =
      Math.sqrt(
        Math.max(progress, 0.025)
      );

    /*
     * Cada brazo empieza separado 120 grados.
     */
    const armOffset =
      arm *
      ((Math.PI * 2) /
        GALAXY_ARMS);

    /*
     * Cantidad de giro del brazo.
     *
     * 1.65 vueltas aproximadamente.
     */
    const spiralRotation =
      progress *
      Math.PI *
      3.3;

    /*
     * Ruido angular.
     *
     * Hace que los nodos no formen una línea
     * perfecta dentro del brazo.
     */
    const angleNoise =
      ((h % 101) - 50) /
      155;

    const angle =
      armOffset +
      spiralRotation +
      angleNoise;

    /*
     * Radio.
     *
     * Los primeros nodos empiezan cerca del núcleo
     * y los últimos llegan a la periferia.
     */
    const radiusX =
      45 +
      radialProgress *
        maxRadiusX;

    const radiusY =
      30 +
      radialProgress *
        maxRadiusY;

    /*
     * Dispersión lateral.
     *
     * Fundamental para que parezca una galaxia
     * y no tres líneas espirales.
     */
    const spread =
      20 +
      progress * 48;

    const spreadX =
      (((h >> 2) % 101) - 50) /
      50 *
      spread;

    const spreadY =
      (((h >> 5) % 101) - 50) /
      50 *
      spread *
      0.72;

    /*
     * Pequeña ondulación adicional.
     */
    const waveX =
      Math.sin(
        angle * 2.15
      ) *
      14;

    const waveY =
      Math.cos(
        angle * 1.85
      ) *
      10;

    let x =
      CX +
      Math.cos(angle) *
        radiusX +
      spreadX +
      waveX;

    let y =
      CY +
      Math.sin(angle) *
        radiusY +
      spreadY +
      waveY;

    /*
     * ============================================================
     * LÍMITES INICIALES
     * ============================================================
     */
    x = Math.max(
      leftLimit,
      Math.min(
        rightLimit,
        x
      )
    );

    y = Math.max(
      topLimit,
      Math.min(
        bottomLimit,
        y
      )
    );

    /*
     * ============================================================
     * CONTROL DE COLISIONES
     * ============================================================
     *
     * Si un nodo está demasiado cerca de otro,
     * buscamos otra posición cercana.
     */
    let attempts = 0;

    while (attempts < 220) {
      let collision = false;
      let collisionAngle = angle;
      let collisionDistance = 0;

      const nearby = spatialHash.nearby(
        { x, y },
        radiusFor(record.id) + MAX_LAYOUT_RADIUS + NODE_GAP
      );

      for (const existing of nearby) {
        const dx =
          x - existing.point.x;

        const dy =
          y - existing.point.y;

        const distance =
          Math.sqrt(
            dx * dx +
            dy * dy
          );

        const requiredDistance =
          radiusFor(record.id) +
          existing.radius +
          NODE_GAP;

        if (distance < requiredDistance) {
          collision = true;
          collisionAngle =
            distance > 0.001
              ? Math.atan2(dy, dx)
              : angle;
          collisionDistance =
            requiredDistance - distance + 1;
          break;
        }
      }

      /*
       * Si ya tenemos suficiente separación,
       * terminamos.
       */
      if (!collision) {
        break;
      }

      /*
       * Buscamos otra posición alrededor
       * siguiendo una mini espiral.
       */
      const correctionAngle = collisionAngle;

      const correctionDistance =
        collisionDistance;

      x +=
        Math.cos(
          correctionAngle
        ) *
        correctionDistance;

      y +=
        Math.sin(
          correctionAngle
        ) *
        correctionDistance;

      /*
       * Volvemos a respetar los límites.
       */
      x = Math.max(
        leftLimit,
        Math.min(
          rightLimit,
          x
        )
      );

      y = Math.max(
        topLimit,
        Math.min(
          bottomLimit,
          y
        )
      );

      attempts++;
    }

    registerPosition(
      record.id,
      placeWithoutOverlap(
        record.id,
        { x, y },
        {
          minX: leftLimit,
          maxX: rightLimit,
          minY: topLimit,
          maxY: bottomLimit,
        }
      )
    );
  });

  return finalizeLayout();
}

/*
 * ============================================================
 * POSICIÓN INICIAL DE LA ANIMACIÓN
 * ============================================================
 */
function introStart(
  records: ContactRecord[]
) {
  const map = new Map<string, P>();

  records.forEach((record, i) => {
    const h =
      Math.abs(hash(record.id));

    const arm =
      i % GALAXY_ARMS;

    const armOffset =
      arm *
      ((Math.PI * 2) /
        GALAXY_ARMS);

    const angle =
      armOffset +
      ((h % 360) / 180) *
        Math.PI +
      i * 0.18;

    const ring =
      170 +
      (h % 380);

    let x =
      CX +
      Math.cos(angle) *
        ring;

    let y =
      CY +
      Math.sin(angle) *
        ring *
        0.58;

    x = Math.max(
      100,
      Math.min(
        VIEW_WIDTH - 100,
        x
      )
    );

    y = Math.max(
      120,
      Math.min(
        VIEW_HEIGHT - 120,
        y
      )
    );

    map.set(record.id, {
      x,
      y,
    });
  });

  return map;
}

/*
 * ============================================================
 * TEXTO CORTO
 * ============================================================
 */
const short = (
  s: string
) =>
  s.length > 24
    ? s.slice(0, 23) + '…'
    : s;

/*
 * ============================================================
 * POSICIÓN DE ETIQUETAS DE RELACIONES
 * ============================================================
 */
function labelPoint(
  a: P,
  b: P,
  rel: Relationship,
  selectedId?: string
) {
  if (
    selectedId &&
    (rel.sourceId ===
      selectedId ||
      rel.targetId ===
        selectedId)
  ) {
    const from =
      rel.sourceId ===
      selectedId
        ? a
        : b;

    const to =
      rel.sourceId ===
      selectedId
        ? b
        : a;

    const t = 0.62;

    return {
      x:
        from.x +
        (to.x - from.x) *
          t,

      y:
        from.y +
        (to.y - from.y) *
          t,
    };
  }

  return {
    x:
      (a.x + b.x) /
      2,

    y:
      (a.y + b.y) /
      2,
  };
}

/*
 * Tamaño visual según la cantidad de nodos conectados.
 * El límite evita que un nodo muy vinculado tape toda la red,
 * pero cada vínculo sigue aumentando su tamaño hasta alcanzarlo.
 */
type GraphEdgeProps = {
  rel: Relationship;
  a: P;
  b: P;
  active: boolean;
  muted: boolean;
  labelPosition?: P;
  labelWidth: number;
  edgeRef: (element: SVGLineElement | null) => void;
};

const GraphEdge = memo(function GraphEdge({
  rel,
  a,
  b,
  active,
  muted,
  labelPosition,
  labelWidth,
  edgeRef,
}: GraphEdgeProps) {
  return (
    <g
      className={`edge ${active ? 'active' : ''} ${muted ? 'muted' : ''}`}
    >
      <line
        ref={edgeRef}
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
      />

      {active && labelPosition && (
        <g
          className="edge-label"
          transform={`translate(${labelPosition.x},${labelPosition.y})`}
        >
          <rect
            x={-labelWidth / 2}
            y="-14"
            width={labelWidth}
            height="28"
            rx="14"
          />

          <text x="0" y="4">
            {rel.type}
          </text>
        </g>
      )}
    </g>
  );
});

function nodeSizes(connectionCount: number) {
  const baseRadius = Math.min(
    MIN_NODE_RADIUS + connectionCount * NODE_RADIUS_STEP,
    BASE_MAX_NODE_RADIUS
  );
  const extraConnectionCount = Math.max(
    0,
    connectionCount - EXTRA_CONNECTIONS_START
  );
  const extraRadius =
    Math.floor(
      extraConnectionCount / EXTRA_CONNECTIONS_PER_STEP
    ) * EXTRA_NODE_RADIUS_STEP;

  return {
    core: Math.min(baseRadius + extraRadius, MAX_NODE_RADIUS),
  };
}

type RelationIndex = {
  neighborsByNode: Map<string, Set<string>>;
  connectionCounts: Map<string, number>;
  relationshipsByNode: Map<string, Relationship[]>;
};

function buildRelationIndex(
  relationships: Relationship[]
): RelationIndex {
  const neighborsByNode = new Map<string, Set<string>>();
  const relationshipsByNode = new Map<string, Relationship[]>();

  relationships.forEach((rel) => {
    const sourceNeighbors =
      neighborsByNode.get(rel.sourceId) ?? new Set<string>();
    const targetNeighbors =
      neighborsByNode.get(rel.targetId) ?? new Set<string>();

    sourceNeighbors.add(rel.targetId);
    targetNeighbors.add(rel.sourceId);
    neighborsByNode.set(rel.sourceId, sourceNeighbors);
    neighborsByNode.set(rel.targetId, targetNeighbors);

    const sourceRelations =
      relationshipsByNode.get(rel.sourceId) ?? [];
    const targetRelations =
      relationshipsByNode.get(rel.targetId) ?? [];

    sourceRelations.push(rel);
    targetRelations.push(rel);
    relationshipsByNode.set(rel.sourceId, sourceRelations);
    relationshipsByNode.set(rel.targetId, targetRelations);
  });

  return {
    neighborsByNode,
    relationshipsByNode,
    connectionCounts: new Map(
      [...neighborsByNode].map(([id, neighbors]) => [
        id,
        neighbors.size,
      ])
    ),
  };
}

const EMPTY_NEIGHBORS = new Set<string>();

/*
 * ============================================================
 * PROPS
 * ============================================================
 */
type NetworkGraphProps = {
  records: ContactRecord[];
  relationships: Relationship[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onClear: () => void;
  canEdit: boolean;
};

/*
 * ============================================================
 * COMPONENTE
 * ============================================================
 */
function NetworkGraph({
  records,
  relationships,
  selectedId,
  onSelect,
  onClear,
  canEdit,
}: NetworkGraphProps) {
  const renderMeasureId = import.meta.env.DEV
    ? `${++performanceMeasureId}`
    : undefined;

  if (renderMeasureId) {
    try {
      performance.mark(`red-contactos:render-start-${renderMeasureId}`);
    } catch {
      /* Las métricas de desarrollo nunca deben afectar el render. */
    }
  }

  useEffect(() => {
    if (!renderMeasureId) {
      return;
    }

    try {
      const endMark = `red-contactos:render-end-${renderMeasureId}`;

      performance.mark(endMark);
      performance.measure('red-contactos:graph-render', {
        start: `red-contactos:render-start-${renderMeasureId}`,
        end: endMark,
        detail: {
          nodes: records.length,
          edges: relationships.length,
        },
      });
      performance.clearMarks(
        `red-contactos:render-start-${renderMeasureId}`
      );
      performance.clearMarks(endMark);
    } catch {
      /* Las métricas de desarrollo nunca deben afectar el render. */
    }
  }, [renderMeasureId, records.length, relationships.length]);

  const hoveredIdRef = useRef<string>();

  const [
    intro,
    setIntro,
  ] =
    useState(true);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState>();
  const dragSpatialHashRef = useRef<SpatialHash>();
  const suppressClickRef = useRef(false);
  const [customPositionsByView, setCustomPositionsByView] = useState<
    Map<string, Map<string, P>>
  >(() => loadNodePositions());
  const [zoomMode, setZoomMode] = useState(false);
  const [zoomDirection, setZoomDirection] =
    useState<ZoomDirection>('in');
  const [infoOpen, setInfoOpen] = useState(false);
  const viewBoxRef = useRef<ViewBox>({
    x: 0,
    y: 0,
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
    scale: 1,
  });

  /* La selección solo cambia estilos; no crea un layout nuevo. */
  const layoutKey = 'all';

  /*
   * Posiciones finales.
   */
  const finalPos =
    useMemo(
      () =>
        measureDev(
          'red-contactos:layout',
          {
            nodes: records.length,
            edges: relationships.length,
          },
          () =>
            positions(
              records,
              relationships
            )
        ),
      [
        records,
        relationships,
      ]
    );

  /*
   * Posiciones iniciales.
   */
  const startPos =
    useMemo(
      () =>
        introStart(
          records
        ),
      [records]
    );

  const relationIndex = useMemo(
    () => buildRelationIndex(relationships),
    [relationships]
  );

  const frame =
    useRef<number>();
  const nodeRefs = useRef<Map<string, SVGGElement>>(new Map());
  const edgeRefs = useRef<Map<string, SVGLineElement>>(new Map());
  const nodeRefCallbacks = useRef<
    Map<string, (element: SVGGElement | null) => void>
  >(new Map());
  const edgeRefCallbacks = useRef<
    Map<string, (element: SVGLineElement | null) => void>
  >(new Map());

  const getNodeRef = (id: string) => {
    const existing = nodeRefCallbacks.current.get(id);

    if (existing) {
      return existing;
    }

    const callback = (element: SVGGElement | null) => {
      if (element) {
        nodeRefs.current.set(id, element);
      } else {
        nodeRefs.current.delete(id);
      }
    };

    nodeRefCallbacks.current.set(id, callback);
    return callback;
  };

  const getEdgeRef = (id: string) => {
    const existing = edgeRefCallbacks.current.get(id);

    if (existing) {
      return existing;
    }

    const callback = (element: SVGLineElement | null) => {
      if (element) {
        edgeRefs.current.set(id, element);
      } else {
        edgeRefs.current.delete(id);
      }
    };

    edgeRefCallbacks.current.set(id, callback);
    return callback;
  };

  const renderedPos = useMemo(() => {
    const next = new Map(finalPos);
    const customPositions = customPositionsByView.get(layoutKey);
    const priorityIds = new Set<string>();

    customPositions?.forEach((point, id) => {
      if (next.has(id)) {
        next.set(id, point);
        priorityIds.add(id);
      }
    });

    const radii = new Map(
      [...next.keys()].map((id) => [
        id,
        nodeSizes(
          relationIndex.connectionCounts.get(id) ?? 0
        ).core,
      ])
    );

    const repaired = repairLayout(
      next,
      radii,
      {
        minX: MAX_LAYOUT_RADIUS + NODE_GAP,
        maxX: VIEW_WIDTH - MAX_LAYOUT_RADIUS - NODE_GAP,
        minY: MAX_LAYOUT_RADIUS + NODE_GAP,
        maxY: VIEW_HEIGHT - MAX_LAYOUT_RADIUS - NODE_GAP,
      },
      NODE_GAP,
      priorityIds
    );

    const validation = validateLayout(
      repaired,
      radii,
      {
        minX: 0,
        maxX: VIEW_WIDTH,
        minY: 0,
        maxY: VIEW_HEIGHT,
      },
      NODE_GAP
    );

    if (!validation.valid) {
      throw new Error(
        `Layout manual inválido: ${validation.collisions.length} colisiones y ${validation.outOfBounds.length} nodos fuera del viewport.`
      );
    }

    return repaired;
  }, [
    customPositionsByView,
    finalPos,
    layoutKey,
    relationIndex,
  ]);

  useEffect(() => {
    if (!canEdit) {
      return;
    }

    saveNodePositions(customPositionsByView);
  }, [canEdit, customPositionsByView]);

  /*
   * ============================================================
   * ANIMACIÓN INICIAL
   * ============================================================
   */
  useEffect(() => {
    const started =
      performance.now();

    const tick = (
      now: number
    ) => {
      const raw =
        Math.min(
          1,
          (now -
            started) /
            INTRO_MS
        );

      const eased =
        1 -
        Math.pow(
          1 - raw,
          4
        );

      records.forEach(
        (
          record,
          i
        ) => {
          const from =
            startPos.get(
              record.id
            )!;

          const to =
            renderedPos.get(
              record.id
            )!;

          const h =
            Math.abs(
              hash(
                record.id
              )
            );

          const energy =
            Math.pow(
              1 - raw,
              2.35
            );

          const phase =
            (h % 628) /
              100 +
            i * 0.8;

          const orbitX =
            Math.sin(
              raw * 18 +
                phase
            ) *
            (42 +
              (h % 55)) *
            energy;

          const orbitY =
            Math.cos(
              raw * 15 +
                phase
            ) *
            (30 +
              (h % 42)) *
            energy;

          const x =
            from.x +
            (to.x - from.x) *
              eased +
            orbitX;
          const y =
            from.y +
            (to.y - from.y) *
              eased +
            orbitY;
          const element = nodeRefs.current.get(record.id);

          element?.setAttribute(
            'transform',
            `translate(${x},${y})`
          );
        }
      );

      if (raw < 1) {
        frame.current =
          requestAnimationFrame(
            tick
          );
      } else {
        records.forEach((record) => {
          const point = renderedPos.get(record.id);
          const element = nodeRefs.current.get(record.id);

          if (point) {
            element?.setAttribute(
              'transform',
              `translate(${point.x},${point.y})`
            );
          }
        });

        setIntro(false);
      }
    };

    frame.current =
      requestAnimationFrame(
        tick
      );

    return () => {
      if (
        frame.current
      ) {
        cancelAnimationFrame(
          frame.current
        );
      }
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * El layout final ya contiene el radio real de cada nÃºcleo. Para evitar que
   * aparezca de golpe al terminar la intro, conservamos visualmente el radio
   * inicial y animamos solo un transform del SVG durante 1,5 segundos.
   */
  useLayoutEffect(() => {
    if (intro) {
      return;
    }

    const cores = [...nodeRefs.current.values()]
      .map((node) =>
        node.querySelector<SVGCircleElement>('.node-core')
      )
      .filter((core): core is SVGCircleElement => core !== null);

    cores.forEach((core) => {
      const finalRadius = Number(core.getAttribute('r')) || INTRO_CORE_RADIUS;
      const initialScale = Math.min(
        1,
        INTRO_CORE_RADIUS / finalRadius
      );

      core.style.transformBox = 'fill-box';
      core.style.transformOrigin = 'center';
      core.style.transition = 'none';
      core.style.transform = `scale(${initialScale})`;
      void core.getBoundingClientRect();
      core.style.transition = `transform ${INTRO_GROWTH_MS}ms ease-in-out`;
    });

    const growthFrame = requestAnimationFrame(() => {
      cores.forEach((core) => {
        core.style.transform = 'scale(1)';
      });
    });

    return () => cancelAnimationFrame(growthFrame);
  }, [intro]);

  const pos =
    intro
      ? startPos
      : renderedPos;

  const setHoverNodeVisual = (id: string, active: boolean) => {
    const node = nodeRefs.current.get(id);

    if (!node) {
      return;
    }

    node.classList.toggle('hovered', active);

    const selected = node.classList.contains('selected');
    const introNode = node.classList.contains('intro-node');
    const sizes = nodeSizes(
      relationIndex.connectionCounts.get(id) ?? 0
    );
    const core = node.querySelector<SVGCircleElement>('.node-core');

    core?.setAttribute(
      'r',
      `${active ? Math.max(7, sizes.core) : selected ? 8 : introNode ? 4 : sizes.core}`
    );
  };

  const setHoverEdgeVisual = (rel: Relationship, active: boolean) => {
    edgeRefs.current
      .get(rel.id)
      ?.parentElement
      ?.classList.toggle('hover-active', active);
  };

  const applyHoverVisuals = (id: string, active: boolean) => {
    setHoverNodeVisual(id, active);

    relationIndex.neighborsByNode
      .get(id)
      ?.forEach((neighborId) =>
        nodeRefs.current
          .get(neighborId)
          ?.classList.toggle('hover-neighbor', active)
      );

    relationIndex.relationshipsByNode
      .get(id)
      ?.forEach((rel) => setHoverEdgeVisual(rel, active));
  };

  const setHoveredNode = (nextId?: string) => {
    const previousId = hoveredIdRef.current;

    if (previousId === nextId) {
      return;
    }

    measureDev(
      'red-contactos:hover',
      {
        nodes: nextId ? 1 : previousId ? 1 : 0,
        edges: nextId
          ? relationIndex.relationshipsByNode.get(nextId)?.length ?? 0
          : previousId
            ? relationIndex.relationshipsByNode.get(previousId)?.length ?? 0
            : 0,
      },
      () => {
        if (previousId) {
          applyHoverVisuals(previousId, false);
        }

        hoveredIdRef.current = nextId;

        if (nextId) {
          applyHoverVisuals(nextId, true);
        }
      }
    );
  };

  useEffect(() => {
    const currentId = hoveredIdRef.current;

    if (currentId) {
      applyHoverVisuals(currentId, true);
    }
  });

  const resolveDraggedPoint = (id: string, start: P): P => {
    const occupied = dragSpatialHashRef.current;
    const radius = nodeSizes(
      relationIndex.connectionCounts.get(id) ?? 0
    ).core;
    const maxRadius = MAX_LAYOUT_RADIUS;
    const bounds = {
      minX: maxRadius + NODE_GAP,
      maxX: VIEW_WIDTH - maxRadius - NODE_GAP,
      minY: maxRadius + NODE_GAP,
      maxY: VIEW_HEIGHT - maxRadius - NODE_GAP,
    };
    const candidateIsAvailable = (candidate: P) =>
      occupied
        ?.nearby(candidate, radius + maxRadius + NODE_GAP)
        .every((entry) =>
          Math.hypot(
            candidate.x - entry.point.x,
            candidate.y - entry.point.y
          ) >= radius + entry.radius + NODE_GAP
        ) ?? true;
    const initial = {
      x: Math.max(bounds.minX, Math.min(bounds.maxX, start.x)),
      y: Math.max(bounds.minY, Math.min(bounds.maxY, start.y)),
    };

    if (candidateIsAvailable(initial)) {
      return initial;
    }

    const baseAngle =
      (Math.abs(hash(id)) % 360) * (Math.PI / 180);
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));

    for (let attempt = 1; attempt <= 12000; attempt++) {
      const distance = 7 * Math.sqrt(attempt);
      const angle = baseAngle + attempt * goldenAngle;
      const candidate = {
        x: start.x + Math.cos(angle) * distance,
        y: start.y + Math.sin(angle) * distance * 0.78,
      };

      if (
        candidate.x >= bounds.minX &&
        candidate.x <= bounds.maxX &&
        candidate.y >= bounds.minY &&
        candidate.y <= bounds.maxY &&
        candidateIsAvailable(candidate)
      ) {
        return candidate;
      }
    }

    throw new Error(
      `No hay espacio suficiente para mover el nodo ${id} sin colisiones.`
    );
  };

  const screenToGraphPoint = (
    clientX: number,
    clientY: number
  ): P | undefined => {
    const svg = svgRef.current;
    const screenMatrix = svg?.getScreenCTM();

    if (!svg || !screenMatrix) {
      return undefined;
    }

    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;

    const graphPoint = point.matrixTransform(
      screenMatrix.inverse()
    );

    return {
      x: Math.max(0, Math.min(VIEW_WIDTH, graphPoint.x)),
      y: Math.max(0, Math.min(VIEW_HEIGHT, graphPoint.y)),
    };
  };

  const zoomAt = (
    clientX: number,
    clientY: number,
    factor: number
  ) => {
    const point = screenToGraphPoint(clientX, clientY);

    if (!point) {
      return;
    }

    const current = viewBoxRef.current;
    const nextScale = Math.max(
      MIN_ZOOM,
      Math.min(MAX_ZOOM, current.scale * factor)
    );
    const nextWidth = VIEW_WIDTH / nextScale;
    const nextHeight = VIEW_HEIGHT / nextScale;
    const relativeX =
      (point.x - current.x) / current.width;
    const relativeY =
      (point.y - current.y) / current.height;
    const next = {
      scale: nextScale,
      width: nextWidth,
      height: nextHeight,
      x: Math.max(
        0,
        Math.min(VIEW_WIDTH - nextWidth, point.x - relativeX * nextWidth)
      ),
      y: Math.max(
        0,
        Math.min(VIEW_HEIGHT - nextHeight, point.y - relativeY * nextHeight)
      ),
    };

    viewBoxRef.current = next;
    svgRef.current?.setAttribute(
      'viewBox',
      `${next.x} ${next.y} ${next.width} ${next.height}`
    );
  };

  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    if (!zoomMode) {
      return;
    }

    event.preventDefault();
    zoomAt(
      event.clientX,
      event.clientY,
      event.deltaY < 0 ? 1.18 : 0.85
    );
  };

  const handleZoomClick = (
    event: MouseEvent<SVGSVGElement>
  ) => {
    if (!zoomMode) {
      return;
    }

    const target = event.target;

    if (target instanceof Element && target.closest('.node')) {
      return;
    }

    event.preventDefault();
    zoomAt(
      event.clientX,
      event.clientY,
      zoomDirection === 'in' ? 1.35 : 0.74
    );
  };

  const handlePointerDown = (
    event: PointerEvent<SVGGElement>,
    id: string
  ) => {
    if (intro) {
      return;
    }

    if (zoomMode) {
      event.preventDefault();
      event.stopPropagation();
      zoomAt(
        event.clientX,
        event.clientY,
        zoomDirection === 'in' ? 1.35 : 0.74
      );
      return;
    }

    if (!canEdit) {
      return;
    }

    const point = screenToGraphPoint(
      event.clientX,
      event.clientY
    );
    const nodePosition = pos.get(id);

    if (!point || !nodePosition) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = false;
    const dragSpatialHash = new SpatialHash(SPATIAL_CELL_SIZE);

    pos.forEach((otherPoint, otherId) => {
      if (otherId !== id) {
        dragSpatialHash.insert(
          otherId,
          otherPoint,
          nodeSizes(
            relationIndex.connectionCounts.get(otherId) ?? 0
          ).core
        );
      }
    });

    dragSpatialHashRef.current = dragSpatialHash;
    nodeRefs.current.get(id)?.classList.add('dragging');
    dragRef.current = {
      id,
      offsetX: nodePosition.x - point.x,
      offsetY: nodePosition.y - point.y,
      startX: point.x,
      startY: point.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const commitCustomPosition = (id: string, point: P) => {
    setCustomPositionsByView((previous) => {
      const next = new Map(previous);
      const viewPositions = new Map(
        next.get(layoutKey) ?? []
      );

      viewPositions.set(id, point);
      next.set(layoutKey, viewPositions);

      if (layoutKey !== 'all') {
        const allPositions = new Map(
          next.get('all') ?? []
        );

        allPositions.set(id, point);
        next.set('all', allPositions);
      }

      return next;
    });
  };

  const handlePointerMove = (
    event: PointerEvent<SVGSVGElement>
  ) => {
    const drag = dragRef.current;

    if (!drag) {
      return;
    }

    const point = screenToGraphPoint(
      event.clientX,
      event.clientY
    );

    if (!point) {
      return;
    }

    const distance = Math.hypot(
      point.x - drag.startX,
      point.y - drag.startY
    );

    if (!drag.moved && distance < 3) {
      return;
    }

    drag.moved = true;
    suppressClickRef.current = true;

    const nextPoint = resolveDraggedPoint(drag.id, {
      x: point.x + drag.offsetX,
      y: point.y + drag.offsetY,
    });

    drag.position = nextPoint;
    nodeRefs.current
      .get(drag.id)
      ?.setAttribute(
        'transform',
        `translate(${nextPoint.x},${nextPoint.y})`
      );

    relationIndex.relationshipsByNode
      .get(drag.id)
      ?.forEach((rel) => {
        const source =
          rel.sourceId === drag.id
            ? nextPoint
            : pos.get(rel.sourceId);
        const target =
          rel.targetId === drag.id
            ? nextPoint
            : pos.get(rel.targetId);
        const line = edgeRefs.current.get(rel.id);

        if (source && target && line) {
          line.setAttribute('x1', `${source.x}`);
          line.setAttribute('y1', `${source.y}`);
          line.setAttribute('x2', `${target.x}`);
          line.setAttribute('y2', `${target.y}`);
        }
      });
  };

  const handlePointerUp = () => {
    const drag = dragRef.current;

    if (!drag) {
      return;
    }

    if (drag.moved && drag.position) {
      commitCustomPosition(drag.id, drag.position);
    }

    suppressClickRef.current = drag.moved;
    nodeRefs.current.get(drag.id)?.classList.remove('dragging');
    dragRef.current = undefined;
    dragSpatialHashRef.current = undefined;
  };

  /*
   * Vecinos del nodo seleccionado.
   */
  const related = selectedId
    ? relationIndex.neighborsByNode.get(selectedId) ??
      EMPTY_NEIGHBORS
    : EMPTY_NEIGHBORS;

  /*
   * Grado de cada nodo: contamos nodos vecinos únicos, no relaciones
   * repetidas entre el mismo par.
   */
  const { connectionCounts } = relationIndex;

  const introProgressClass =
    intro
      ? 'intro-running'
      : 'intro-finished';

  /*
   * ============================================================
   * RENDER
   * ============================================================
   */
  return (
    <section
      className={`graph-wrap ${introProgressClass}`}
    >
      <div
        className={`graph-stage ${zoomMode ? 'zoom-mode' : ''} ${
          zoomMode && zoomDirection === 'out'
            ? 'zoom-out-mode'
            : ''
        }`}
      >

        {/* TÍTULO */}

        <div className="graph-title">
          <div>
            <small>
              RED INTERACTIVA
            </small>

            <h1>
              Mapa de relaciones
            </h1>
          </div>

          {selectedId &&
            !intro && (
              <button
                className="network-clear"
                onClick={
                  onClear
                }
              >
                × &nbsp; Ver toda la red
              </button>
          )}
        </div>

        <button
          className="info-tool"
          type="button"
          aria-label="Mostrar información"
          title="Mostrar información"
          onClick={() => setInfoOpen(true)}
        >
          <Info size={19} />
        </button>

        <div className="zoom-controls">
          <button
            className={`zoom-tool ${zoomMode ? 'active' : ''}`}
            type="button"
            aria-label={zoomMode ? 'Volver al cursor normal' : 'Activar lupa'}
            aria-pressed={zoomMode}
            title={zoomMode ? 'Volver al cursor normal' : 'Activar lupa'}
            onClick={() => {
              setZoomMode((value) => !value);
              setZoomDirection('in');
            }}
          >
            {zoomMode ? <MousePointer2 size={18} /> : <Search size={18} />}
          </button>

          {zoomMode && (
            <button
              className="zoom-tool zoom-direction"
              type="button"
              aria-label={
                zoomDirection === 'in'
                  ? 'Activar modo alejar'
                  : 'Activar modo acercar'
              }
              title={
                zoomDirection === 'in'
                  ? 'Cambiar a modo alejar'
                  : 'Cambiar a modo acercar'
              }
              onClick={() =>
                setZoomDirection((value) =>
                  value === 'in' ? 'out' : 'in'
                )
              }
            >
              {zoomDirection === 'in' ? (
                <ZoomOut size={18} />
              ) : (
                <ZoomIn size={18} />
              )}
            </button>
          )}
        </div>

        {/* SVG */}

        <svg
          ref={svgRef}
          className="graph"
          viewBox={`${viewBoxRef.current.x} ${viewBoxRef.current.y} ${viewBoxRef.current.width} ${viewBoxRef.current.height}`}
          role="img"
          aria-label="Mapa interactivo de relaciones"
          preserveAspectRatio="xMidYMid meet"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
          onClick={handleZoomClick}
        >
          {/* RELACIONES */}

          <g className="network-lines">
            {relationships.map(
              (rel) => {
                const a =
                  pos.get(
                    rel.sourceId
                  );

                const b =
                  pos.get(
                    rel.targetId
                  );

                if (
                  !a ||
                  !b
                ) {
                  return null;
                }

                const active =
                  !intro &&
                  !!selectedId &&
                  (rel.sourceId ===
                    selectedId ||
                    rel.targetId ===
                      selectedId);

                const muted =
                  !intro &&
                  !!selectedId &&
                  !active;

                const labelPosition = active
                  ? labelPoint(a, b, rel, selectedId)
                  : undefined;
                const labelWidth = Math.max(
                  112,
                  rel.type.length * 7.2 + 24
                );

                return (
                  <GraphEdge
                    key={rel.id}
                    rel={rel}
                    a={a}
                    b={b}
                    active={active}
                    muted={muted}
                    labelPosition={labelPosition}
                    labelWidth={labelWidth}
                    edgeRef={getEdgeRef(rel.id)}
                  />
                );
              }
            )}
          </g>

          {/* NODOS */}

          <g className="network-nodes">
            {records.map(
              (record) => {
                const p =
                  pos.get(
                    record.id
                  )!;

                const connectionCount =
                  connectionCounts.get(record.id) ?? 0;
                const sizes = nodeSizes(connectionCount);

                const selected =
                  !intro &&
                  record.id ===
                    selectedId;

                const neighbor =
                  !intro &&
                  related.has(
                    record.id
                  );

                const dim =
                  !intro &&
                  !!selectedId &&
                  !selected &&
                  !neighbor;

                return (
                  <g
                    ref={getNodeRef(record.id)}
                    key={
                      record.id
                    }
                    className={`node ${record.type} ${
                      selected
                        ? 'selected'
                        : ''
                    } ${
                      neighbor
                        ? 'neighbor'
                        : ''
                    } ${
                      dim
                        ? 'dim'
                        : ''
                    } ${
                      intro
                        ? 'intro-node'
                        : ''
                    }`}
                    transform={`translate(${p.x},${p.y})`}
                    role="button"
                    tabIndex={
                      intro
                        ? -1
                        : 0
                    }
                    onPointerDown={(event) =>
                      handlePointerDown(
                        event,
                        record.id
                      )
                    }
                    aria-label={`${record.name}, ${record.type}, ${connectionCount} ${connectionCount === 1 ? 'conexión' : 'conexiones'}`}
                    onMouseEnter={() =>
                      !intro &&
                      setHoveredNode(
                        record.id
                      )
                    }
                    onMouseLeave={() =>
                      setHoveredNode(
                        undefined
                      )
                    }
                    onFocus={() =>
                      !intro &&
                      setHoveredNode(
                        record.id
                      )
                    }
                    onBlur={() =>
                      setHoveredNode(
                        undefined
                      )
                    }
                    onClick={(event) => {
                      if (zoomMode) {
                        event.stopPropagation();
                        return;
                      }

                      if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                      }

                      if (!intro) {
                        onSelect(record.id);
                      }
                    }}
                    onKeyDown={(
                      e
                    ) => {
                      if (
                        !intro &&
                        (e.key ===
                          'Enter' ||
                          e.key ===
                            ' ')
                      ) {
                        onSelect(
                          record.id
                        );
                      }
                    }}
                  >

                    {/* NÚCLEO */}

                    <circle
                      className="node-core"
                      r={
                        selected
                          ? 8
                          : neighbor
                            ? Math.max(5.5, sizes.core)
                            : intro
                              ? 4
                              : sizes.core
                      }
                    />

                    {/* NOMBRE */}

                    <text
                      className="node-name"
                      pointerEvents="none"
                      y={sizes.core + 15}
                    >
                      {record.name}
                    </text>
                  </g>
                );
              }
            )}
          </g>
        </svg>

        {/* AYUDA */}

        {!intro && (
          <div className="graph-hint">
            Hacé click en un nodo para explorar sus conexiones
          </div>
        )}

        {/* LEYENDA */}

        {!intro && (
          <div className="legend">
            <span>
              <i className="dot person" />
              Persona
            </span>

            <span>
              <i className="dot company" />
              Ecosistema
            </span>

            <span>
              <i className="dot institution" />
              Proyecto
            </span>
          </div>
        )}

        {infoOpen && (
          <InfoModal onClose={() => setInfoOpen(false)} />
        )}
      </div>
    </section>
  );
}

export default memo(NetworkGraph);
