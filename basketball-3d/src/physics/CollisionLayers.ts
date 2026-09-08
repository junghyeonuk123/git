/**
 * Rapier interaction groups: a 32-bit value packed as
 * (membership: top 16 bits) | (filter: bottom 16 bits).
 * Two colliders interact only if each one's membership bits are present
 * in the other's filter mask - lets us e.g. stop the ball colliding with
 * the invisible scoring volume's *physics* while still overlap-testing it.
 */
export const CollisionGroup = {
  Court: 1 << 0,
  Ball: 1 << 1,
  Rim: 1 << 2,
  Backboard: 1 << 3,
  Player: 1 << 4,
  ScoringVolume: 1 << 5,
} as const;

export function interactionGroups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

export const ALL_GROUPS = 0xffff;
