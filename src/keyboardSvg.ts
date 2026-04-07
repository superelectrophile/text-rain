import * as d3 from "d3";
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
  /** Visual (and physics target) radius at full scale */
  r: number;
  desired: boolean;
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

export function isGridNodeDesired(
  cx: number,
  cy: number,
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
    const dx = cx - kx;
    const dy = cy - ky;
    if (dx * dx + dy * dy <= R2) return true;
  }
  return false;
}

/**
 * Grid node positions + desired state from logical key activations.
 * Physics uses the same `desired` predicate so colliders track keys indirectly.
 */
export function buildGridGlowData(
  layout: ReturnType<typeof computeKeyboardLayout>,
  active: Record<string, boolean>,
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
  const r = stepPx * 0.48;
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
        desired: isGridNodeDesired(cx, cy, active, layout),
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

/**
 * Renders or updates the keyboard-area grid glow (small radial fills per node).
 * @param animateOpacity — If false (e.g. resize), opacity/r snap; if true, d3 transitions.
 */
export function renderKeyboardSvg(
  host: HTMLDivElement,
  active: Record<string, boolean>,
  gradientIdPrefix: string,
  animateOpacity = true,
) {
  const layout = computeKeyboardLayout(host.clientWidth, host.clientHeight);
  const { w, h } = layout;
  const { nodes } = buildGridGlowData(layout, active);

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
    .attr("preserveAspectRatio", "xMidYMid meet");

  const defs = svg
    .selectAll<SVGDefsElement, undefined>("defs")
    .data([undefined])
    .join("defs");

  defs.selectAll("*").remove();

  buildRadialGradient(defs, activeGradId, "#60a5fa", [
    { offset: "0%", opacity: 0.55 },
    { offset: "35%", opacity: 0.38 },
    { offset: "100%", opacity: 0 },
  ], "68%");

  const opacityTarget = (d: GridGlowDatum) => (d.desired ? 1 : 0);
  const rTarget = (d: GridGlowDatum) => (d.desired ? d.r : 0);

  const circles = svg
    .selectAll<SVGCircleElement, GridGlowDatum>("circle.grid-node")
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
    .attr("fill", `url(#${activeGradId})`)
    .style("pointer-events", "none");

  if (animateOpacity) {
    circles
      .interrupt("node-fade")
      .transition("node-fade")
      .duration(KEY_FADE_MS)
      .ease(d3.easeCubicInOut)
      .attr("opacity", opacityTarget)
      .attr("r", rTarget);
  } else {
    circles
      .interrupt("node-fade")
      .attr("opacity", opacityTarget)
      .attr("r", rTarget);
  }
}
