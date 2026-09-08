// ============================================================
// Shot meter UI: a vertical gauge with colored zones
// (weak / swish / bank / overpowered) and a fill pointer.
// ============================================================

function drawShotMeter(ctx, player) {
  if (player.shotState === 'idle' && player.meter === 0) return;

  const barX = 60;
  const barY = 120;
  const barW = 26;
  const barH = 300;

  const valToY = (v) => barY + barH - (v / METER_CAP) * barH;

  ctx.save();
  ctx.globalAlpha = 0.95;

  // background
  ctx.fillStyle = 'rgba(10,10,15,0.6)';
  ctx.fillRect(barX - 6, barY - 10, barW + 12, barH + 20);

  // zone segments (drawn bottom-up)
  const zones = [
    { from: 0, to: ZONE_WEAK_MAX, color: '#8d99ae' },
    { from: ZONE_SWISH_MIN, to: ZONE_SWISH_MAX, color: '#2ecc71' },
    { from: ZONE_SWISH_MAX, to: ZONE_BANK_MAX, color: '#3498db' },
    { from: ZONE_BANK_MAX, to: METER_CAP, color: '#e74c3c' },
  ];
  for (const z of zones) {
    const yTop = valToY(z.to);
    const yBot = valToY(z.from);
    ctx.fillStyle = z.color;
    ctx.fillRect(barX, yTop, barW, yBot - yTop);
  }

  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(barX, barY, barW, barH);

  // current fill pointer
  const meterY = valToY(Math.min(player.meter, METER_CAP));
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(barX - 8, meterY);
  ctx.lineTo(barX, meterY - 6);
  ctx.lineTo(barX, meterY + 6);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(barX + barW + 8, meterY);
  ctx.lineTo(barX + barW, meterY - 6);
  ctx.lineTo(barX + barW, meterY + 6);
  ctx.fill();

  ctx.restore();
}
