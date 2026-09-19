// ============================================================
// Ball entity + collision physics against rim posts, backboard,
// net drag zone and the floor.
// ============================================================

class Ball {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.radius = BALL_RADIUS;
    this.state = 'held'; // 'held' | 'shot' | 'loose'
    this.spin = 0;
    this.touchedRim = false;
    this.touchedBackboard = false;
    this.scored = false;
    this.prevY = 0;
    this.restTimer = 0; // how long it's been basically stationary
  }

  launch(x, y, vx, vy) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.state = 'shot';
    this.touchedRim = false;
    this.touchedBackboard = false;
    this.scored = false;
    this.restTimer = 0;
  }

  update(dt, onScore) {
    if (this.state === 'held') return;

    this.prevY = this.y;
    this.vy += GRAVITY * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.spin += this.vx * dt * 0.05;

    this._netDrag(dt);
    this._collideRimPosts();
    this._collideBackboard();
    this._collideGround();
    this._checkScore(onScore);

    // settle / go loose when basically stopped
    const speed = Math.hypot(this.vx, this.vy);
    if (this.y > GROUND_Y - this.radius - 1 && speed < 40) {
      this.restTimer += dt;
    } else {
      this.restTimer = 0;
    }
  }

  _netDrag(dt) {
    const withinX = this.x > RIM_LEFT_X - 6 && this.x < RIM_RIGHT_X + 6;
    const withinY = this.y > RIM_Y && this.y < RIM_Y + NET_HEIGHT;
    if (withinX && withinY && this.vy > 0) {
      // net funnels the ball toward the center and slows it down
      this.vx *= Math.pow(0.90, dt * 60);
      this.vy *= Math.pow(0.985, dt * 60);
      const pull = (RIM_CENTER_X - this.x) * 0.06;
      this.x += pull * dt * 60 * 0.15;
    }
  }

  _collideCircle(px, py, pr) {
    const dx = this.x - px;
    const dy = this.y - py;
    const dist = Math.hypot(dx, dy);
    const minDist = this.radius + pr;
    if (dist < minDist && dist > 0.0001) {
      const nx = dx / dist;
      const ny = dy / dist;
      // push out of overlap
      const overlap = minDist - dist;
      this.x += nx * overlap;
      this.y += ny * overlap;
      // reflect velocity about normal
      const vDotN = this.vx * nx + this.vy * ny;
      this.vx -= (1 + RIM_RESTITUTION) * vDotN * nx;
      this.vy -= (1 + RIM_RESTITUTION) * vDotN * ny;
      // slight tangential friction
      this.vx *= 0.96;
      this.vy *= 0.96;
      return true;
    }
    return false;
  }

  _collideRimPosts() {
    const hitLeft = this._collideCircle(RIM_LEFT_X, RIM_Y, RIM_POST_RADIUS);
    const hitRight = this._collideCircle(RIM_RIGHT_X, RIM_Y, RIM_POST_RADIUS);
    if (hitLeft || hitRight) this.touchedRim = true;
  }

  _collideBackboard() {
    // Backboard modeled as a vertical face; ball bounces off the front (left) face.
    const withinY = this.y > BACKBOARD_TOP - this.radius && this.y < BACKBOARD_BOTTOM + this.radius;
    const ballRight = this.x + this.radius;
    if (withinY && ballRight > BACKBOARD_X && this.x < BACKBOARD_X + 20 && this.vx > 0) {
      this.x = BACKBOARD_X - this.radius;
      this.vx = -this.vx * BACKBOARD_RESTITUTION;
      this.vy *= 0.92;
      this.touchedBackboard = true;
    }
  }

  _collideGround() {
    if (this.y + this.radius >= GROUND_Y) {
      this.y = GROUND_Y - this.radius;
      if (Math.abs(this.vy) > 30) {
        this.vy = -this.vy * GROUND_RESTITUTION;
        this.vx *= GROUND_FRICTION;
      } else {
        this.vy = 0;
        this.vx *= 0.85;
      }
      if (this.state === 'shot') this.state = 'loose';
    }
    // side walls
    if (this.x - this.radius < 0) {
      this.x = this.radius;
      this.vx = -this.vx * 0.5;
    }
    if (this.x + this.radius > CANVAS_W) {
      this.x = CANVAS_W - this.radius;
      this.vx = -this.vx * 0.5;
    }
  }

  _checkScore(onScore) {
    if (this.scored) return;
    const crossedDown = this.prevY < RIM_Y && this.y >= RIM_Y && this.vy > 0;
    const withinRim = this.x > RIM_LEFT_X + this.radius * 0.3 && this.x < RIM_RIGHT_X - this.radius * 0.3;
    if (crossedDown && withinRim) {
      this.scored = true;
      if (onScore) onScore(this.touchedBackboard);
    }
  }
}
