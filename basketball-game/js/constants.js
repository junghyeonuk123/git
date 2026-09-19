// ============================================================
// Global constants & tunable game parameters
// ============================================================
const CANVAS_W = 960;
const CANVAS_H = 540;
const GROUND_Y = 470;

// Physics (pixels / seconds)
const GRAVITY = 1500; // px/s^2
const BALL_RADIUS = 11;

// Restitution / friction
const GROUND_RESTITUTION = 0.58;
const GROUND_FRICTION = 0.86; // multiplies vx on ground bounce
const RIM_RESTITUTION = 0.5;
const BACKBOARD_RESTITUTION = 0.42;

// Hoop geometry (right side of court)
const BACKBOARD_X = 858; // face of backboard (ball collides here)
const BACKBOARD_TOP = 190;
const BACKBOARD_BOTTOM = 330;
const RIM_Y = 300;
const RIM_LEFT_X = 796;
const RIM_RIGHT_X = 852;
const RIM_POST_RADIUS = 1.6;
const RIM_CENTER_X = (RIM_LEFT_X + RIM_RIGHT_X) / 2;
const NET_HEIGHT = 62;
const BANK_SPOT_Y = RIM_Y - 34; // sweet spot on the backboard for bank shots

// Three point line
const THREE_PT_X = 300;

// Player bounds so the shooter always stands to the left of the rim
const PLAYER_MIN_X = 40;
const PLAYER_MAX_X = RIM_LEFT_X - 110;

// Shot meter tuning (seconds of hold time == "meter value" in this scale)
const METER_FILL_RATE = 1.0; // units per second
const METER_CAP = 1.15;
const ZONE_WEAK_MAX = 0.62; // below -> weak / short
const ZONE_SWISH_MIN = 0.62;
const ZONE_SWISH_MAX = 0.70; // sweet spot -> perfect swish
const ZONE_BANK_MAX = 0.80; // a little too strong -> bank shot
// above ZONE_BANK_MAX -> overpowered / long miss

// Dribble
const DRIBBLE_BOUNCE_HEIGHT = 34;
const DRIBBLE_FREQ = 3.6; // bounces per second baseline
const HAND_OFFSET = 14; // how far the ball sits from body center while dribbling

const KEY = {
  LEFT: ['ArrowLeft', 'a', 'A'],
  RIGHT: ['ArrowRight', 'd', 'D'],
  SHOOT: [' ', 'Spacebar'],
  CROSSOVER: ['q', 'Q'],
  HESITATION: ['w', 'W'],
  STEPBACK: ['e', 'E'],
  IN_AND_OUT: ['r', 'R'],
  LEGS_THROUGH: ['f', 'F'],
};
