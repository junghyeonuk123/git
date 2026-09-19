// ============================================================
// Player: movement, dribble bounce animation, dribble-move
// state machine, and shot-charging integration.
// ============================================================

class Player {
  constructor(ball) {
    this.x = 160;
    this.y = GROUND_Y;
    this.facing = 1;
    this.speed = 230;

    this.ball = ball;
    this.hasBall = true;
    this.ballHand = 1; // 1 = right hand side, -1 = left hand side

    this.dribblePhase = 0;

    this.currentMove = null; // { def, elapsed, startHand }
    this.cooldowns = {}; // moveName -> seconds remaining

    this.shotState = 'idle'; // 'idle' | 'charging' | 'locked'
    this.meter = 0;

    this.popup = null; // { text, timer, maxTimer }
    this.legSwing = 0;
  }

  tryMove(name) {
    if (!this.hasBall) return false;
    if (this.shotState !== 'idle') return false;
    if (this.currentMove) return false;
    if (this.cooldowns[name] > 0) return false;

    const def = MOVES[name];
    if (!def) return false;
    this.currentMove = { name, def, elapsed: 0, startHand: this.ballHand };
    this.popup = { text: def.label, timer: 0.9, maxTimer: 0.9 };
    return true;
  }

  startCharging() {
    if (!this.hasBall || this.shotState !== 'idle') return;
    this.currentMove = null;
    this.shotState = 'charging';
    this.meter = 0;
  }

  // returns the meter value at release, or null if nothing to release
  releaseCharge() {
    if (this.shotState !== 'charging') return null;
    const value = this.meter;
    this.shotState = 'locked';
    return value;
  }

  update(dt, input, game) {
    // cooldown timers
    for (const k in this.cooldowns) {
      if (this.cooldowns[k] > 0) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    }
    if (this.popup) {
      this.popup.timer -= dt;
      if (this.popup.timer <= 0) this.popup = null;
    }

    // ---- movement ----
    let inputDir = 0;
    if (input.isDown('LEFT')) inputDir -= 1;
    if (input.isDown('RIGHT')) inputDir += 1;

    let speedMul = 1;
    let forced = null;
    let moveProgress = 0;
    if (this.currentMove) {
      const { def, elapsed } = this.currentMove;
      moveProgress = Math.min(1, elapsed / def.duration);
      speedMul = def.speedCurve ? def.speedCurve(moveProgress) : 1;
      forced = def.forcedDirection || null;
    }

    let dx;
    if (forced !== null) {
      dx = forced * this.facing * this.speed * speedMul;
    } else {
      if (inputDir !== 0) this.facing = inputDir > 0 ? 1 : -1;
      dx = inputDir * this.speed * speedMul;
    }
    this.x += dx * dt;
    this.x = Math.max(PLAYER_MIN_X, Math.min(PLAYER_MAX_X, this.x));
    this.legSwing += Math.abs(dx) * dt * 0.02;

    // ---- advance current move ----
    if (this.currentMove) {
      this.currentMove.elapsed += dt;
      if (this.currentMove.elapsed >= this.currentMove.def.duration) {
        if (this.currentMove.def.flipsHand) this.ballHand *= -1;
        this.cooldowns[this.currentMove.name] = this.currentMove.def.cooldown;
        this.currentMove = null;
      }
    }

    // ---- shot charging ----
    if (this.shotState === 'charging') {
      this.meter = Math.min(METER_CAP, this.meter + METER_FILL_RATE * dt);
    }

    // ---- ball follow / dribble animation ----
    if (this.hasBall) {
      if (this.shotState === 'charging' || this.shotState === 'locked') {
        // gather the ball toward a set-shot pose
        const targetX = this.x + 8 * this.facing;
        const targetY = GROUND_Y - BALL_RADIUS - 48;
        this.ball.x += (targetX - this.ball.x) * Math.min(1, dt * 14);
        this.ball.y += (targetY - this.ball.y) * Math.min(1, dt * 14);
        this.ball.state = 'held';
      } else {
        let heightMul = 1;
        let freqMul = 1;
        let handUnits = this.ballHand;
        if (this.currentMove) {
          const { def, startHand } = this.currentMove;
          const b = def.bounceCurve ? def.bounceCurve(moveProgress) : { heightMul: 1, freqMul: 1 };
          heightMul = b.heightMul;
          freqMul = b.freqMul;
          handUnits = def.offsetCurve(moveProgress, startHand);
        }
        this.dribblePhase += dt * DRIBBLE_FREQ * freqMul * Math.PI * 2;
        const bounce = Math.abs(Math.sin(this.dribblePhase)) * DRIBBLE_BOUNCE_HEIGHT * heightMul;
        this.ball.x = this.x + handUnits * HAND_OFFSET;
        this.ball.y = GROUND_Y - BALL_RADIUS - bounce;
        this.ball.state = 'held';
      }
    }
  }

  draw(ctx) {
    const x = this.x;
    const groundY = GROUND_Y;
    const bob = this.hasBall && this.shotState === 'idle' ? Math.abs(Math.sin(this.dribblePhase)) * 3 : 0;
    const bodyTop = groundY - 92 - bob;
    const hipY = groundY - 46 - bob;

    ctx.save();
    ctx.translate(x, 0);
    const f = this.facing;

    // legs
    ctx.strokeStyle = '#2b2f77';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    const legSpread = 10 + Math.sin(this.legSwing) * 6;
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(-legSpread * f * 0.4 - 4, groundY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(legSpread * f * 0.4 + 4, groundY);
    ctx.stroke();

    // torso
    ctx.strokeStyle = '#e74c3c';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(0, bodyTop);
    ctx.stroke();

    // head
    ctx.fillStyle = '#f1c27d';
    ctx.beginPath();
    ctx.arc(0, bodyTop - 14, 11, 0, Math.PI * 2);
    ctx.fill();

    // off arm
    ctx.strokeStyle = '#f1c27d';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(0, bodyTop + 10);
    ctx.lineTo(-10 * f, bodyTop + 30);
    ctx.stroke();

    // dribbling arm follows the ball only while it's actually in hand
    if (this.hasBall) {
      const armTargetX = this.ball.x - x;
      const armTargetY = this.ball.y - 4;
      ctx.beginPath();
      ctx.moveTo(0, bodyTop + 10);
      ctx.lineTo(armTargetX, Math.min(armTargetY, groundY));
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(0, bodyTop + 10);
      ctx.lineTo(12 * f, bodyTop + 30);
      ctx.stroke();
    }

    ctx.restore();
  }
}
