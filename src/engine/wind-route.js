// Coordinates are shared by the terrain dressing, landmarks and puzzle receivers.
export const START = { x: 55, z: 55.3 };
export const WALK_MARKER = { x: 28, z: 29.1 };
export const FIRST_BED = { x: -5.3, z: -3.3 };
export const ROUTE = {
  oldTree: { x: -12, z: -9, eyes: [[2, 2, 1.8]] },
  windmill: { x: -104, z: -30, eyes: [[4, 2, 1.6], [-4, 2, 2], [0, -5, 2.4]] },
  updraft: { x: 10, z: -100, eyes: [[0, 0, 5.5]] },
  skyGarden: { x: 67, z: -16, eyes: [[1, 0, 1.5]] },
  spring: { x: -65, z: 84, eyes: [[-3, 1, 1.4], [3, -1, 4.2]] },
  sundial: { x: 103, z: 17, eyes: [[0, 2, 2.4]] }
};

const stops = [START, WALK_MARKER, FIRST_BED, ...Object.values(ROUTE)];
export const trailLegs = stops.slice(1).map((end, i) => {
  const start = stops[i];
  const length = Math.hypot(end.x - start.x, end.z - start.z);
  const dx = (end.x - start.x) / length, dz = (end.z - start.z) / length;
  return { start, end, length, dx, dz };
});

export function trailBend(fraction) {
  return 2 * Math.sin(fraction * Math.PI * 2);
}

export function onTrail(x, z) {
  if (Math.hypot(x,z-1.2) < 3.2) return true;
  for (const { start, length, dx, dz } of trailLegs) {
    const rx = x - start.x, rz = z - start.z;
    const along = rx * dx + rz * dz;
    if (along < 0 || along > length) continue;
    if (Math.abs(rz * dx - rx * dz - trailBend(along / length)) < 1.55) return true;
  }
  return Math.hypot(x + 6.5, z + 4) < 2.6;
}
