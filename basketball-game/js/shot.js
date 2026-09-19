// ============================================================
// Turns a release "meter" value + player position into an
// actual launch velocity, via real projectile-motion targeting.
// The resulting flight is then handled entirely by physics.js
// (rim / backboard / net collisions decide the real outcome).
// ============================================================

function angleForDistance(dx) {
  const deg = 80 - dx * 0.08;
  return Math.max(50, Math.min(80, deg)) * (Math.PI / 180);
}

// Closed-form continuous-physics estimate of the launch speed (angle fixed)
// needed to pass through (targetX,targetY) starting from (x0,y0).
// Used only as a starting guess for solveSpeed's numeric refinement below,
// since the real simulation is stepped (discrete), not continuous.
function solveSpeedContinuous(x0, y0, targetX, targetY, angle) {
  const dx = targetX - x0;
  const dyUp = y0 - targetY; // positive when target is above release point
  const cos = Math.cos(angle);
  const tan = Math.tan(angle);
  const denom = 2 * cos * cos * (dx * tan - dyUp);
  if (denom <= 0) return null; // unreachable at this angle
  const v2 = (GRAVITY * dx * dx) / denom;
  if (v2 <= 0) return null;
  return Math.sqrt(v2);
}

// Default simulation step used when no live frame-rate estimate is
// available yet (matches a typical 60Hz display).
const DEFAULT_SOLVE_DT = 1 / 60;

// Simulates an unobstructed parabolic flight (same stepping scheme as
// physics.js) and returns the x position where it crosses targetY.
function simulateCrossingX(x0, y0, vx, vy, targetY, simDt) {
  let x = x0;
  let y = y0;
  let vyc = vy;
  let prevX = x;
  let prevY = y;
  for (let i = 0; i < 600; i++) {
    prevX = x;
    prevY = y;
    vyc += GRAVITY * simDt;
    x += vx * simDt;
    y += vyc * simDt;
    if (prevY < targetY && y >= targetY) {
      const t = (targetY - prevY) / (y - prevY);
      return prevX + (x - prevX) * t;
    }
  }
  return x;
}

// Numerically refines the launch speed so the *discretely stepped* flight
// (matching the real physics loop, at the caller's actual measured frame
// dt) actually threads (targetX,targetY) - removing the small systematic
// bias a continuous closed-form solve has against stepped integration,
// and adapting to the player's real refresh rate (60/120/144Hz...).
// Important since the rim gap is narrow relative to the ball.
function solveSpeed(x0, y0, targetX, targetY, angle, simDt) {
  simDt = simDt || DEFAULT_SOLVE_DT;
  const guess = solveSpeedContinuous(x0, y0, targetX, targetY, angle);
  if (!guess) return null;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const f = (s) => simulateCrossingX(x0, y0, s * cos, -s * sin, targetY, simDt) - targetX;

  let s0 = guess * 0.92;
  let s1 = guess * 1.08;
  let f0 = f(s0);
  let f1 = f(s1);
  for (let i = 0; i < 12 && Math.abs(f1) > 0.5; i++) {
    if (Math.abs(f1 - f0) < 1e-6) break;
    const s2 = s1 - (f1 * (s1 - s0)) / (f1 - f0);
    s0 = s1;
    f0 = f1;
    s1 = s2;
    f1 = f(s2);
  }
  return s1;
}

function velocityFromSpeed(speed, angle) {
  return { vx: speed * Math.cos(angle), vy: -speed * Math.sin(angle) };
}

// Fallback generic power curve for meter values outside the
// "targeted" swish/bank windows - produces realistic misses
// (short airballs, long airballs hitting the backboard hard, etc).
function genericVelocity(x0, y0, meter, refSpeed, refAngle) {
  let factor;
  if (meter <= ZONE_WEAK_MAX) {
    factor = lerp(0.55, 0.9, meter / ZONE_WEAK_MAX);
  } else {
    const t = Math.min(1, (meter - ZONE_BANK_MAX) / (METER_CAP - ZONE_BANK_MAX));
    factor = lerp(1.08, 1.6, t);
  }
  const speed = refSpeed * factor;
  return velocityFromSpeed(speed, refAngle);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Computes the launch velocity for a shot released with the given meter
// value. `simDt` should be the caller's live measured average frame delta
// (falls back to a 60Hz assumption if omitted) so the targeting solve
// matches whatever refresh rate the shot will actually be simulated at.
function computeShotVelocity(x0, y0, meter, simDt) {
  const dxRim = RIM_CENTER_X - x0;
  const rimAngle = angleForDistance(dxRim);
  let refSpeed = solveSpeed(x0, y0, RIM_CENTER_X, RIM_Y, rimAngle, simDt);
  if (!refSpeed) refSpeed = 520;

  if (meter >= ZONE_SWISH_MIN && meter <= ZONE_SWISH_MAX) {
    return velocityFromSpeed(refSpeed, rimAngle);
  }

  if (meter > ZONE_SWISH_MAX && meter <= ZONE_BANK_MAX) {
    const dxBank = BACKBOARD_X - BALL_RADIUS - x0;
    const bankAngle = angleForDistance(dxBank);
    let bankSpeed = solveSpeed(x0, y0, BACKBOARD_X - BALL_RADIUS, BANK_SPOT_Y, bankAngle, simDt);
    if (!bankSpeed) bankSpeed = refSpeed * 1.08;
    return velocityFromSpeed(bankSpeed, bankAngle);
  }

  return genericVelocity(x0, y0, meter, refSpeed, rimAngle);
}
