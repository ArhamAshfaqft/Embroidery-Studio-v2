import type { StitchSettings } from '../types';

/** Continuous surface-satin strands. Each row is intersected with the artwork;
 * holes and colour boundaries end a strand rather than receiving a texture.
 * A single, coherent row coordinate avoids the seams caused by substituting a
 * different angle at every pixel in a periodic shader. These are preview paths.
 */
export function renderSatin(source: ImageData, settings: StitchSettings): HTMLCanvasElement {
  const { width: w, height: h, data } = source;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const mask = document.createElement('canvas');
  mask.width = w; mask.height = h;
  mask.getContext('2d')!.putImageData(source, 0, 0);
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = 'rgba(0,0,0,0.24)';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';

  const angle = settings.angle * Math.PI / 180;
  const tx = Math.cos(angle), ty = Math.sin(angle);
  const nx = -ty, ny = tx;
  const thickness = 1.25 + settings.thickness * 0.28;
  const gap = thickness * (1.28 - settings.density * 0.047);
  const shine = settings.sheen / 100;
  const radius = Math.hypot(w, h) / 2;
  const noise = (n: number) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const at = (u: number, v: number) => {
    const x = Math.floor(w / 2 + u * tx + v * nx);
    const y = Math.floor(h / 2 + u * ty + v * ny);
    if (x < 0 || y < 0 || x >= w || y >= h) return -1;
    const i = (y * w + x) * 4;
    return data[i + 3] > 32 ? i : -1;
  };
  const different = (a: number, b: number) =>
    (data[a] - data[b]) ** 2 + (data[a + 1] - data[b + 1]) ** 2 + (data[a + 2] - data[b + 2]) ** 2 > 2500;

  let row = 0;
  for (let v = -radius; v <= radius; v += gap, row++) {
    const vv = v + (noise(row) - 0.5) * gap * 0.15;
    let start = 0, first = -1;
    const strand = (end: number) => {
      if (first < 0 || end - start < 0.65) return;
      const mid = at((start + end) / 2, vv);
      const color = mid < 0 ? first : mid;
      const width = thickness * (0.94 + noise(row + 81) * 0.12);
      const length = end - start;
      const x = w / 2 + start * tx + vv * nx;
      const y = h / 2 + start * ty + vv * ny;
      ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
      const tint = (factor: number, lift = 0) =>
        `rgb(${Math.min(255, data[color] * factor + lift)},${Math.min(255, data[color + 1] * factor + lift)},${Math.min(255, data[color + 2] * factor + lift)})`;
      const gradient = ctx.createLinearGradient(0, -width / 2, 0, width / 2);
      gradient.addColorStop(0, tint(0.58));
      gradient.addColorStop(0.22, tint(0.95));
      gradient.addColorStop(0.43, tint(1.04, 8 + shine * 24));
      gradient.addColorStop(0.68, tint(0.98, shine * 8));
      gradient.addColorStop(1, tint(0.60));
      // Keep strand centrelines straight; fine fibres supply the natural texture.
      const bow = 0;
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.bezierCurveTo(length / 3, bow, length * 2 / 3, bow, length, 0);
      ctx.lineCap = 'round'; ctx.lineWidth = width;
      ctx.strokeStyle = gradient; ctx.stroke();
      const seating = ctx.createLinearGradient(0, 0, length, 0);
      seating.addColorStop(0, 'rgba(0,0,0,0.24)');
      seating.addColorStop(0.10, 'rgba(0,0,0,0)');
      seating.addColorStop(0.48, `rgba(255,255,238,${0.04 + shine * 0.09})`);
      seating.addColorStop(0.9, 'rgba(0,0,0,0)');
      seating.addColorStop(1, 'rgba(0,0,0,0.24)');
      ctx.strokeStyle = seating; ctx.stroke();
      // Helical fibre glints travel along the same strand, with restrained contrast.
      for (let ply = 0; ply < 3; ply++) {
        ctx.beginPath();
        for (let u = 0; u <= length; u += 0.8) {
          const t = u / length;
          const bend = 3 * t * (1 - t) * bow;
          const fy = bend + Math.sin(u * 0.55 + ply * Math.PI * 2 / 3 + noise(row) * 6) * width * 0.28;
          if (u === 0) ctx.moveTo(u, fy); else ctx.lineTo(u, fy);
        }
        ctx.lineWidth = 0.30;
        ctx.strokeStyle = `rgba(255,255,240,${0.10 + shine * 0.12})`; ctx.stroke();
      }
      ctx.restore();
    };
    for (let u = -radius; u <= radius + 0.5; u += 0.5) {
      const i = at(u, vv);
      if (i < 0 || (first >= 0 && different(first, i))) {
        strand(u - 0.25); first = -1;
      }
      if (i >= 0 && first < 0) { start = u; first = i; }
    }
  }
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}
