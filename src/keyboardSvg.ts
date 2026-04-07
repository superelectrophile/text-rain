import * as d3 from "d3";
import { getGridNodeRenderSnap } from "./gridNodeRenderSnapshot";
import {
  KEYBOARD_BOUNDS,
  KEYBOARD_HEIGHT_UNITS,
  KEYBOARD_WIDTH_UNITS,
  KEY_POSITION_MAP,
} from "./keyboardLayout";

export const KEYBOARD_SURFACE_BG = "#16171d";

const KEYBOARD_WIDTH_FRACTION = 0.8;

/**
 * Grid resolution: spacing between rain/collision nodes as a fraction of one key cell.
 * Larger = finer grid (more nodes).
 */
export const GRID_CELLS_PER_KEY = 4;

/**
 * Keys activate grid nodes within this radius (× keyboard `cell`) from the key center.
 */
export const KEY_INFLUENCE_RADIUS_FRAC = 0.58;

/** Matter circle radius as a fraction of grid step (physics only). */
export const GRID_NODE_HIT_RADIUS_FRAC = 0.48;

/**
 * Visual glow radius relative to the physics hit radius — glow is drawn this much larger
 * than the rain collider.
 */
export const GRID_NODE_VISUAL_RADIUS_SCALE = 2.75;

/**
 * Inactive grid nodes render/physics sit at base position plus a random offset in
 * [-side/2, +side/2]² where `side = stepPx ×` this factor.
 */
export const GRID_NODE_JITTER_BOX_SIDE_FRAC = 0.82;

export function computeKeyboardLayout(
  hostCssWidth: number,
  hostCssHeight: number,
) {
  const w = Math.max(1, Math.floor(hostCssWidth));
  const h = Math.max(1, Math.floor(hostCssHeight));
  const unitAspect = KEYBOARD_HEIGHT_UNITS / KEYBOARD_WIDTH_UNITS;
  let kbW = w * KEYBOARD_WIDTH_FRACTION;
  let kbH = kbW * unitAspect;
  if (kbH > h) {
    kbH = h;
    kbW = kbH / unitAspect;
  }
  const offsetX = (w - kbW) / 2;
  const offsetY = (h - kbH) / 2;
  const cell = kbW / KEYBOARD_WIDTH_UNITS;
  const radius = Math.min(6, cell * 0.15);
  return { w, h, offsetX, offsetY, cell, radius };
}

export type GridGlowDatum = {
  id: string;
  cx: number;
  cy: number;
  /** Rendered circle radius (much larger than physics hit). */
  r: number;
};

/** Opaque signature when grid topology or placement in screen space changes. */
export function gridLayoutSignature(
  layout: ReturnType<typeof computeKeyboardLayout>,
): string {
  const { cell, offsetX, offsetY } = layout;
  const kbW = cell * KEYBOARD_WIDTH_UNITS;
  const kbH = cell * KEYBOARD_HEIGHT_UNITS;
  const stepPx = cell / GRID_CELLS_PER_KEY;
  const cols = Math.max(1, Math.floor(kbW / stepPx));
  const rows = Math.max(1, Math.floor(kbH / stepPx));
  return `${cols}x${rows}@${stepPx.toFixed(4)},${offsetX.toFixed(1)},${offsetY.toFixed(1)},${cell.toFixed(4)}`;
}

/** True if world point (px, py) lies within any active key’s influence disc. */
export function isPointCoveredByActiveKeys(
  px: number,
  py: number,
  active: Record<string, boolean>,
  layout: ReturnType<typeof computeKeyboardLayout>,
): boolean {
  const R = layout.cell * KEY_INFLUENCE_RADIUS_FRAC;
  const R2 = R * R;
  const { minX, minY } = KEYBOARD_BOUNDS;
  const { offsetX, offsetY, cell } = layout;
  for (const keyId of Object.keys(KEY_POSITION_MAP)) {
    if (!active[keyId]) continue;
    const pos = KEY_POSITION_MAP[keyId];
    const kx = offsetX + (pos.x - minX) * cell + cell * 0.5;
    const ky = offsetY + (pos.y - minY) * cell + cell * 0.5;
    const dx = px - kx;
    const dy = py - ky;
    if (dx * dx + dy * dy <= R2) return true;
  }
  return false;
}

export function isGridNodeDesired(
  cx: number,
  cy: number,
  active: Record<string, boolean>,
  layout: ReturnType<typeof computeKeyboardLayout>,
): boolean {
  return isPointCoveredByActiveKeys(cx, cy, active, layout);
}

/** Base grid layout for glow + simulation (node activation comes from the physics snapshot). */
export function buildGridGlowData(
  layout: ReturnType<typeof computeKeyboardLayout>,
): { nodes: GridGlowDatum[]; stepPx: number } {
  const { offsetX, offsetY, cell } = layout;
  const kbW = cell * KEYBOARD_WIDTH_UNITS;
  const kbH = cell * KEYBOARD_HEIGHT_UNITS;
  const stepPx = cell / GRID_CELLS_PER_KEY;
  const cols = Math.max(1, Math.floor(kbW / stepPx));
  const rows = Math.max(1, Math.floor(kbH / stepPx));
  const usedW = cols * stepPx;
  const usedH = rows * stepPx;
  const marginX = (kbW - usedW) / 2;
  const marginY = (kbH - usedH) / 2;
  const hitR = stepPx * GRID_NODE_HIT_RADIUS_FRAC;
  const r = hitR * GRID_NODE_VISUAL_RADIUS_SCALE;
  const nodes: GridGlowDatum[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const cx = offsetX + marginX + (i + 0.5) * stepPx;
      const cy = offsetY + marginY + (j + 0.5) * stepPx;
      nodes.push({
        id: `${i},${j}`,
        cx,
        cy,
        r,
      });
    }
  }
  return { nodes, stepPx };
}

