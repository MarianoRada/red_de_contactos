import { useEffect, useMemo, useRef, useState } from 'react';

import type { ContactRecord, Relationship } from '../types/models';
import { getOtherId, getRelationsFor } from '../lib/relations';

type P = { x: number; y: number };

const INTRO_MS = 6200;

const hash = (s: string) =>
  [...s].reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);

function positions(
  records: ContactRecord[],
  rels: Relationship[],
  selected?: string
) {
  const map = new Map<string, P>();
  const cx = 600;
  const cy = 390;

  if (selected) {
    map.set(selected, { x: cx, y: cy });

    const neighbors = [
      ...new Set(
        getRelationsFor(selected, rels).map((r) => getOtherId(r, selected))
      ),
    ];

    neighbors.forEach((id, i) => {
      const a =
        (Math.PI * 2 * i) / Math.max(neighbors.length, 1) - Math.PI / 2;
      const wobble = (Math.abs(hash(id)) % 35) - 17;

      map.set(id, {
        x: cx + Math.cos(a) * (225 + wobble),
        y: cy + Math.sin(a) * (175 + wobble * 0.45),
      });
    });

    const rest = records.filter((r) => !map.has(r.id));

    rest.forEach((r, i) => {
      const a =
        (Math.PI * 2 * i) / Math.max(rest.length, 1) - 0.35;
      const ring = 330 + (Math.abs(hash(r.id)) % 75);

      map.set(r.id, {
        x: cx + Math.cos(a) * ring,
        y: cy + Math.sin(a) * ring * 0.62,
      });
    });
  } else {
    records.forEach((r, i) => {
      const a =
        (Math.PI * 2 * i) / Math.max(records.length, 1) - Math.PI / 2;
      const h = Math.abs(hash(r.id));
      const ring = 195 + (h % 225);

      map.set(r.id, {
        x: cx + Math.cos(a) * ring,
        y: cy + Math.sin(a) * ring * 0.64,
      });
    });
  }

  return map;
}

function introStart(records: ContactRecord[]) {
  const map = new Map<string, P>();

  records.forEach((r, i) => {
    const h = Math.abs(hash(r.id));
    const a = ((h % 360) / 180) * Math.PI + i * 0.71;
    const ring = 180 + (h % 360);

    map.set(r.id, {
      x: 600 + Math.cos(a) * ring,
      y: 390 + Math.sin(a) * ring * 0.72,
    });
  });

  return map;
}

const short = (s: string) =>
  s.length > 24 ? s.slice(0, 23) + '…' : s;

