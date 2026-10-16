/** Icone SDF disegnate su canvas, cosi' MapLibre puo' colorarle in base al ritardo. */
const SIZE = 48;

function draw(fn: (ctx: CanvasRenderingContext2D) => void): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  fn(ctx);
  return ctx.getImageData(0, 0, SIZE, SIZE);
}

function arrowPath(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.moveTo(24, 5);
  ctx.lineTo(38, 40);
  ctx.lineTo(24, 32);
  ctx.lineTo(10, 40);
  ctx.closePath();
}

export function trainIcons(): Record<string, ImageData> {
  return {
    // Posizione rilevata: freccia piena
    "train-reported": draw((ctx) => {
      arrowPath(ctx);
      ctx.fillStyle = "#000";
      ctx.fill();
    }),
    // Posizione stimata: freccia solo contorno
    "train-estimated": draw((ctx) => {
      arrowPath(ctx);
      ctx.lineWidth = 5;
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#000";
      ctx.stroke();
    }),
    // Direzione sconosciuta
    "train-dot": draw((ctx) => {
      ctx.beginPath();
      ctx.arc(24, 24, 10, 0, Math.PI * 2);
      ctx.fillStyle = "#000";
      ctx.fill();
    }),
    "train-dot-estimated": draw((ctx) => {
      ctx.beginPath();
      ctx.arc(24, 24, 9, 0, Math.PI * 2);
      ctx.lineWidth = 5;
      ctx.strokeStyle = "#000";
      ctx.stroke();
    }),
  };
}
