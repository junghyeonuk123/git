// ============================================================
// Main game loop: wires input -> player -> ball physics,
// resolves makes/misses, and draws everything each frame.
// ============================================================

(function () {
  const canvas = document.getElementById('game');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');

  const ball = new Ball();
  const player = new Player(ball);
  ball.x = player.x;
  ball.y = GROUND_Y - BALL_RADIUS;

  const input = new Input();

  const game = {
    score: 0,
    streak: 0,
    attempts: 0,
    makes: 0,
    popups: [], // floating text near the hoop / court
    pendingShot: false,
    pendingIsThree: false,
    respawnTimer: 0,
  };

  function addPopup(text, x, y, color) {
    game.popups.push({ text, x, y, timer: 1.1, maxTimer: 1.1, color });
  }

  function onScore(usedBackboard) {
    if (!game.pendingShot) return;
    const pts = game.pendingIsThree ? 3 : 2;
    game.score += pts;
    game.makes += 1;
    game.streak += 1;
    game.pendingShot = false;
    game.respawnTimer = 0.9;
    triggerNetSway((Math.random() - 0.5) * 6);
    addPopup(usedBackboard ? `BANK SHOT! +${pts}` : `SWISH! +${pts}`, RIM_CENTER_X, RIM_Y - 60, usedBackboard ? '#3498db' : '#2ecc71');
  }

  function resolveMissIfNeeded(dt) {
    if (!game.pendingShot) return;
    if (ball.scored) return;
    if (ball.state === 'loose' && ball.restTimer > 0.3) {
      game.pendingShot = false;
      game.streak = 0;
      game.respawnTimer = 0.7;
      addPopup('MISS', RIM_CENTER_X, RIM_Y - 60, '#e74c3c');
    }
  }

  let avgDt = 1 / 60;

  function handleShootRelease() {
    const meter = player.releaseCharge();
    if (meter === null) return;
    game.attempts += 1;
    game.pendingShot = true;
    game.pendingIsThree = player.x < THREE_PT_X;
    const { vx, vy } = computeShotVelocity(ball.x, ball.y, meter, avgDt);
    ball.launch(ball.x, ball.y, vx, vy);
    player.hasBall = false;
  }

  function respawnBall() {
    player.hasBall = true;
    player.shotState = 'idle';
    player.meter = 0;
    ball.state = 'held';
    ball.vx = 0;
    ball.vy = 0;
    ball.x = player.x + player.ballHand * HAND_OFFSET;
    ball.y = GROUND_Y - BALL_RADIUS;
  }

  let lastTime = performance.now();
  function loop(now) {
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  function update(dt) {
    avgDt += (dt - avgDt) * 0.1;

    for (const ev of input.consumeEvents()) {
      if (ev.type === 'shootDown') player.startCharging();
      else if (ev.type === 'shootUp') handleShootRelease();
      else if (ev.type === 'move') player.tryMove(ev.name);
    }

    player.update(dt, input, game);
    ball.update(dt, onScore);
    resolveMissIfNeeded(dt);

    if (!player.hasBall && !game.pendingShot) {
      game.respawnTimer -= dt;
      if (game.respawnTimer <= 0) respawnBall();
    }

    for (const p of game.popups) p.timer -= dt;
    game.popups = game.popups.filter((p) => p.timer > 0);
  }

  function draw() {
    drawCourt(ctx);
    player.draw(ctx);
    drawBall(ctx, ball);
    drawShotMeter(ctx, player);
    drawPopups(ctx);
    drawPlayerLabel(ctx, player);
    drawHud(ctx, game);
  }

  function drawBall(ctx, b) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.spin % (Math.PI * 2));
    ctx.fillStyle = '#e67e22';
    ctx.beginPath();
    ctx.arc(0, 0, b.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#4a2c0f';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-b.radius, 0);
    ctx.lineTo(b.radius, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -b.radius);
    ctx.lineTo(0, b.radius);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, b.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawPopups(ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 22px sans-serif';
    for (const p of game.popups) {
      const alpha = Math.max(0, p.timer / p.maxTimer);
      const rise = (1 - alpha) * 30;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y - rise);
    }
    ctx.restore();
  }

  function drawPlayerLabel(ctx, player) {
    if (!player.popup) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 18px sans-serif';
    const alpha = Math.max(0, player.popup.timer / player.popup.maxTimer);
    const rise = (1 - alpha) * 20;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#f1c40f';
    ctx.fillText(player.popup.text, player.x, GROUND_Y - 150 - rise);
    ctx.restore();
  }

  function drawHud(ctx, game) {
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`SCORE  ${game.score}`, 20, 40);
    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#bbb';
    const pct = game.attempts ? Math.round((game.makes / game.attempts) * 100) : 0;
    ctx.fillText(`${game.makes}/${game.attempts} (${pct}%)  streak x${game.streak}`, 20, 62);

    ctx.font = '13px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    const lines = [
      'MOVE: ←/→ or A/D     SHOOT: hold SPACE, release in the sweet spot',
      'DRIBBLE MOVES:  Q crossover   W hesitation   E step-back   R in-and-out   F between the legs',
    ];
    lines.forEach((l, i) => ctx.fillText(l, 20, CANVAS_H - 34 + i * 18));
    ctx.restore();
  }

  requestAnimationFrame(loop);
})();
