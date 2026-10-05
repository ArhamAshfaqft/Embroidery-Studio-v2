/** Fabric compositing: antialiased placement, broad fold wrapping and restrained lighting. */
export interface SewPlacement {
  x: number; y: number; scale: number; rotation: number;
}
export interface SewOptions { sewIn: number; wrap: number; shadow: number }
export const DEFAULT_SEW: SewOptions = { sewIn: 15, wrap: 10, shadow: 20 };

function canvas(w: number, h: number) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
function blur(src: Float32Array, w: number, h: number, radius: number) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const r = Math.max(1, Math.round(radius)), span = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[y * w + Math.max(0, Math.min(w - 1, k))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / span;
      sum += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[Math.max(0, Math.min(h - 1, k)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / span;
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}
function field(data: Float32Array, w: number, h: number, x: number, y: number) {
  x = Math.max(0, Math.min(w - 1, x)); y = Math.max(0, Math.min(h - 1, y));
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const nx = Math.min(w - 1, ix + 1), ny = Math.min(h - 1, iy + 1);
  return (data[iy * w + ix] * (1 - fx) + data[iy * w + nx] * fx) * (1 - fy)
    + (data[ny * w + ix] * (1 - fx) + data[ny * w + nx] * fx) * fy;
}
export function sewOntoGarment(garment: HTMLImageElement, stitch: HTMLCanvasElement,
  W: number, H: number, p: SewPlacement, o: SewOptions): HTMLCanvasElement {
  const out = canvas(W, H), ctx = out.getContext('2d', { willReadFrequently: true })!;
  const ratio = (garment.naturalWidth || garment.width) / (garment.naturalHeight || garment.height);
  let dw = W, dh = W / ratio;
  if (dh < H) { dh = H; dw = H * ratio; }
  ctx.fillStyle = '#e9e5de'; ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingQuality = 'high'; ctx.drawImage(garment, (W - dw) / 2, (H - dh) / 2, dw, dh);
  const ew = W * p.scale, eh = ew * stitch.height / stitch.width;
  if (!(ew > 0 && eh > 0)) return out;
  const cx = W * p.x / 100, cy = H * p.y / 100, rot = p.rotation * Math.PI / 180;
  const wrap = Math.max(0, Math.min(1, o.wrap / 100));
  const shadeStrength = Math.max(0, Math.min(1, o.sewIn / 100));
  const shadow = Math.max(0, Math.min(1, o.shadow / 100));
  // Bounded displacement scales with the design, not photo noise or output pixels.
  const maxWarp = Math.min(ew, eh) * 0.06 * wrap;
  const shadowRadius = Math.max(1, W / 700);
  const padding = Math.ceil(maxWarp + shadowRadius * 3 + 3);
  const bx = (Math.abs(ew * Math.cos(rot)) + Math.abs(eh * Math.sin(rot))) / 2;
  const by = (Math.abs(ew * Math.sin(rot)) + Math.abs(eh * Math.cos(rot))) / 2;
  const x0 = Math.max(0, Math.floor(cx - bx - padding)), y0 = Math.max(0, Math.floor(cy - by - padding));
  const x1 = Math.min(W, Math.ceil(cx + bx + padding)), y1 = Math.min(H, Math.ceil(cy + by + padding));
  const bw = x1 - x0, bh = y1 - y0;
  if (bw <= 0 || bh <= 0) return out;

  // Canvas high-quality minification integrates the fine threads before warping.
  // The old four-source-pixel sample aliased badly at small chest-logo sizes.
  const placed = canvas(bw, bh), pc = placed.getContext('2d', { willReadFrequently: true })!;
  pc.translate(cx - x0, cy - y0); pc.rotate(rot); pc.imageSmoothingQuality = 'high';
  pc.drawImage(stitch, -ew / 2, -eh / 2, ew, eh);
  const pixels = pc.getImageData(0, 0, bw, bh).data;

  // Low-resolution, twice-smoothed luminance rejects fabric weave and camera noise.
  // Same physical fold field at every output size; no per-thread displacement.
  const fw = 320, fh = Math.max(2, Math.round(320 * H / W));
  const fc = canvas(fw, fh).getContext('2d', { willReadFrequently: true })!;
  fc.imageSmoothingQuality = 'high'; fc.drawImage(out, 0, 0, fw, fh);
  const fp = fc.getImageData(0, 0, fw, fh).data, light = new Float32Array(fw * fh);
  for (let i = 0; i < light.length; i++) light[i] = fp[i * 4] * 0.299 + fp[i * 4 + 1] * 0.587 + fp[i * 4 + 2] * 0.114;
  const folds = blur(blur(light, fw, fh, 2), fw, fh, 2);
  const read = (x: number, y: number) => field(folds, fw, fh, x, y);
  let ambient = 0, weight = 0;
  for (let y = 0; y < bh; y += 4) for (let x = 0; x < bw; x += 4) {
    const a = pixels[(y * bw + x) * 4 + 3] / 255;
    ambient += read((x + x0 + 0.5) * fw / W - 0.5, (y + y0 + 0.5) * fh / H - 0.5) * a; weight += a;
  }
  ambient = weight ? ambient / weight : 128;
  const cover = new Float32Array(bw * bh), rgb = new Float32Array(bw * bh * 3);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const i = y * bw + x;
    const gx = (x + x0 + 0.5) * fw / W - 0.5, gy = (y + y0 + 0.5) * fh / H - 0.5;
    const sx = x + maxWarp * Math.tanh((read(gx + 3, gy) - read(gx - 3, gy)) / 12);
    const sy = y + maxWarp * Math.tanh((read(gx, gy + 3) - read(gx, gy - 3)) / 12);
    const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
    // Premultiplied interpolation prevents dark fringes beside transparent holes.
    let a = 0, r = 0, g = 0, b = 0;
    for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) {
      const px = ix + xx, py = iy + yy;
      if (px < 0 || py < 0 || px >= bw || py >= bh) continue;
      const j = (py * bw + px) * 4;
      const q = (xx ? fx : 1 - fx) * (yy ? fy : 1 - fy) * pixels[j + 3] / 255;
      a += q; r += pixels[j] * q; g += pixels[j + 1] * q; b += pixels[j + 2] * q;
    }
    cover[i] = a;
    // Local contrast models folds; a restrained exposure term also seats bright
    // thread on evenly lit cloth, where local-mean normalization cancelled it out.
    const illumination = read(gx, gy);
    const exposure = -0.35 * (1 - illumination / 255);
    const shade = 1 + Math.max(-0.55, Math.min(0.35, exposure + 4 * (illumination - ambient) / Math.max(60, ambient))) * shadeStrength;
    rgb[i * 3] = r * shade; rgb[i * 3 + 1] = g * shade; rgb[i * 3 + 2] = b * shade;
  }
  const halo = shadow ? blur(cover, bw, bh, shadowRadius) : cover;
  const result = ctx.getImageData(x0, y0, bw, bh), dest = result.data;
  for (let i = 0; i < cover.length; i++) {
    const a = cover[i], contact = 1 - halo[i] * shadow * 0.7;
    // Seat the inner edge too: an outer-only shadow disappeared under opaque ink.
    const rim = 1 - Math.max(0, a - halo[i]) * shadow * 0.35;
    for (let c = 0; c < 3; c++) dest[i * 4 + c] = Math.min(255 * a, rgb[i * 3 + c]) * rim + dest[i * 4 + c] * contact * (1 - a);
  }
  ctx.putImageData(result, x0, y0);
  return out;
}
