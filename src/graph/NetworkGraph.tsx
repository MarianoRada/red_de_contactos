import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent, WheelEvent } from 'react';
import {
  Info,
  MousePointer2,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

import type { ContactRecord, Relationship } from '../types/models';

import { getOtherId, getRelationsFor } from '../lib/relations';
import {
  loadNodePositions,
  saveNodePositions,
} from '../lib/storage';
import InfoModal from '../components/InfoModal';

type P = {
  x: number;
  y: number;
};

type DragState = {
  id: string;
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
  moved: boolean;
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

const VIEW_WIDTH = 1600;
const VIEW_HEIGHT = 1000;

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

const CX = VIEW_WIDTH / 2;
const CY = VIEW_HEIGHT / 2;

/*
 * Separación mínima entre nodos.
 * Si querés más aire después, podés subirlo a 68 o 70.
 */
const MIN_NODE_DISTANCE = 62;

/*
 * Cantidad de brazos de la galaxia.
 */
const GALAXY_ARMS = 3;

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
function positions(
  records: ContactRecord[],
  rels: Relationship[],
  selected?: string
) {
  const map = new Map<string, P>();

  /*
   * ============================================================
   * CUANDO HAY UN NODO SELECCIONADO
   * ============================================================
   */
  if (selected) {
    map.set(selected, {
      x: CX,
      y: CY,
    });

    const neighbors = [
      ...new Set(
        getRelationsFor(selected, rels).map((rel) =>
          getOtherId(rel, selected)
        )
      ),
    ];

    /*
     * Vecinos directos alrededor del nodo seleccionado.
     */
    const neighborRadiusX =
      neighbors.length > 12 ? 330 : 270;

    const neighborRadiusY =
      neighbors.length > 12 ? 250 : 205;

    neighbors.forEach((id, i) => {
      const angle =
        (Math.PI * 2 * i) /
          Math.max(neighbors.length, 1) -
        Math.PI / 2;

      const wobble =
        (Math.abs(hash(id)) % 30) - 15;

      map.set(id, {
        x:
          CX +
          Math.cos(angle) *
            (neighborRadiusX + wobble),

        y:
          CY +
          Math.sin(angle) *
            (neighborRadiusY + wobble * 0.5),
      });
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

      map.set(record.id, {
        x,
        y,
      });
    });

    return map;
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
  const maxRadiusX = 650;
  const maxRadiusY = 325;

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
      18 +
      progress * 35;

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

    while (attempts < 50) {
      let collision = false;

      for (const existing of map.values()) {
        const dx =
          x - existing.x;

        const dy =
          y - existing.y;

        const distance =
          Math.sqrt(
            dx * dx +
            dy * dy
          );

        if (
          distance <
          MIN_NODE_DISTANCE
        ) {
          collision = true;
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
      const correctionAngle =
        angle +
        attempts * 0.82;

      const correctionDistance =
        12 +
        attempts * 3.7;

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

    map.set(record.id, {
      x,
      y,
    });
  });

  return map;
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
function nodeSizes(connectionCount: number) {
  return {
    halo: Math.min(13 + connectionCount * 3, 34),
    core: Math.min(3.5 + connectionCount, 10),
  };
}

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
};

/*
 * ============================================================
 * COMPONENTE
 * ============================================================
 */
export default function NetworkGraph({
  records,
  relationships,
  selectedId,
  onSelect,
  onClear,
}: NetworkGraphProps) {
  const [
    hoveredId,
    setHoveredId,
  ] =
    useState<string>();

  const [
    intro,
    setIntro,
  ] =
    useState(true);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState>();
  const suppressClickRef = useRef(false);
  const [draggingId, setDraggingId] = useState<string>();
  const [customPositionsByView, setCustomPositionsByView] = useState<
    Map<string, Map<string, P>>
  >(() => loadNodePositions());
  const [zoomMode, setZoomMode] = useState(false);
  const [zoomDirection, setZoomDirection] =
    useState<ZoomDirection>('in');
  const [infoOpen, setInfoOpen] = useState(false);
  const [viewBox, setViewBox] = useState<ViewBox>({
    x: 0,
    y: 0,
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
    scale: 1,
  });

  const layoutKey = selectedId || 'all';

  /*
   * Posiciones finales.
   */
  const finalPos =
    useMemo(
      () =>
        positions(
          records,
          relationships,
          intro
            ? undefined
            : selectedId
        ),
      [
        records,
        relationships,
        selectedId,
        intro,
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

  const [
    animatedPos,
    setAnimatedPos,
  ] =
    useState<
      Map<string, P>
    >(startPos);

  const frame =
    useRef<number>();

  const renderedPos = useMemo(() => {
    const next = new Map(finalPos);
    const customPositions = customPositionsByView.get(layoutKey);

    customPositions?.forEach((point, id) => {
      if (next.has(id)) {
        next.set(id, point);
      }
    });

    return next;
  }, [customPositionsByView, finalPos, layoutKey]);

  useEffect(() => {
    saveNodePositions(customPositionsByView);
  }, [customPositionsByView]);

  /*
   * ============================================================
   * ANIMACIÓN INICIAL
   * ============================================================
   */
  useEffect(() => {
    if (!intro) {
      setAnimatedPos(
        renderedPos
      );

      return;
    }

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

      const next =
        new Map<
          string,
          P
        >();

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

          next.set(
            record.id,
            {
              x:
                from.x +
                (to.x -
                  from.x) *
                  eased +
                orbitX,

              y:
                from.y +
                (to.y -
                  from.y) *
                  eased +
                orbitY,
            }
          );
        }
      );

      setAnimatedPos(
        next
      );

      if (raw < 1) {
        frame.current =
          requestAnimationFrame(
            tick
          );
      } else {
        setAnimatedPos(
          renderedPos
        );

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
   * Actualizar posiciones al seleccionar.
   */
  useEffect(() => {
    if (!intro) {
      setAnimatedPos(
        renderedPos
      );
    }
  }, [
    intro,
    renderedPos,
  ]);

  const pos =
    intro
      ? animatedPos
      : renderedPos;

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

    setViewBox((current) => {
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
      const nextX =
        point.x - relativeX * nextWidth;
      const nextY =
        point.y - relativeY * nextHeight;

      return {
        scale: nextScale,
        width: nextWidth,
        height: nextHeight,
        x: Math.max(
          0,
          Math.min(VIEW_WIDTH - nextWidth, nextX)
        ),
        y: Math.max(
          0,
          Math.min(VIEW_HEIGHT - nextHeight, nextY)
        ),
      };
    });
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
    dragRef.current = {
      id,
      offsetX: nodePosition.x - point.x,
      offsetY: nodePosition.y - point.y,
      startX: point.x,
      startY: point.y,
      moved: false,
    };
    setDraggingId(id);
    event.currentTarget.setPointerCapture(event.pointerId);
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

    const nextPoint = {
      x: Math.max(
        40,
        Math.min(VIEW_WIDTH - 40, point.x + drag.offsetX)
      ),
      y: Math.max(
        55,
        Math.min(VIEW_HEIGHT - 55, point.y + drag.offsetY)
      ),
    };

    setCustomPositionsByView((previous) => {
      const next = new Map(previous);
      const viewPositions = new Map(
        next.get(layoutKey) ?? []
      );

      viewPositions.set(drag.id, nextPoint);
      next.set(layoutKey, viewPositions);

      if (layoutKey !== 'all') {
        const allPositions = new Map(
          next.get('all') ?? []
        );

        allPositions.set(drag.id, nextPoint);
        next.set('all', allPositions);
      }

      return next;
    });
  };

  const handlePointerUp = () => {
    if (!dragRef.current) {
      return;
    }

    suppressClickRef.current = dragRef.current.moved;
    dragRef.current = undefined;
    setDraggingId(undefined);
  };

  /*
   * Vecinos del nodo seleccionado.
   */
  const related =
    new Set(
      selectedId
        ? getRelationsFor(
            selectedId,
            relationships
          ).map(
            (rel) =>
              getOtherId(
                rel,
                selectedId
              )
          )
        : []
    );

  const hoveredRelated =
    new Set(
      hoveredId
        ? getRelationsFor(
            hoveredId,
            relationships
          ).map(
            (rel) =>
              getOtherId(
                rel,
                hoveredId
              )
          )
        : []
    );

  /*
   * Grado de cada nodo: contamos nodos vecinos únicos, no relaciones
   * repetidas entre el mismo par.
   */
  const connectionCounts = useMemo(() => {
    const neighbors = new Map<string, Set<string>>();

    relationships.forEach((rel) => {
      const sourceNeighbors =
        neighbors.get(rel.sourceId) ?? new Set<string>();
      const targetNeighbors =
        neighbors.get(rel.targetId) ?? new Set<string>();

      sourceNeighbors.add(rel.targetId);
      targetNeighbors.add(rel.sourceId);

      neighbors.set(rel.sourceId, sourceNeighbors);
      neighbors.set(rel.targetId, targetNeighbors);
    });

    return new Map(
      [...neighbors].map(([id, nodeNeighbors]) => [
        id,
        nodeNeighbors.size,
      ])
    );
  }, [relationships]);

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
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
          role="img"
          aria-label="Mapa interactivo de relaciones"
          preserveAspectRatio="xMidYMid meet"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
          onClick={handleZoomClick}
        >
          <defs>
            <filter id="glow">
              <feGaussianBlur
                stdDeviation="3"
                result="blur"
              />

              <feMerge>
                <feMergeNode in="blur" />

                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

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

                const hoverActive =
                  !intro &&
                  !!hoveredId &&
                  (rel.sourceId ===
                    hoveredId ||
                    rel.targetId ===
                      hoveredId);

                const muted =
                  !intro &&
                  !!selectedId &&
                  !active &&
                  !hoverActive;

                const lp =
                  labelPoint(
                    a,
                    b,
                    rel,
                    selectedId
                  );

                const labelWidth =
                  Math.max(
                    112,
                    rel.type
                      .length *
                      7.2 +
                      24
                  );

                return (
                  <g
                    key={
                      rel.id
                    }
                    className={`edge ${
                      active
                        ? 'active'
                        : ''
                    } ${
                      hoverActive
                        ? 'hover-active'
                        : ''
                    } ${
                      muted
                        ? 'muted'
                        : ''
                    }`}
                  >
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                    />

                    {active && (
                      <g
                        className="edge-label"
                        transform={`translate(${lp.x},${lp.y})`}
                      >
                        <rect
                          x={
                            -labelWidth /
                            2
                          }
                          y="-14"
                          width={
                            labelWidth
                          }
                          height="28"
                          rx="14"
                        />

                        <text
                          x="0"
                          y="4"
                        >
                          {rel.type}
                        </text>
                      </g>
                    )}
                  </g>
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

                const hovered =
                  !intro &&
                  record.id ===
                    hoveredId;

                const showName =
                  !intro &&
                  (hovered ||
                    hoveredRelated.has(
                      record.id
                    ));

                return (
                  <g
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
                      hoveredRelated.has(
                        record.id
                      )
                        ? 'hover-neighbor'
                        : ''
                    } ${
                      hovered
                        ? 'hovered'
                        : ''
                    } ${
                      dim
                        ? 'dim'
                        : ''
                    } ${
                      intro
                        ? 'intro-node'
                        : ''
                    } ${
                      draggingId === record.id
                        ? 'dragging'
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
                      setHoveredId(
                        record.id
                      )
                    }
                    onMouseLeave={() =>
                      setHoveredId(
                        undefined
                      )
                    }
                    onFocus={() =>
                      !intro &&
                      setHoveredId(
                        record.id
                      )
                    }
                    onBlur={() =>
                      setHoveredId(
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

                    {/* HALO */}

                    <circle
                      className="node-halo"
                      r={
                        selected
                          ? 27
                          : hovered
                            ? 25
                            : intro
                              ? 13
                              : sizes.halo
                      }
                    />

                    {/* NÚCLEO */}

                    <circle
                      className="node-core"
                      r={
                        selected
                          ? 8
                          : hovered
                            ? 7
                            : neighbor
                              ? Math.max(5.5, sizes.core)
                              : intro
                                ? 4
                                : sizes.core
                      }
                    />

                    {/* NOMBRE */}

                    {showName && (
                      <text
                        className="node-name"
                        pointerEvents="none"
                        y={
                          sizes.halo + 15
                      }
                      >
                        {record.name}
                      </text>
                    )}
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
