/** Orb size that fits between the module columns and inside the stage. */
export function fitOrb(stageW: number, stageH: number, colW: number): number {
  if (!stageW || !stageH) return 220;
  // The sphere fills only the middle ~55% of its canvas (rings and the base
  // take the rest), so the canvas may run well behind the module columns,
  // as in the design, while the sphere itself stays between them.
  const byWidth = stageW - 2 * colW + 170;
  const byHeight = stageH * 0.96;
  return Math.max(170, Math.min(380, Math.round(Math.min(byWidth, byHeight))));
}
