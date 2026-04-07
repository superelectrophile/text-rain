export type GridNodeRenderSnap = {
  logicalDesired: boolean;
  /** Eased 0…1; matches Matter collider scale (opacity + radius should follow this). */
  displayScale: number;
  /** Offset from lattice base: live jitter when inactive, frozen offset when active. */
  jitterX: number;
  jitterY: number;
};

let snapshot = new Map<string, GridNodeRenderSnap>();

export function replaceGridNodeRenderSnapshot(next: Map<string, GridNodeRenderSnap>) {
  snapshot = next;
}

export function getGridNodeRenderSnap(id: string): GridNodeRenderSnap | undefined {
  return snapshot.get(id);
}

export function clearGridNodeRenderSnapshot() {
  snapshot.clear();
}
