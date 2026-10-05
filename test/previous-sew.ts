/**
 * sew.ts — realistic "sewn into fabric" compositing (simplified V1 technique).
 *
 * Three effects stop the sticker look:
 *  1. Wrinkle wrap  — stitches bend over garment folds (luminance-gradient displacement)
 *  2. Fabric shading — thread takes on the garment's local light + weave texture
 *  3. Contact shadow — tight darkening where thread meets cloth (no floating drop shadow)
 *
 * All options are 0–100. At 0/0/0 the design is pasted sharp with zero
 * resampling loss (true sticker) — only the shadow slider adds anything.
 */

export interface SewPlacement {
  x: number; // percent of canvas width
  y: number; // percent of canvas height
  scale: number; // stitch width as fraction of canvas width
  rotation: number; // degrees
}

export interface SewOptions {
  sewIn: number; // 0 = sticker, 100 = fully takes on fabric light/texture
  wrap: number; // 0 = flat, 100 = bends hard over wrinkles
  shadow: number; // contact shadow strength
}

export const DEFAULT_SEW: SewOptions = { sewIn: 15, wrap: 10, shadow: 20 };

function lum(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Smooth bilinear sample of the stitch layer (sharp, no nearest-neighbour crunch) */
function makeSampler(sData: Uint8ClampedArray, sw: number, sh: number) {
  return (u: number, v: number): [number, number, number, number] => {
    const fx = Math.min(sw - 1.001, Math.max(0, u * (sw - 1)));
    const fy = Math.min(sh - 1.001, Math.max(0, v * (sh - 1)));
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
    const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4;
    const i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
    const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
    return [
      sData[i00] * w00 + sData[i10] * w10 + sData[i01] * w01 + sData[i11] * w11,
      sData[i00 + 1] * w00 + sData[i10 + 1] * w10 + sData[i01 + 1] * w01 + sData[i11 + 1] * w11,
      sData[i00 + 2] * w00 + sData[i10 + 2] * w10 + sData[i01 + 2] * w01 + sData[i11 + 2] * w11,
      (sData[i00 + 3] * w00 + sData[i10 + 3] * w10 + sData[i01 + 3] * w01 + sData[i11 + 3] * w11) / 255
    ];
  };
}

export function sewOntoGarment(
  garment: HTMLImageElement,
  stitch: HTMLCanvasElement,
  W: number,
  H: number,
  p: SewPlacement,
  o: SewOptions
): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d', { willReadFrequently: true })!;

  // Garment cover-fit
  const gRatio = garment.width / garment.height;
  let dw = W, dh = W / gRatio;
  if (dh < H) { dh = H; dw = H * gRatio; }
  ctx.fillStyle = '#e9e5de';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(garment, (W - dw) / 2, (H - dh) / 2, dw, dh);

  const ew = W * p.scale;
  const eh = ew * (stitch.height / stitch.width);
  const cx = (p.x / 100) * W, cy = (p.y / 100) * H;
  const rot = (p.rotation * Math.PI) / 180;

  // ---- TRUE ZERO PATH: all effects off → crisp direct paste, zero resampling loss ----
  if (o.sewIn <= 0 && o.wrap <= 0) {
    if (o.shadow > 0) {
      // tight contact rim: blurred black silhouette UNDER the stitch
      const sil = document.createElement('canvas');
      sil.width = Math.max(2, Math.round(ew)); sil.height = Math.max(2, Math.round(eh));
      const sctx = sil.getContext('2d')!;
      sctx.drawImage(stitch, 0, 0, sil.width, sil.height);
      sctx.globalCompositeOperation = 'source-in';
      sctx.fillStyle = '#000';
      sctx.fillRect(0, 0, sil.width, sil.height);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.globalAlpha = 0.45 * (o.shadow / 100);
      try { (ctx as CanvasRenderingContext2D & { filter: string }).filter = `blur(${Math.max(2, ew * 0.02)}px)`; } catch { /* noop */ }
      const off = ew * 0.012;
      ctx.drawImage(sil, -ew / 2 + off, -eh / 2 + off * 1.4, ew, eh);
      ctx.restore();
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(stitch, -ew / 2, -eh / 2, ew, eh);
    ctx.restore();
    return out;
  }

  // ---- FULL SEW PATH ----
  const gImg = ctx.getImageData(0, 0, W, H);
  const g = gImg.data;

  // Luminance field + blurred field (weave vs fold separation)
  const N = W * H;
  const L = new Float32Array(N);
  for (let i = 0; i < N; i++) L[i] = lum(g[i * 4], g[i * 4 + 1], g[i * 4 + 2]);
  const B = new Float32Array(N);
  const R = 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0, c = 0;
      for (let dy = -R; dy <= R; dy += 2) {
        const yy = Math.min(H - 1, Math.max(0, y + dy));
        for (let dx = -R; dx <= R; dx += 2) {
          s += L[yy * W + Math.min(W - 1, Math.max(0, x + dx))]; c++;
        }
      }
      B[y * W + x] = s / c;
    }
  }

  // Stitch layer pixels
  const sw = stitch.width, sh = stitch.height;
  const sctx = document.createElement('canvas');
  sctx.width = sw; sctx.height = sh;
  const s2d = sctx.getContext('2d', { willReadFrequently: true })!;
  s2d.drawImage(stitch, 0, 0);
  const sData = s2d.getImageData(0, 0, sw, sh).data;
  const sampleStitch = makeSampler(sData, sw, sh);

  const cos = Math.cos(rot), sin = Math.sin(rot);
  const sewF = o.sewIn / 100, wrapF = o.wrap / 100;

  // bounding box of rotated rect
  const hw = ew / 2, hh = eh / 2;
  const bx = Math.ceil(Math.abs(hw * cos) + Math.abs(hh * sin)) + 8;
  const by = Math.ceil(Math.abs(hw * sin) + Math.abs(hh * cos)) + 8;
  const x0 = Math.max(0, Math.floor(cx - bx)), x1 = Math.min(W - 1, Math.ceil(cx + bx));
  const y0 = Math.max(0, Math.floor(cy - by)), y1 = Math.min(H - 1, Math.ceil(cy + by));

  // ambient light = median luminance under the design footprint
  const samples: number[] = [];
  for (let y = y0; y <= y1; y += 4)
    for (let x = x0; x <= x1; x += 4) {
      const dx = x - cx, dy = y - cy;
      const lx = (dx * cos + dy * sin) / ew + 0.5;
      const ly = (-dx * sin + dy * cos) / eh + 0.5;
      if (lx >= 0 && lx < 1 && ly >= 0 && ly < 1) samples.push(L[y * W + x]);
    }
  samples.sort((a, b) => a - b);
  const ambient = samples[Math.floor(samples.length * 0.55)] || 128;

  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;

  // first pass: stitch coverage (with wrap displacement; zero wrap = zero bend)
  const warpMax = 8 * wrapF;
  const cover = new Float32Array(bw * bh);
  const sPix = new Float32Array(bw * bh * 4);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const li = (y - y0) * bw + (x - x0);
      const gi = y * W + x;
      let wx = x, wy = y;
      if (warpMax > 0) {
        const rS = 4;
        const xm0 = Math.max(0, x - rS), xm1 = Math.min(W - 1, x + rS);
        const ym0 = Math.max(0, y - rS), ym1 = Math.min(H - 1, y + rS);
        let gx = (B[y * W + xm1] - B[y * W + xm0]) / Math.max(1, xm1 - xm0);
        let gy = (B[ym1 * W + x] - B[ym0 * W + x]) / Math.max(1, ym1 - ym0);
        // ignore printed-graphics edges: only smooth shading bends threads
        const edgeGate = Math.exp(-Math.abs(L[gi] - B[gi]) / 28);
        gx *= edgeGate; gy *= edgeGate;
        wx = x + gx * warpMax * 2.2;
        wy = y + gy * warpMax * 2.2;
      }
      const dx = wx - cx, dy = wy - cy;
      const u = (dx * cos + dy * sin) / ew + 0.5;
      const v = (-dx * sin + dy * cos) / eh + 0.5;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      const [r, gg, b, a] = sampleStitch(u, v);
      if (a < 0.04) continue;
      cover[li] = a;
      sPix[li * 4] = r; sPix[li * 4 + 1] = gg; sPix[li * 4 + 2] = b; sPix[li * 4 + 3] = a;
    }
  }
  // halo = blurred cover (contact shadow zone around AND just inside thread edges)
  const halo = new Float32Array(bw * bh);
  const HR = 3;
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      let s = 0, c = 0;
      for (let dy = -HR; dy <= HR; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= bh) continue;
        for (let dx = -HR; dx <= HR; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= bw) continue;
          s += cover[yy * bw + xx]; c++;
        }
      }
      halo[y * bw + x] = s / c;
    }

  // second pass: composite — at sewIn 0 this loop is skipped (handled above),
  // so shade/weave here always scale cleanly 0 → full with the slider
  const outImg = ctx.getImageData(0, 0, W, H);
  const od = outImg.data;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const li = (y - y0) * bw + (x - x0);
      const gi = (y * W + x) * 4;
      const a = cover[li];
      const Lhere = L[y * W + x];
      if (a > 0.01) {
        const lightRatio = Lhere / Math.max(1, ambient);
        const clamped = Math.max(0.55, Math.min(1.45, lightRatio));
        const shade = 1 + (clamped - 1) * sewF;
        const weave = (Lhere - B[y * W + x]) * 0.35 * sewF;
        let sr = Math.max(0, Math.min(255, sPix[li * 4] * shade + weave));
        let sg = Math.max(0, Math.min(255, sPix[li * 4 + 1] * shade + weave));
        let sb = Math.max(0, Math.min(255, sPix[li * 4 + 2] * shade + weave));
        // inner contact seating: threads darken slightly right at the cloth edge
        // so the design rim visibly sits INTO the fabric at any zoom level
        if (o.shadow > 0 && halo[li] < 0.85) {
          const rim = (0.85 - halo[li]) * (o.shadow / 100) * 0.55;
          sr *= 1 - rim; sg *= 1 - rim; sb *= 1 - rim;
        }
        const sa = sPix[li * 4 + 3];
        od[gi] = sr * sa + od[gi] * (1 - sa);
        od[gi + 1] = sg * sa + od[gi + 1] * (1 - sa);
        od[gi + 2] = sb * sa + od[gi + 2] * (1 - sa);
      } else if (halo[li] > 0.01 && o.shadow > 0) {
        // outer contact darkening hugging the threads — wider + stronger now
        const k = Math.min(0.6, halo[li] * (o.shadow / 100) * 0.85);
        od[gi] *= 1 - k; od[gi + 1] *= 1 - k; od[gi + 2] *= 1 - k;
      }
    }
  }
  ctx.putImageData(outImg, 0, 0);
  return out;
}
