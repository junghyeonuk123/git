/**
 * Regulation NBA court dimensions, converted to meters. Every court/hoop
 * module reads from here instead of hardcoding numbers, so the ruleset
 * (e.g. switching to FIBA dimensions later) only changes in one place.
 */
const FT = 0.3048; // meters per foot
const IN = 0.0254; // meters per inch

export const CourtDimensions = {
  length: 94 * FT, // baseline to baseline
  width: 50 * FT, // sideline to sideline
  apron: 2.0, // extra floor rendered/collidable beyond the lines

  paint: {
    width: 16 * FT,
    length: 19 * FT,
  },

  freeThrowLineDistance: 15 * FT, // from the backboard face
  centerCircleRadius: 6 * FT,

  threePoint: {
    cornerDistance: 22 * FT,
    arcDistance: 23.75 * FT,
    // the straight corner segment runs parallel to the sideline out to this length
    // before the arc takes over
    cornerLineLength: 14 * FT,
  },

  hoop: {
    rimHeight: 10 * FT,
    rimRadius: 9 * IN, // regulation inner rim diameter is 18in
    rimTubeRadius: 0.02, // thickness of the rim tube itself
    rimDistanceFromBackboard: 1 * FT + 3 * IN, // rim center sits ~15in off the board face
    backboardWidth: 6 * FT,
    backboardHeight: 3.5 * FT,
    backboardThickness: 0.03,
    backboardBottomHeight: 9 * FT,
    backboardDistanceFromBaseline: 4 * FT,
    poleSetback: 1 * FT + 8 * IN, // additional structure behind the board
    netHeight: 15 * IN,
  },

  ball: {
    radius: 0.1213, // ~24.3cm official diameter
    mass: 0.62, // kg
  },

  player: {
    capsuleRadius: 0.28,
    capsuleHeight: 1.4, // cylindrical part only; total height = this + 2*radius ~= 1.96m
    eyeHeight: 1.75,
  },
} as const;
