import type { StitchSettings } from '../types';

/** Edge-to-edge horizontal (or user-directed) floss with a cylindrical,
 * twisted multi-ply surface. Material coordinates belong to each whole strand,
 * so changing illumination never breaks it into short disconnected stitches. */
export function renderSatin(source: ImageData, settings: StitchSettings, detail = 1): HTMLCanvasElement {
  const { width: w, height: h, data } = source;
  // Geometry remains in source coordinates; only sampling density changes.
  // The worker uses the same 2D canvas surface without touching the DOM.
  detail = Math.max(1, Math.min(detail, 8, 8192 / w, 8192 / h, Math.sqrt(16_000_000 / (w * h))));
  const rw = Math.round(w * detail), rh = Math.round(h * detail);
  const scaleX = rw / w, scaleY = rh / h;
  const canvas = (typeof document === 'undefined'
    ? new OffscreenCanvas(rw, rh) : document.createElement('canvas')) as HTMLCanvasElement;
  canvas.width = rw; canvas.height = rh;
  const ctx = canvas.getContext('2d')!;
  const out = ctx.createImageData(rw, rh), pixels = out.data;
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const i = (y * rw + x) * 4;
    const si = (Math.min(h - 1, Math.floor((y + 0.5) / scaleY)) * w
      + Math.min(w - 1, Math.floor((x + 0.5) / scaleX))) * 4;
    pixels[i] = data[si] * 0.76; pixels[i + 1] = data[si + 1] * 0.76;
    pixels[i + 2] = data[si + 2] * 0.76; pixels[i + 3] = data[si + 3];
  }
  const angle = settings.angle * Math.PI / 180;
  const tx = Math.cos(angle), ty = Math.sin(angle), nx = -ty, ny = tx;
  // Enough pixels per bundle for the twist to survive the fitted preview.
  const thickness = 3.0 + settings.thickness * 0.65;
  const gap = thickness * (1.18 - settings.density * 0.042);
  const shine = settings.sheen / 100, radius = Math.hypot(w, h) / 2;
  const noise = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const at = (u: number, v: number) => {
    const x = Math.floor(w / 2 + u * tx + v * nx), y = Math.floor(h / 2 + u * ty + v * ny);
    if (x < 0 || y < 0 || x >= w || y >= h) return -1;
    const i = (y * w + x) * 4; return data[i + 3] > 32 ? i : -1;
  };
  const different = (a: number, b: number) =>
    (data[a] - data[b]) ** 2 + (data[a + 1] - data[b + 1]) ** 2 + (data[a + 2] - data[b + 2]) ** 2 > 2500;

  let row = 0;
  for (let v = -radius; v <= radius; v += gap, row++) {
    const vv = v + (noise(row) - 0.5) * gap * 0.22;
    let start = 0, first = -1;
    const strand = (end: number) => {
      if (first < 0 || end - start < 0.65) return;
      const length = end - start;
      const width = thickness * (0.88 + noise(row + 81) * 0.24);
      const phase = noise(row + 7) * Math.PI * 2;
      const pitch = width * (2.5 + noise(row + 13) * 0.7);
      const tint = 0.95 + noise(row + 121) * 0.10;
      const sx = w / 2 + start * tx + vv * nx, sy = h / 2 + start * ty + vv * ny;
      const ex = sx + length * tx, ey = sy + length * ty;
      const margin = width * 0.65 + 1;
      const minX = Math.max(0, Math.floor((Math.min(sx, ex) - margin) * scaleX));
      const maxX = Math.min(rw - 1, Math.ceil((Math.max(sx, ex) + margin) * scaleX));
      const minY = Math.max(0, Math.floor((Math.min(sy, ey) - margin) * scaleY));
      const maxY = Math.min(rh - 1, Math.ceil((Math.max(sy, ey) + margin) * scaleY));
      for (let y = minY; y <= maxY; y++) {
        // Intersect a scanline with the narrow oriented strand, avoiding the
        // quadratic bounding-box cost for long diagonal stitches.
        let left = minX, right = maxX;
        const clip = (a: number, b: number, low: number, high: number) => {
          if (Math.abs(a) < 1e-8) { if (b < low || b > high) right = left - 1; return; }
          const p = (low - b) / a, q = (high - b) / a;
          left = Math.max(left, Math.ceil(Math.min(p, q)));
          right = Math.min(right, Math.floor(Math.max(p, q)));
        };
        clip(tx / scaleX, (0.5 / scaleX - sx) * tx + ((y + 0.5) / scaleY - sy) * ty, 0, length);
        clip(nx / scaleX, (0.5 / scaleX - sx) * nx + ((y + 0.5) / scaleY - sy) * ny, -margin, margin);
        for (let x = left; x <= right; x++) {
        const oi = (y * rw + x) * 4;
        const i = (Math.min(h - 1, Math.floor((y + 0.5) / scaleY)) * w + Math.min(w - 1, Math.floor((x + 0.5) / scaleX))) * 4;
        if (data[i + 3] < 1) continue;
        const dx = (x + 0.5) / scaleX - sx, dy = (y + 0.5) / scaleY - sy;
        const u = dx * tx + dy * ty;
        if (u < 0 || u > length || different(first, i)) continue;
        // Straight overall rows, but soft surface variation prevents ruler-like grooves.
        const wander = Math.sin(u * 0.033 + phase) * width * 0.045;
        const localWidth = width * (1 + 0.055 * Math.sin(u * 0.08 + phase));
        const cross = dx * nx + dy * ny - wander;
        const q = cross / (localWidth * 0.5);
        const coverage = Math.min(1, Math.max(0, (localWidth * 0.5 - Math.abs(cross)) * detail + 0.5));
        if (coverage === 0) continue;
        const clamped = Math.max(-0.999, Math.min(0.999, q));
        const crown = Math.sqrt(1 - clamped * clamped);
        // Three plies wind around the bundle. Their diagonal ridges, rather than
        // a continuous white stripe, carry the highlight along the thread.
        const helix = u / pitch * Math.PI * 2 - Math.asin(clamped) * 3 + phase;
        const ply = Math.cos(helix);
        const ridge = Math.pow(Math.max(0, ply), 2);
        const valley = Math.pow(Math.max(0, -ply), 6);
        const filament = Math.sin(helix * 5 + u * 0.19) * 0.028
          + Math.sin(helix * 9 - u * 0.07) * 0.014;
        const softLight = 0.66 + 0.34 * crown - clamped * 0.045;
        const twist = 1 + ridge * 0.12 - valley * 0.14 + filament;
        const endDistance = Math.min(u, length - u);
        const insertion = 1 - 0.22 * Math.exp(-endDistance / 1.8);
        const body = 0.96 + 0.055 * Math.sin(Math.PI * u / length);
        const lit = softLight * twist * tint * insertion * body;
        const glint = (5 + shine * 25) * ridge * Math.pow(crown, 0.7) * insertion;
        for (let channel = 0; channel < 3; channel++) {
          const value = Math.min(255, data[i + channel] * lit + glint);
          pixels[oi + channel] = pixels[oi + channel] * (1 - coverage) + value * coverage;
        }
      }
      }
    };
    for (let u = -radius; u <= radius + 0.5; u += 0.5) {
      const i = at(u, vv);
      if (i < 0 || (first >= 0 && different(first, i))) { strand(u - 0.25); first = -1; }
      if (i >= 0 && first < 0) { start = u; first = i; }
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