function buildRadialGradient(
  defs: d3.Selection<SVGDefsElement, undefined, SVGSVGElement, undefined>,
  id: string,
  color: string,
  stops: { offset: string; opacity: number }[],
  radiusPct = "88%",
) {
  const g = defs
    .append("radialGradient")
    .attr("id", id)
    .attr("gradientUnits", "objectBoundingBox")
    .attr("cx", "50%")
    .attr("cy", "50%")
    .attr("r", radiusPct);
  for (const s of stops) {
    g.append("stop")
      .attr("offset", s.offset)
      .attr("stop-color", color)
      .attr("stop-opacity", s.opacity);
  }
}

/** Shared with physics (grid node colliders) so expand/collapse matches glow fade. */
export const KEY_FADE_MS = 320;

type GridCircleDatum = GridGlowDatum & { opacity: number; rDraw: number };

function buildGridCircleRenderData(
  layout: ReturnType<typeof computeKeyboardLayout>,
): GridCircleDatum[] {
  const { nodes: baseNodes } = buildGridGlowData(layout);
  return baseNodes.map((d) => {
    const snap = getGridNodeRenderSnap(d.id);
    const s = Math.max(0, Math.min(1, snap?.displayScale ?? 0));
    const jx = snap?.jitterX ?? 0;
    const jy = snap?.jitterY ?? 0;
    return {
      ...d,
      cx: d.cx + jx,
      cy: d.cy + jy,
      opacity: s,
      rDraw: d.r * s,
    };
  });
}

/**
 * Fast path: sync circle geometry/opacity to the physics snapshot (call once per rAF).
 * No-op if `svg.keyboard-svg` is missing. Does not rebuild defs/gradients.
 */
export function updateGridNodeCirclesFromSnapshot(
  host: HTMLDivElement,
  gradientIdPrefix: string,
) {
  const svg = d3.select(host).select<SVGSVGElement>("svg.keyboard-svg");
  if (svg.empty()) return;

  const layout = computeKeyboardLayout(host.clientWidth, host.clientHeight);
  const { w, h } = layout;
  svg.attr("viewBox", `0 0 ${w} ${h}`);

  const activeGradId = `${gradientIdPrefix}-glow-node`;
  const nodes = buildGridCircleRenderData(layout);

  svg
    .selectAll<SVGCircleElement, GridCircleDatum>("circle.grid-node")
    .data(nodes, (d) => d.id)
    .join(
      (enter) =>
        enter
          .append("circle")
          .attr("class", "grid-node")
          .attr("opacity", 0)
          .attr("r", 0),
      (update) => update,
      (exit) => exit.remove(),
    )
    .attr("cx", (d) => d.cx)
    .attr("cy", (d) => d.cy)
    .attr("r", (d) => d.rDraw)
    .attr("opacity", (d) => d.opacity)
    .attr("fill", `url(#${activeGradId})`)
    .style("pointer-events", "none");
}

/**
 * Full setup: SVG shell, defs/gradient, and grid circles (e.g. mount + resize).
 * Glow size/opacity follow `displayScale` from the physics snapshot (no separate d3 fade).
 */
export function renderKeyboardSvg(
  host: HTMLDivElement,
  _active: Record<string, boolean>,
  gradientIdPrefix: string,
  _animateOpacity = true,
) {
  const layout = computeKeyboardLayout(host.clientWidth, host.clientHeight);
  const { w, h } = layout;
  const nodes = buildGridCircleRenderData(layout);

  const activeGradId = `${gradientIdPrefix}-glow-node`;

  const root = d3.select(host);
  const svg = root
    .selectAll<SVGSVGElement, undefined>("svg.keyboard-svg")
    .data([undefined])
    .join("svg")
    .attr("class", "keyboard-svg")
    .attr("width", "100%")
    .attr("height", "100%")
    .style("position", "absolute")
    .style("inset", "0")
    .style("z-index", "1")
    .attr("viewBox", `0 0 ${w} ${h}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .style("overflow", "visible");

  const defs = svg
    .selectAll<SVGDefsElement, undefined>("defs")
    .data([undefined])
    .join("defs");

  defs.selectAll("*").remove();

  buildRadialGradient(
    defs,
    activeGradId,
    "#60a5fa",
    [
      { offset: "0%", opacity: 0.32 },
      { offset: "14%", opacity: 0.24 },
      { offset: "32%", opacity: 0.16 },
      { offset: "52%", opacity: 0.08 },
      { offset: "72%", opacity: 0 },
    ],
    "100%",
  );

  svg
    .selectAll<SVGCircleElement, GridCircleDatum>("circle.grid-node")
    .data(nodes, (d) => d.id)
    .join(
      (enter) =>
        enter
          .append("circle")
          .attr("class", "grid-node")
          .attr("opacity", 0)
          .attr("r", 0),
      (update) => update,
      (exit) => exit.remove(),
    )
    .attr("cx", (d) => d.cx)
    .attr("cy", (d) => d.cy)
    .attr("r", (d) => d.rDraw)
    .attr("opacity", (d) => d.opacity)
    .attr("fill", `url(#${activeGradId})`)
    .style("pointer-events", "none");
}
