import * as d3 from "d3";
import Matter from "matter-js";
import {
  buildGridGlowData,
  computeKeyboardLayout,
  gridLayoutSignature,
  KEY_FADE_MS,
} from "./keyboardSvg";

const { Engine, World, Bodies, Body, Composite } = Matter;

const RAIN_LABEL = "rain";
const GRID_NODE_LABEL = "grid-node";

/** Simple semi-transparent fill for drops */
const RAIN_FILL = "rgba(147, 197, 253, 0.42)";

/** Target spawns per second (Poisson-style using accumulator). */
const SPAWNS_PER_SEC = 50;

/** Collider inactive below this scale (sensor, no rain blocking). */
const NODE_SENSOR_THRESHOLD = 0.002;

const GEOM_EPS = 1e-4;

function spawnRainDrop(world: Matter.World, width: number) {
  const w = Math.max(32, width);
  const r = 2 + Math.random() * 5;
  const x = r + Math.random() * (w - 2 * r);
  const drop = Bodies.circle(x, -r - 6, r, {
    label: RAIN_LABEL,
    frictionAir: 0.055 + Math.random() * 0.08,
    friction: 0,
    restitution: 0.12,
    density: 0.001,
  });
  Body.setVelocity(drop, {
    x: (Math.random() - 0.5) * 1.4,
    y: Math.random() * 0.6,
  });
  World.add(world, drop);
}

type NodePhys = {
  body: Matter.Body;
  lastDesired: boolean;
  animStart: number;
  animFrom: number;
  animTo: number;
  displayScale: number;
  /** Current geometric scale relative to creation radius (for Body.scale). */
  lastGeomScale: number;
};

function removeGridBodies(world: Matter.World) {
  const toRemove: Matter.Body[] = [];
  for (const b of Composite.allBodies(world)) {
    if (b.label === GRID_NODE_LABEL) toRemove.push(b);
  }
  for (const b of toRemove) World.remove(world, b);
}

function ensureGridColliders(
  world: Matter.World,
  nodeMap: Map<string, NodePhys>,
  layout: ReturnType<typeof computeKeyboardLayout>,
  getActive: () => Record<string, boolean>,
  now: number,
  sig: string,
  lastSigRef: { v: string },
) {
  if (sig === lastSigRef.v && nodeMap.size > 0) return;
  lastSigRef.v = sig;
  removeGridBodies(world);
  nodeMap.clear();

  const { nodes, stepPx } = buildGridGlowData(layout, getActive());
  const maxR = stepPx * 0.48;

  for (const n of nodes) {
    const body = Bodies.circle(n.cx, n.cy, maxR, {
      isStatic: true,
      isSensor: true,
      label: GRID_NODE_LABEL,
    });
    World.add(world, body);
    const displayScale = n.desired ? 1 : 0;
    const geom = Math.max(GEOM_EPS, displayScale);
    Body.scale(body, geom, geom, { x: n.cx, y: n.cy });
    nodeMap.set(n.id, {
      body,
      lastDesired: n.desired,
      animStart: now - KEY_FADE_MS,
      animFrom: displayScale,
      animTo: displayScale,
      displayScale,
      lastGeomScale: geom,
    });
  }
}

function syncGridColliders(
  nodeMap: Map<string, NodePhys>,
  getActive: () => Record<string, boolean>,
  layout: ReturnType<typeof computeKeyboardLayout>,
  now: number,
) {
  const active = getActive();
  const { nodes } = buildGridGlowData(layout, active);

  for (const n of nodes) {
    const np = nodeMap.get(n.id);
    if (!np) continue;

    const desired = n.desired;
    if (desired !== np.lastDesired) {
      np.animFrom = np.displayScale;
      np.animTo = desired ? 1 : 0;
      np.animStart = now;
      np.lastDesired = desired;
    }
    const t = Math.min(1, (now - np.animStart) / KEY_FADE_MS);
    np.displayScale =
      np.animFrom + (np.animTo - np.animFrom) * d3.easeCubicInOut(t);

    const scale = Math.max(0, Math.min(1, np.displayScale));
    const { body } = np;
    const cx = n.cx;
    const cy = n.cy;

    body.isSensor = scale < NODE_SENSOR_THRESHOLD;

    Body.setPosition(body, { x: cx, y: cy });

    const targetGeom = Math.max(GEOM_EPS, scale);
    const ratio = targetGeom / np.lastGeomScale;
    Body.scale(body, ratio, ratio, { x: cx, y: cy });
    np.lastGeomScale = targetGeom;
  }
}

/**
 * Matter.js rain + D3 SVG circles. Rain layer is `svg.rain-layer` (keep behind keyboard).
 */
export function mountRainSimulation(
  host: HTMLDivElement,
  getActive: () => Record<string, boolean>,
): () => void {
  const engine = Engine.create({ enableSleeping: false });
  engine.gravity.y = 1;
  engine.gravity.scale = 0.0011;

  const nodeMap = new Map<string, NodePhys>();
  const gridSigRef = { v: "" };

  let raf = 0;
  let last = performance.now();
  let spawnCarry = 0;

  const tick = (now: number) => {
    const dt = Math.min(now - last, 48);
    last = now;

    const width = host.clientWidth;
    const height = host.clientHeight;
    const h = Math.max(1, height);

    const layout = computeKeyboardLayout(width, height);
    const sig = gridLayoutSignature(layout);
    ensureGridColliders(
      engine.world,
      nodeMap,
      layout,
      getActive,
      now,
      sig,
      gridSigRef,
    );
    syncGridColliders(nodeMap, getActive, layout, now);

    spawnCarry += (SPAWNS_PER_SEC * dt) / 1000;
    while (spawnCarry >= 1) {
      if (Math.random() < 0.92) spawnRainDrop(engine.world, width);
      spawnCarry -= 1;
    }

    Engine.update(engine, dt);

    const removed: Matter.Body[] = [];
    for (const b of Composite.allBodies(engine.world)) {
      if (b.label === RAIN_LABEL && b.position.y > h + 28) removed.push(b);
    }
    for (const b of removed) World.remove(engine.world, b);

    const rainBodies = Composite.allBodies(engine.world).filter(
      (b) => b.label === RAIN_LABEL,
    );

    const svg = d3
      .select(host)
      .selectAll<SVGSVGElement, null>("svg.rain-layer")
      .data([null])
      .join("svg")
      .attr("class", "rain-layer")
      .attr("width", "100%")
      .attr("height", "100%")
      .style("position", "absolute")
      .style("inset", "0")
      .style("z-index", "0")
      .style("pointer-events", "none")
      .attr("viewBox", `0 0 ${Math.max(1, width)} ${h}`)
      .attr("preserveAspectRatio", "none");

    svg
      .selectAll<SVGCircleElement, Matter.Body>("circle.raindrop")
      .data(rainBodies, (d) => d.id)
      .join(
        (enter) => enter.append("circle").attr("class", "raindrop"),
        (update) => update,
        (exit) => exit.remove(),
      )
      .attr("cx", (b) => b.position.x)
      .attr("cy", (b) => b.position.y)
      .attr("r", (b) => b.circleRadius ?? 3)
      .attr("fill", RAIN_FILL);

    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(raf);
    World.clear(engine.world, false);
    Engine.clear(engine);
    nodeMap.clear();
    gridSigRef.v = "";
    d3.select(host).selectAll("svg.rain-layer").remove();
  };
}
