import type { VictoryCardData } from "./types";
import { generateQrMatrix } from "./qr-generator";

export function renderVictoryCardToCanvas(canvas: HTMLCanvasElement, data: VictoryCardData): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = 640;
  const height = data.kind === "MATCH" ? 820 : 760;
  const scale = 2; // 2x Retina resolution

  canvas.width = width * scale;
  canvas.height = height * scale;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  ctx.scale(scale, scale);

  // Background Gradient
  const bgGradient = ctx.createLinearGradient(0, 0, width, height);
  bgGradient.addColorStop(0, "#0E1015");
  bgGradient.addColorStop(0.5, "#14171E");
  bgGradient.addColorStop(1, "#0A0B0E");
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, width, height);

  // Subtle sports grid pattern
  ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
  ctx.lineWidth = 1;
  const step = 32;
  for (let x = 0; x < width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Laser diagonal streak
  const laserGradient = ctx.createLinearGradient(width - 240, 0, width, 240);
  laserGradient.addColorStop(0, "rgba(225, 6, 0, 0.6)");
  laserGradient.addColorStop(1, "rgba(225, 6, 0, 0)");
  ctx.strokeStyle = laserGradient;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(width - 200, 0);
  ctx.lineTo(width, 200);
  ctx.stroke();

  // Outer border with sleek bevel
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, 16, 16, width - 32, height - 32, 20);
  ctx.stroke();

  // Top Brand Bar
  ctx.fillStyle = "#E10600";
  ctx.fillRect(36, 42, 6, 22);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "900 13px system-ui, -apple-system, sans-serif";
  ctx.letterSpacing = "2px";
  ctx.fillText("PULSE SPORTS CLUB", 50, 58);

  // Verified Badge
  ctx.fillStyle = "rgba(0, 229, 153, 0.12)";
  drawRoundedRect(ctx, width - 180, 38, 144, 28, 14);
  ctx.fill();
  ctx.strokeStyle = "rgba(0, 229, 153, 0.4)";
  ctx.lineWidth = 1;
  drawRoundedRect(ctx, width - 180, 38, 144, 28, 14);
  ctx.stroke();

  ctx.fillStyle = "#00E599";
  ctx.beginPath();
  ctx.arc(width - 166, 52, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = "bold 11px system-ui, -apple-system, sans-serif";
  ctx.letterSpacing = "0.5px";
  ctx.fillText("OFFICIAL AUDIT", width - 154, 56);

  if (data.kind === "MATCH") {
    renderMatchContent(ctx, data, width);
  } else {
    renderSeasonContent(ctx, data, width);
  }

  // Footer bar
  const footerY = height - 56;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.beginPath();
  ctx.moveTo(36, footerY - 14);
  ctx.lineTo(width - 36, footerY - 14);
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  ctx.font = "11px monospace, system-ui, sans-serif";
  ctx.letterSpacing = "0.5px";
  const idText = data.kind === "MATCH" ? `ID: #${data.ticketId}` : "SEASON PERFORMANCE LEDGER";
  ctx.fillText(idText, 36, footerY + 6);

  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.font = "10px system-ui, -apple-system, sans-serif";
  ctx.fillText("IMMUTABLE LEDGER VERIFIED · 18+", width - 230, footerY + 6);
}