function labelPoint(
  a: P,
  b: P,
  rel: Relationship,
  selectedId?: string
) {
  if (
    selectedId &&
    (rel.sourceId === selectedId || rel.targetId === selectedId)
  ) {
    const from = rel.sourceId === selectedId ? a : b;
    const to = rel.sourceId === selectedId ? b : a;
    const t = 0.62;

    return {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    };
  }

  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

type NetworkGraphProps = {
  records: ContactRecord[];
  relationships: Relationship[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onClear: () => void;
};

export default function NetworkGraph({
  records,
  relationships,
  selectedId,
  onSelect,
  onClear,
}: NetworkGraphProps) {
  const [hoveredId, setHoveredId] = useState<string>();
  const [intro, setIntro] = useState(true);

  const finalPos = useMemo(
    () =>
      positions(
        records,
        relationships,
        intro ? undefined : selectedId
      ),
    [records, relationships, selectedId, intro]
  );

  const startPos = useMemo(() => introStart(records), [records]);

  const [animatedPos, setAnimatedPos] =
    useState<Map<string, P>>(startPos);

  const frame = useRef<number>();

  useEffect(() => {
    if (!intro) {
      setAnimatedPos(finalPos);
      return;
    }

    const started = performance.now();

    const tick = (now: number) => {
      const raw = Math.min(1, (now - started) / INTRO_MS);

      // Desaceleración marcada: mucha energía al principio y llegada muy suave.
      const eased = 1 - Math.pow(1 - raw, 4);
      const next = new Map<string, P>();

      records.forEach((r, i) => {
        const from = startPos.get(r.id)!;
        const to = finalPos.get(r.id)!;
        const h = Math.abs(hash(r.id));
        const energy = Math.pow(1 - raw, 2.35);
        const phase = (h % 628) / 100 + i * 0.8;

        const orbitX =
          Math.sin(raw * 18 + phase) * (42 + (h % 55)) * energy;
        const orbitY =
          Math.cos(raw * 15 + phase) * (30 + (h % 42)) * energy;

        next.set(r.id, {
          x: from.x + (to.x - from.x) * eased + orbitX,
          y: from.y + (to.y - from.y) * eased + orbitY,
        });
      });

      setAnimatedPos(next);

      if (raw < 1) {
        frame.current = requestAnimationFrame(tick);
      } else {
        setAnimatedPos(finalPos);
        setIntro(false);
      }
    };

    frame.current = requestAnimationFrame(tick);

    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };

    // La animación de entrada se ejecuta una sola vez al montar el mapa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!intro) setAnimatedPos(finalPos);
  }, [finalPos, intro]);

  const pos = intro ? animatedPos : finalPos;

  const related = new Set(
    selectedId
      ? getRelationsFor(selectedId, relationships).map((r) =>
          getOtherId(r, selectedId)
        )
      : []
  );

  const introProgressClass = intro
    ? 'intro-running'
    : 'intro-finished';

  return (
    <section className={`graph-wrap ${introProgressClass}`}>
      <div className="graph-stage">
        <div className="graph-title">
          <div>
            <small>RED INTERACTIVA</small>
            <h1>Mapa de relaciones</h1>
          </div>

          {selectedId && !intro && (
            <button className="network-clear" onClick={onClear}>
              × &nbsp; Ver toda la red
            </button>
          )}
        </div>

        <svg
          className="graph"
          viewBox="0 0 1200 780"
          role="img"
          aria-label="Mapa interactivo de relaciones"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <filter id="glow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <g className="network-lines">
            {relationships.map((rel) => {
              const a = pos.get(rel.sourceId);
              const b = pos.get(rel.targetId);
              if (!a || !b) return null;

              const active =
                !intro &&
                !!selectedId &&
                (rel.sourceId === selectedId ||
                  rel.targetId === selectedId);

              const hoverActive =
                !intro &&
                !!hoveredId &&
                (rel.sourceId === hoveredId ||
                  rel.targetId === hoveredId);

              const muted =
                !intro && !!selectedId && !active && !hoverActive;

              const lp = labelPoint(a, b, rel, selectedId);
              const labelWidth = Math.max(
                112,
                rel.type.length * 7.2 + 24
              );

              return (
                <g
                  key={rel.id}
                  className={`edge ${active ? 'active' : ''} ${
                    hoverActive ? 'hover-active' : ''
                  } ${muted ? 'muted' : ''}`}
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
            })}
          </g>

          <g className="network-nodes">
            {records.map((r) => {
              const p = pos.get(r.id)!;
              const selected = !intro && r.id === selectedId;
              const neighbor = !intro && related.has(r.id);
              const dim =
                !intro && !!selectedId && !selected && !neighbor;
              const hovered = !intro && r.id === hoveredId;

              return (
                <g
                  key={r.id}
                  className={`node ${r.type} ${
                    selected ? 'selected' : ''
                  } ${neighbor ? 'neighbor' : ''} ${
                    hovered ? 'hovered' : ''
                  } ${dim ? 'dim' : ''} ${
                    intro ? 'intro-node' : ''
                  }`}
                  transform={`translate(${p.x},${p.y})`}
                  role="button"
                  tabIndex={intro ? -1 : 0}
                  aria-label={`${r.name}, ${r.type}`}
                  onMouseEnter={() =>
                    !intro && setHoveredId(r.id)
                  }
                  onMouseLeave={() =>
                    setHoveredId(undefined)
                  }
                  onFocus={() =>
                    !intro && setHoveredId(r.id)
                  }
                  onBlur={() =>
                    setHoveredId(undefined)
                  }
                  onClick={() =>
                    !intro && onSelect(r.id)
                  }
                  onKeyDown={(e) =>
                    !intro &&
                    (e.key === 'Enter' || e.key === ' ') &&
                    onSelect(r.id)
                  }
                >
                  <circle
                    className="node-halo"
                    r={
                      selected
                        ? 27
                        : hovered
                          ? 25
                          : intro
                            ? 13
                            : 18
                    }
                  />

                  <circle
                    className="node-core"
                    r={
                      selected
                        ? 8
                        : hovered
                          ? 7
                          : neighbor
                            ? 5.5
                            : intro
                              ? 4
                              : 4.5
                    }
                  />

                  {!intro && (
                    <text
                      className="node-name"
                      y={selected || hovered ? 46 : 33}
                    >
                      {hovered ? r.name : short(r.name)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {!intro && (
          <div className="graph-hint">
            Hacé click en un nodo para explorar sus conexiones
          </div>
        )}

        {!intro && (
          <div className="legend">
            <span>
              <i className="dot person" />
              Persona
            </span>
            <span>
              <i className="dot company" />
              Empresa
            </span>
            <span>
              <i className="dot institution" />
              Institución
            </span>
          </div>
        )}
      </div>
    </section>
  );
}