/**
 * Resolve a building impact without discarding upward recovery movement.
 *
 * Rejecting the whole horizontal step pins the crow flat against a wall for as
 * long as forward is held, because every frame restores the same position. When
 * the struck collider is known, only the axis that was actually breached is
 * rejected, so a glancing hit slides along the facade instead of stopping dead.
 *
 * @param {{ x: number, y: number, z: number, copy: (source: { x: number, y: number, z: number }) => unknown }} position
 * @param {{ x: number, y: number, z: number }} previousPosition
 * @param {{ x: number, z: number, halfWidth: number, halfDepth: number } | undefined} [building]
 */
export function resolveBuildingCollision(position, previousPosition, building) {
  const collisionAltitude = Math.max(position.y, previousPosition.y);
  const blockedX = position.x;
  const blockedZ = position.z;
  position.copy(previousPosition);
  position.y = collisionAltitude;
  if (!building) return;

  // An axis the crow was already clear of before this step is the one it just
  // crossed, so that is the axis to cancel. The other keeps its movement.
  const wasClearOfX = Math.abs(previousPosition.x - building.x) >= building.halfWidth;
  const wasClearOfZ = Math.abs(previousPosition.z - building.z) >= building.halfDepth;
  // Clear of neither means the crow started inside the footprint (a collider that
  // appeared around it as the map streamed in): reject everything and let the
  // altitude recovery lift it out.
  if (!wasClearOfX && !wasClearOfZ) return;
  if (!wasClearOfX) position.x = blockedX;
  if (!wasClearOfZ) position.z = blockedZ;
}
