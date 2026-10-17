const DRAG_PX_FOR_FULL_RANGE = 150;
// Closer than this, the direction to the centre jitters too much to tell circling from sliding.
const CENTRE_PX = 12;

export interface KnobDrag {
  cx: number;
  cy: number;
  /** Where the pointer was at the previous move. */
  x: number;
  y: number;
}

/**
 * How far moving the pointer from (d.x, d.y) to (x, y) turns the knob, as a fraction of its range.
 * Movement around the centre turns it like a real knob, clockwise for up. Movement toward or away
 * from the centre reads as a slide, up or right for up. Summing raw x and y instead stalls a
 * clockwise circle down the right-hand side, where right and down cancel.
 */
export const dragTurn = (d: KnobDrag, x: number, y: number): number => {
  const mx = x - d.x;
  const my = y - d.y;
  const r = Math.hypot(d.x - d.cx, d.y - d.cy);
  if (r < CENTRE_PX) return (mx - my) / DRAG_PX_FOR_FULL_RANGE;
  const rx = (d.x - d.cx) / r;
  const ry = (d.y - d.cy) / r;
  const around = -mx * ry + my * rx;
  const along = (mx * rx + my * ry) * (rx - ry);
  return (around + along) / DRAG_PX_FOR_FULL_RANGE;
};