function renderMatchContent(ctx: CanvasRenderingContext2D, data: Extract<VictoryCardData, { kind: "MATCH" }>, width: number) {
  // Competition Subtitle
  ctx.fillStyle = "#E10600";
  ctx.font = "800 12px system-ui, -apple-system, sans-serif";
  ctx.letterSpacing = "1.5px";
  ctx.fillText((data.competition || "MATCHDAY FIXTURE").toUpperCase(), 36, 110);

  // Teams (Title)
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "900 30px system-ui, -apple-system, sans-serif";
  ctx.letterSpacing = "-0.5px";
  const title = `${data.homeTeam} 对 ${data.awayTeam}`;
  ctx.fillText(title, 36, 150);

  // Outcome Banner
  const isWin = data.outcome === "WIN";
  const badgeColor = isWin ? "#00E599" : data.outcome === "PUSH" ? "#FFB800" : "#999999";
  const badgeLabel = isWin ? "🎯 预测命中 (WON)" : data.outcome === "PUSH" ? "🔄 走盘退回 (PUSH)" : "⏱️ 已结算 (SETTLED)";

  ctx.fillStyle = isWin ? "rgba(0, 229, 153, 0.15)" : "rgba(255, 255, 255, 0.08)";
  drawRoundedRect(ctx, 36, 175, 170, 32, 8);
  ctx.fill();
  ctx.strokeStyle = badgeColor;
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, 36, 175, 170, 32, 8);
  ctx.stroke();

  ctx.fillStyle = badgeColor;
  ctx.font = "bold 13px system-ui, -apple-system, sans-serif";
  ctx.letterSpacing = "0.5px";
  ctx.fillText(badgeLabel, 48, 196);

  // Main Highlight Box: Net Profit
  const boxY = 230;
  const boxHeight = 150;
  const boxGrad = ctx.createLinearGradient(36, boxY, width - 36, boxY + boxHeight);
  boxGrad.addColorStop(0, "rgba(255, 255, 255, 0.04)");
  boxGrad.addColorStop(1, "rgba(255, 255, 255, 0.01)");
  ctx.fillStyle = boxGrad;
  drawRoundedRect(ctx, 36, boxY, width - 72, boxHeight, 16);
  ctx.fill();
  ctx.strokeStyle = isWin ? "rgba(0, 229, 153, 0.3)" : "rgba(255, 255, 255, 0.1)";
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, 36, boxY, width - 72, boxHeight, 16);
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.font = "800 11px system-ui, -apple-system, sans-serif";
  ctx.letterSpacing = "1.5px";
  ctx.fillText("NET POINTS PROFIT / 净积分收益", 56, boxY + 36);

  ctx.fillStyle = isWin ? "#00E599" : "#FFFFFF";
  ctx.font = "900 46px system-ui, -apple-system, sans-serif";
  ctx.letterSpacing = "-1px";
  ctx.fillText(data.netPoints, 56, boxY + 95);

  // Key Facts Grid
  const gridY = 415;
  const colW = (width - 72) / 2;

  drawStatCell(ctx, 36, gridY, colW - 8, 75, "锁定选择", data.selection);
  drawStatCell(ctx, 36 + colW + 8, gridY, colW - 8, 75, "确认倍率", `@ ${data.odds}`);

  drawStatCell(ctx, 36, gridY + 90, colW - 8, 75, "投入积分", data.stakePoints);
  drawStatCell(ctx, 36 + colW + 8, gridY + 90, colW - 8, 75, "最终返还", data.grossReturnPoints);

  const qrSize = 82;
  const qrX = width - 36 - qrSize;
  const qrY = gridY + 185;
  const inviteLink = data.inviteUrl || "https://pulse.app";
  drawQrCode(ctx, qrX, qrY, qrSize, inviteLink);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 13px system-ui, -apple-system, sans-serif";
  ctx.fillText("扫码查验证据链与对局", 36, qrY + 28);

  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  ctx.font = "11px system-ui, -apple-system, sans-serif";
  ctx.fillText("PULSE 官方不可篡改账本已结算验证", 36, qrY + 48);

  if (data.roomName) {
    ctx.fillText(`来源房间：${data.roomName}`, 36, qrY + 66);
  }
}

