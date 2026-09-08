// ============================================================
// Dribble move definitions. Each move is a short scripted
// animation that drives: where the ball sits relative to the
// player's hand (offsetCurve, in units of -1..1, later scaled
// by HAND_OFFSET), how the player's move speed is modulated
// (speedCurve), and how the dribble bounce itself looks
// (bounceCurve). `flipsHand` means the ball ends up controlled
// by the opposite hand once the move completes.
// ============================================================

const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

const MOVES = {
  crossover: {
    key: 'CROSSOVER',
    label: 'CROSSOVER!',
    duration: 0.32,
    cooldown: 0.5,
    flipsHand: true,
    speedCurve: (t) => 1 + 0.35 * Math.sin(Math.PI * t),
    offsetCurve: (t, startHand) => startHand * (1 - 2 * easeOutQuad(t)),
    bounceCurve: (t) => ({ heightMul: 0.7, freqMul: 1.8 }),
  },

  hesitation: {
    key: 'HESITATION',
    label: 'HESITATION...GO!',
    duration: 0.6,
    cooldown: 0.7,
    flipsHand: false,
    speedCurve: (t) => (t < 0.55 ? 0.3 : 1.9),
    offsetCurve: (t, startHand) => startHand * (t < 0.55 ? 1 : 0.6),
    bounceCurve: (t) => (t < 0.55 ? { heightMul: 0.35, freqMul: 0.6 } : { heightMul: 1.3, freqMul: 2.2 }),
  },

  stepback: {
    key: 'STEPBACK',
    label: 'STEP-BACK!',
    duration: 0.42,
    cooldown: 0.8,
    flipsHand: false,
    forcedDirection: -1, // moves opposite the player's facing direction
    speedCurve: (t) => (t < 0.55 ? 2.1 : 0),
    offsetCurve: (t, startHand) => startHand * (1 - 0.5 * easeOutQuad(t)),
    bounceCurve: (t) => ({ heightMul: 0.55, freqMul: 1.2 }),
  },

  inAndOut: {
    key: 'IN_AND_OUT',
    label: 'IN-AND-OUT!',
    duration: 0.28,
    cooldown: 0.4,
    flipsHand: false,
    speedCurve: (t) => 1 + 0.5 * Math.sin(Math.PI * t),
    offsetCurve: (t, startHand) => {
      // fake to the opposite side then snap back to the original hand
      const swing = Math.sin(Math.PI * Math.min(t * 1.6, 1));
      return startHand * (1 - 1.8 * swing * (1 - t));
    },
    bounceCurve: (t) => ({ heightMul: 0.6, freqMul: 2.4 }),
  },

  legsThrough: {
    key: 'LEGS_THROUGH',
    label: 'BETWEEN THE LEGS!',
    duration: 0.46,
    cooldown: 0.65,
    flipsHand: true,
    speedCurve: (t) => 0.75,
    offsetCurve: (t, startHand) => startHand * (1 - 2 * easeInOutSine(t)),
    bounceCurve: (t) => {
      // one deep, slow dip straight down between the legs
      const dip = Math.sin(Math.PI * t);
      return { heightMul: 0.25 + dip * 0.15, freqMul: 1, forcedPhase: t < 0.5 ? 0.5 : 0 };
    },
  },
};
