import * as d3 from "d3";
import Matter from "matter-js";
import {
  clearGridNodeRenderSnapshot,
  replaceGridNodeRenderSnapshot,
  type GridNodeRenderSnap,
} from "./gridNodeRenderSnapshot";
import {
  buildGridGlowData,
  computeKeyboardLayout,
  gridLayoutSignature,
  GRID_NODE_HIT_RADIUS_FRAC,
  GRID_NODE_JITTER_BOX_SIDE_FRAC,
  isPointCoveredByActiveKeys,
  KEY_FADE_MS,
} from "./keyboardSvg";
import poemSource from "./poem.txt?raw";

const { Engine, World, Bodies, Body, Composite, Events } = Matter;

const RAIN_LABEL = "rain";
const GRID_NODE_LABEL = "grid-node";

/** Default drop fill when not colliding */
const RAIN_FILL = "rgba(147, 197, 253, 0.42)";

/** Solid white for poem-letter rain when overlapping solid bodies. */
const RAIN_FILL_COLLIDING = "#ffffff";

/** Target spawns per second (Poisson-style using accumulator). */
const SPAWNS_PER_SEC = 50;

/** Fixed Matter circle radius for every rain body (hitbox size). */
const RAIN_RADIUS = 4;

/** Special poem-letter drops use this hitbox radius (2× normal). */
const SPECIAL_RAIN_RADIUS = RAIN_RADIUS * 2;

/** Random vertical offset range (px) when spawning each poem letter (± half). */
const SPECIAL_SPAWN_Y_VARIATION_PX = 82;

/** SVG `font-size` for rain glyphs (px); tuned to ~match `RAIN_RADIUS`. */
const RAIN_FONT_PX = RAIN_RADIUS * 2.35;

const SPECIAL_TEXT_INTERVAL_MS = 10000;
/** Consecutive whole words sampled from the poem (split on whitespace). */
const SPECIAL_WORD_COUNT = 6;
/** Horizontal span from first to last letter center, as a fraction of canvas width. */
const SPECIAL_LINE_WIDTH_FRAC = 0.5;

const POEM_FLAT = poemSource.replace(/\s+/g, " ").trim();
const POEM_WORDS =
  POEM_FLAT.length === 0 ? [] : POEM_FLAT.split(/\s+/).filter(Boolean);

/** Collider inactive below this scale (sensor, no rain blocking). */
const NODE_SENSOR_THRESHOLD = 0.002;

const GEOM_EPS = 1e-4;

function randomRainLetter() {
  return String.fromCharCode(65 + Math.floor(Math.random() * 26));
}

/** Up to six consecutive words joined with spaces; one raindrop per character (incl. spaces). */
function pickRandomSixWordsLine(): string {
  const w = POEM_WORDS;
  if (w.length === 0) return "";
  if (w.length <= SPECIAL_WORD_COUNT) return w.join(" ");
  const start = Math.floor(Math.random() * (w.length - SPECIAL_WORD_COUNT + 1));
  return w.slice(start, start + SPECIAL_WORD_COUNT).join(" ");
}

/** X positions for `charCount` letters, centered, spanning `SPECIAL_LINE_WIDTH_FRAC` of width. */
function specialLetterXs(width: number, charCount: number): number[] {
  const w = Math.max(32, width);
  const n = Math.max(1, charCount);
  const span = w * SPECIAL_LINE_WIDTH_FRAC;
  if (n === 1) return [w * 0.5];
  const step = span / (n - 1);
  const left = w * 0.5 - span * 0.5;
  return Array.from({ length: n }, (_, i) => left + i * step);
}

function adjustRainCollisionDepth(
  map: Map<number, number>,
  body: Matter.Body,
  delta: number,
) {
  if (body.label !== RAIN_LABEL) return;
  const next = (map.get(body.id) ?? 0) + delta;
  if (next <= 0) map.delete(body.id);
  else map.set(body.id, next);
}

/**
 * Each qualifying rain in the pair gets ±1 for non-sensor contacts only.
 * Inactive grid nodes are sensors — overlaps must not bump depth.
 */
function adjustPairRainDepth(
  map: Map<number, number>,
  a: Matter.Body,
  b: Matter.Body,
  delta: number,
  countCollisionsForRain: (rain: Matter.Body) => boolean,
) {
  const bumpIfSolidContact = (rain: Matter.Body, other: Matter.Body) => {
    if (rain.label !== RAIN_LABEL) return;
    if (other.isSensor) return;
    if (!countCollisionsForRain(rain)) return;
    adjustRainCollisionDepth(map, rain, delta);
  };
  bumpIfSolidContact(a, b);
  bumpIfSolidContact(b, a);
}

function spawnRainDrop(
  world: Matter.World,
  width: number,
  glyphByBodyId: Map<number, string>,
) {
  const w = Math.max(32, width);
  const r = RAIN_RADIUS;
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
  glyphByBodyId.set(drop.id, randomRainLetter());
}