function renderSeasonContent(ctx: CanvasRenderingContext2D, data: Extract<VictoryCardData, { kind: "SEASON" }>, width: number) {
  // Season Subtitle
  ctx.fillStyle = "#E10600";
  ctx.font = "800 12px system-ui, -apple-system, sans-serif";
  ctx.letterSpacing = "1.5px";
  ctx.fillText((data.seasonLabel ? `${data.seasonLabel} SEASON ARCHIVE` : "SEASON PERFORMANCE").toUpperCase(), 36, 110);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "900 30px system-ui, -apple-system, sans-serif";
  ctx.letterSpacing = "-0.5px";
  ctx.fillText("长期表现与胜率战报", 36, 150);

  // Main Highlight Box: Net Points
  const boxY = 180;
  const boxHeight = 155;
  const boxGrad = ctx.createLinearGradient(36, boxY, width - 36, boxY + boxHeight);
  boxGrad.addColorStop(0, "rgba(255, 255, 255, 0.05)");
  boxGrad.addColorStop(1, "rgba(255, 255, 255, 0.01)");
  ctx.fillStyle = boxGrad;
  drawRoundedRect(ctx, 36, boxY, width - 72, boxHeight, 16);
  ctx.fill();
  ctx.strokeStyle = "rgba(0, 229, 153, 0.35)";
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, 36, boxY, width - 72, boxHeight, 16);
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.font = "800 11px system-ui, -apple-system, sans-serif";
  ctx.letterSpacing = "1.5px";
  ctx.fillText("TOTAL NET POINTS / 累计净积分", 56, boxY + 36);

  ctx.fillStyle = "#00E599";
  ctx.font = "900 50px system-ui, -apple-system, sans-serif";
  ctx.letterSpacing = "-1px";
  ctx.fillText(data.netPoints, 56, boxY + 98);

  // Facts Grid (3 columns)
  const gridY = 365;
  const colW = (width - 72 - 24) / 3;

  drawStatCell(ctx, 36, gridY, colW, 85, "命中率", data.hitRate, "#00E599");
  drawStatCell(ctx, 36 + colW + 12, gridY, colW, 85, "已结算", String(data.settledTickets));
  drawStatCell(ctx, 36 + (colW + 12) * 2, gridY, colW, 85, "命中场次", `${data.wins} 场`);

  // Progress Bar for Hit Rate
  const rateNum = parseFloat(data.hitRate.replace("%", "")) || 0;
  const meterY = 485;
  const meterW = width - 72;
  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  drawRoundedRect(ctx, 36, meterY, meterW, 10, 5);
  ctx.fill();

  const filledW = Math.max(8, Math.min(meterW, (meterW * rateNum) / 100));
  const meterGrad = ctx.createLinearGradient(36, meterY, 36 + filledW, meterY);
  meterGrad.addColorStop(0, "#E10600");
  meterGrad.addColorStop(1, "#00E599");
  ctx.fillStyle = meterGrad;
  drawRoundedRect(ctx, 36, meterY, filledW, 10, 5);
  ctx.fill();

  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.font = "12px system-ui, -apple-system, sans-serif";
  ctx.fillText(`覆盖 ${data.coveredTickets} 笔判断 · 走盘/取消 ${data.voids} 场`, 36, meterY + 34);

  // Season QR Code
  const qrSize = 82;
  const qrX = width - 36 - qrSize;
  const qrY = 560;
  const inviteLink = data.inviteUrl || "https://pulse.app";
  drawQrCode(ctx, qrX, qrY, qrSize, inviteLink);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 13px system-ui, -apple-system, sans-serif";
  ctx.fillText("扫码查验个人长期战绩档案", 36, qrY + 30);

  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  ctx.font = "11px system-ui, -apple-system, sans-serif";
  ctx.fillText("基于真实缓存赛果与跨房间独立审计统计", 36, qrY + 52);
}

function drawQrCode(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, text: string) {
  try {
    const matrix = generateQrMatrix(text);
    const count = matrix.length;
    const padding = 6;
    const qrInnerSize = size - padding * 2;
    const cellSize = qrInnerSize / count;

    // Background white container
    ctx.fillStyle = "#FFFFFF";
    drawRoundedRect(ctx, x, y, size, size, 8);
    ctx.fill();

    // QR Modules
    ctx.fillStyle = "#0A0B0E";
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (matrix[r][c]) {
          ctx.fillRect(
            x + padding + c * cellSize,
            y + padding + r * cellSize,
            cellSize + 0.35,
            cellSize + 0.35
          );
        }
      }
    }

    // Centered brand dot
    const centerSize = Math.max(8, cellSize * 3);
    const centerX = x + size / 2 - centerSize / 2;
    const centerY = y + size / 2 - centerSize / 2;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(centerX - 1, centerY - 1, centerSize + 2, centerSize + 2);
    ctx.fillStyle = "#E10600";
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, centerSize / 2.2, 0, Math.PI * 2);
    ctx.fill();
  } catch {
    ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
    drawRoundedRect(ctx, x, y, size, size, 8);
    ctx.fill();
  }
}

function drawStatCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
  valueColor = "#FFFFFF",
) {
  ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
  drawRoundedRect(ctx, x, y, w, h, 12);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
  ctx.lineWidth = 1;
  drawRoundedRect(ctx, x, y, w, h, 12);
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  ctx.font = "bold 11px system-ui, -apple-system, sans-serif";
  ctx.fillText(label, x + 16, y + 26);

  ctx.fillStyle = valueColor;
  ctx.font = "bold 20px system-ui, -apple-system, sans-serif";
  ctx.fillText(value, x + 16, y + 56);
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export function exportCanvasAsBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}
