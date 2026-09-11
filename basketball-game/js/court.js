// ============================================================
// Drawing the court, backboard, rim & net.
// ============================================================

function drawCourt(ctx) {
  // background
  const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  grad.addColorStop(0, '#1a2436');
  grad.addColorStop(1, '#0d1420');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // floor
  ctx.fillStyle = '#c98a4b';
  ctx.fillRect(0, GROUND_Y, CANVAS_W, CANVAS_H - GROUND_Y);
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  for (let x = 0; x < CANVAS_W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, GROUND_Y);
    ctx.lineTo(x, CANVAS_H);
    ctx.stroke();
  }

  // three point arc (simplified as line + small arc)
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(THREE_PT_X, GROUND_Y);
  ctx.lineTo(THREE_PT_X, GROUND_Y - 10);
  ctx.stroke();
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(THREE_PT_X, 60);
  ctx.lineTo(THREE_PT_X, GROUND_Y - 10);
  ctx.stroke();
  ctx.setLineDash([]);

  // pole
  ctx.fillStyle = '#333';
  ctx.fillRect(BACKBOARD_X + 14, BACKBOARD_TOP - 10, 8, GROUND_Y - BACKBOARD_TOP + 10);

  // backboard
  ctx.fillStyle = 'rgba(230,230,240,0.92)';
  ctx.fillRect(BACKBOARD_X, BACKBOARD_TOP, 8, BACKBOARD_BOTTOM - BACKBOARD_TOP);
  ctx.strokeStyle = '#c0392b';
  ctx.lineWidth = 2;
  ctx.strokeRect(BACKBOARD_X - 2, BANK_SPOT_Y - 16, 12, 22);

  // net
  drawNet(ctx);

  // rim
  ctx.strokeStyle = '#e8621a';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(RIM_LEFT_X, RIM_Y);
  ctx.lineTo(RIM_RIGHT_X, RIM_Y);
  ctx.stroke();
  ctx.fillStyle = '#e8621a';
  ctx.beginPath();
  ctx.arc(RIM_LEFT_X, RIM_Y, RIM_POST_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(RIM_RIGHT_X, RIM_Y, RIM_POST_RADIUS, 0, Math.PI * 2);
  ctx.fill();
}

let netSway = 0;
function triggerNetSway(impulse) {
  netSway = impulse;
}
function drawNet(ctx) {
  netSway *= 0.9;

  const bottomY = RIM_Y + NET_HEIGHT;
  const centerX = RIM_CENTER_X + netSway;
  const strands = 7;
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i <= strands; i++) {
    const t = i / strands;
    const topX = RIM_LEFT_X + t * (RIM_RIGHT_X - RIM_LEFT_X);
    const botX = centerX + (t - 0.5) * (RIM_RIGHT_X - RIM_LEFT_X) * 0.35;
    ctx.beginPath();
    ctx.moveTo(topX, RIM_Y);
    ctx.quadraticCurveTo((topX + botX) / 2, RIM_Y + NET_HEIGHT * 0.55, botX, bottomY);
    ctx.stroke();
  }
  // horizontal net rings
  for (let r = 1; r <= 2; r++) {
    const ty = RIM_Y + (NET_HEIGHT / 3) * r;
    const widthAt = (RIM_RIGHT_X - RIM_LEFT_X) * (1 - r * 0.22);
    ctx.beginPath();
    ctx.ellipse(centerX, ty, widthAt / 2, 3, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}