function spawnSpecialTextLine(
  world: Matter.World,
  width: number,
  text: string,
  glyphByBodyId: Map<number, string>,
  poemRainBodyIds: Set<number>,
) {
  if (text.length === 0) return;
  const r = SPECIAL_RAIN_RADIUS;
  const xs = specialLetterXs(width, text.length);
  const yBase = -r - 6;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const x = xs[i]!;
    const y = yBase + (Math.random() - 0.5) * SPECIAL_SPAWN_Y_VARIATION_PX;
    const drop = Bodies.circle(x, y, r, {
      label: RAIN_LABEL,
      frictionAir: 0.09,
      friction: 0,
      restitution: 0.12,
      density: 0.001,
    });
    Body.setVelocity(drop, {
      x: (Math.random() - 0.5) * 1.2,
      y: Math.random() * 0.6,
    });
    World.add(world, drop);
    glyphByBodyId.set(drop.id, ch);
    poemRainBodyIds.add(drop.id);
  }
}

function randomJitter(side: number) {
  return (Math.random() - 0.5) * side;
}

type NodePhys = {
  body: Matter.Body;
  /** Glow/collision “on” from key overlap using jittered position while inactive. */
  logicalDesired: boolean;
  /** Random offset while inactive; when activating, copied to `frozenJ*`. */
  jitterX: number;
  jitterY: number;
  /** Offset from base while active — last jittered position, no longer updated. */
  frozenJx: number;
  frozenJy: number;
  lastDesired: boolean;
  animStart: number;
  animFrom: number;
  animTo: number;
  displayScale: number;
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

  const { nodes, stepPx } = buildGridGlowData(layout);
  const maxR = stepPx * GRID_NODE_HIT_RADIUS_FRAC;
  const jitterSide = stepPx * GRID_NODE_JITTER_BOX_SIDE_FRAC;
  const active = getActive();

  for (const n of nodes) {
    const jitterX = randomJitter(jitterSide);
    const jitterY = randomJitter(jitterSide);
    const hitX = n.cx + jitterX;
    const hitY = n.cy + jitterY;
    const logicalDesired = isPointCoveredByActiveKeys(
      hitX,
      hitY,
      active,
      layout,
    );
    const frozenJx = logicalDesired ? jitterX : 0;
    const frozenJy = logicalDesired ? jitterY : 0;
    const wx = n.cx + (logicalDesired ? frozenJx : jitterX);
    const wy = n.cy + (logicalDesired ? frozenJy : jitterY);

    const body = Bodies.circle(wx, wy, maxR, {
      isStatic: true,
      isSensor: true,
      label: GRID_NODE_LABEL,
    });
    World.add(world, body);
    const displayScale = logicalDesired ? 1 : 0;
    const geom = Math.max(GEOM_EPS, displayScale);
    Body.scale(body, geom, geom, { x: wx, y: wy });
    nodeMap.set(n.id, {
      body,
      logicalDesired,
      jitterX,
      jitterY,
      frozenJx,
      frozenJy,
      lastDesired: logicalDesired,
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
  const { nodes, stepPx } = buildGridGlowData(layout);
  const jitterSide = stepPx * GRID_NODE_JITTER_BOX_SIDE_FRAC;

  for (const n of nodes) {
    const np = nodeMap.get(n.id);
    if (!np) continue;

    const wasDesired = np.logicalDesired;
    const posHitX = wasDesired ? n.cx + np.frozenJx : n.cx + np.jitterX;
    const posHitY = wasDesired ? n.cy + np.frozenJy : n.cy + np.jitterY;

    let nextDesired = isPointCoveredByActiveKeys(
      posHitX,
      posHitY,
      active,
      layout,
    );

    if (nextDesired && !wasDesired) {
      np.frozenJx = np.jitterX;
      np.frozenJy = np.jitterY;
    }

    if (!nextDesired && wasDesired) {
      np.frozenJx = 0;
      np.frozenJy = 0;
      np.jitterX = randomJitter(jitterSide);
      np.jitterY = randomJitter(jitterSide);
    }

    np.logicalDesired = nextDesired;

    if (nextDesired !== np.lastDesired) {
      np.animFrom = np.displayScale;
      np.animTo = nextDesired ? 1 : 0;
      np.animStart = now;
      np.lastDesired = nextDesired;
    }
    const t = Math.min(1, (now - np.animStart) / KEY_FADE_MS);
    np.displayScale =
      np.animFrom + (np.animTo - np.animFrom) * d3.easeCubicInOut(t);

    const scale = Math.max(0, Math.min(1, np.displayScale));
    const { body } = np;
    const wx = n.cx + (nextDesired ? np.frozenJx : np.jitterX);
    const wy = n.cy + (nextDesired ? np.frozenJy : np.jitterY);

    body.isSensor = scale < NODE_SENSOR_THRESHOLD;

    Body.setPosition(body, { x: wx, y: wy });

    const targetGeom = Math.max(GEOM_EPS, scale);
    const ratio = targetGeom / np.lastGeomScale;
    Body.scale(body, ratio, ratio, { x: wx, y: wy });
    np.lastGeomScale = targetGeom;
  }

  const snap = new Map<string, GridNodeRenderSnap>();
  for (const n of nodes) {
    const np = nodeMap.get(n.id);
    if (!np) continue;
    snap.set(n.id, {
      logicalDesired: np.logicalDesired,
      displayScale: np.displayScale,
      jitterX: np.logicalDesired ? np.frozenJx : np.jitterX,
      jitterY: np.logicalDesired ? np.frozenJy : np.jitterY,
    });
  }
  replaceGridNodeRenderSnapshot(snap);
}

/**
 * Matter.js rain + D3 SVG text (`svg.rain-layer`, behind keyboard).
 */
export function mountRainSimulation(
  host: HTMLDivElement,
  getActive: () => Record<string, boolean>,
  afterGridSync?: () => void,
): () => void {
  const engine = Engine.create({ enableSleeping: false });
  engine.gravity.y = 1;
  engine.gravity.scale = 0.0011;

  /** Count of active collision pairs per rain id (handles multi-contact). */
  const rainCollisionDepth = new Map<number, number>();

  /** Uppercase letter shown for each rain body (fixed at spawn). */
  const rainGlyphByBodyId = new Map<number, string>();

  /** Poem-line drops (for white-on-collision only); motion is unconstrained. */
  const poemRainBodyIds = new Set<number>();
  let lastSpecialTextSpawnMs = performance.now();

  const isPoemLetterRain = (b: Matter.Body) => poemRainBodyIds.has(b.id);

  const onCollisionStart = (e: { pairs: Matter.Pair[] }) => {
    for (const pair of e.pairs) {
      adjustPairRainDepth(
        rainCollisionDepth,
        pair.bodyA,
        pair.bodyB,
        1,
        isPoemLetterRain,
      );
    }
  };

  const onCollisionEnd = (e: { pairs: Matter.Pair[] }) => {
    for (const pair of e.pairs) {
      adjustPairRainDepth(
        rainCollisionDepth,
        pair.bodyA,
        pair.bodyB,
        -1,
        isPoemLetterRain,
      );
    }
  };

  Events.on(engine, "collisionStart", onCollisionStart);
  Events.on(engine, "collisionEnd", onCollisionEnd);

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
    afterGridSync?.();

    spawnCarry += (SPAWNS_PER_SEC * dt) / 1000;
    while (spawnCarry >= 1) {
      if (Math.random() < 0.92)
        spawnRainDrop(engine.world, width, rainGlyphByBodyId);
      spawnCarry -= 1;
    }

    if (now - lastSpecialTextSpawnMs >= SPECIAL_TEXT_INTERVAL_MS) {
      lastSpecialTextSpawnMs = now;
      spawnSpecialTextLine(
        engine.world,
        width,
        pickRandomSixWordsLine(),
        rainGlyphByBodyId,
        poemRainBodyIds,
      );
    }

    Engine.update(engine, dt);

    const removed: Matter.Body[] = [];
    for (const b of Composite.allBodies(engine.world)) {
      if (b.label === RAIN_LABEL && b.position.y > h + 28) removed.push(b);
    }
    for (const b of removed) {
      rainCollisionDepth.delete(b.id);
      rainGlyphByBodyId.delete(b.id);
      poemRainBodyIds.delete(b.id);
      World.remove(engine.world, b);
    }

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
      .selectAll<SVGTextElement, Matter.Body>("text.raindrop")
      .data(rainBodies, (d) => d.id)
      .join(
        (enter) =>
          enter
            .append("text")
            .attr("class", "raindrop")
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .attr("font-size", `${RAIN_FONT_PX}px`)
            .attr("font-family", "system-ui, sans-serif")
            .attr("font-weight", "600")
            .style("user-select", "none"),
        (update) => update,
        (exit) => exit.remove(),
      )
      .attr("x", (b) => b.position.x)
      .attr("y", (b) => b.position.y)
      .text((b) => rainGlyphByBodyId.get(b.id) ?? "?")
      .attr("fill", (b) =>
        isPoemLetterRain(b) && (rainCollisionDepth.get(b.id) ?? 0) > 0
          ? RAIN_FILL_COLLIDING
          : RAIN_FILL,
      );

    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(raf);
    Events.off(engine, "collisionStart", onCollisionStart);
    Events.off(engine, "collisionEnd", onCollisionEnd);
    rainCollisionDepth.clear();
    rainGlyphByBodyId.clear();
    poemRainBodyIds.clear();
    World.clear(engine.world, false);
    Engine.clear(engine);
    nodeMap.clear();
    gridSigRef.v = "";
    clearGridNodeRenderSnapshot();
    d3.select(host).selectAll("svg.rain-layer").remove();
  };
}
