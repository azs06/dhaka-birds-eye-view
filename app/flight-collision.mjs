/**
 * Reject a building impact without discarding upward recovery movement.
 *
 * @param {{ y: number, copy: (source: { x: number, y: number, z: number }) => unknown }} position
 * @param {{ x: number, y: number, z: number }} previousPosition
 */
export function resolveBuildingCollision(position, previousPosition) {
  const collisionAltitude = Math.max(position.y, previousPosition.y);
  position.copy(previousPosition);
  position.y = collisionAltitude;
}
