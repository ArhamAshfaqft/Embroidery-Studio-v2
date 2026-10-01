import type { StitchSettings } from '../src/types';
import { renderSatin } from './previous-satin';

/**
 * SimpleStitch — a small, focused embroidery renderer.
 * Only two real-world stitch styles: Tatami (woven fill) and Satin (glossy columns).
 * Lighting is fixed to a flattering default so the user never has to touch it.
 */

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** 2-pass chamfer distance on the alpha mask → edge distance in px */
function edgeDistance(alpha: Uint8ClampedArray, w: number, h: number): Float32Array {
  const n = w * h;
  const dist = new Float32Array(n);
  const INF = 1e6;
  for (let i = 0; i < n; i++) dist[i] = alpha[i * 4 + 3] > 24 ? INF : 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (dist[i] === 0) continue;
      let m = dist[i];
      const l = dist[i - 1] + 1, u = dist[i - w] + 1;
      const ul = dist[i - w - 1] + 1.414, ur = dist[i - w + 1] + 1.414;
      if (l < m) m = l; if (u < m) m = u; if (ul < m) m = ul; if (ur < m) m = ur;
      dist[i] = m;
    }
  }
  for (let y = h - 2; y > 0; y--) {
    for (let x = w - 2; x > 0; x--) {
      const i = y * w + x;
      if (dist[i] === 0) continue;
      let m = dist[i];
      const r = dist[i + 1] + 1, d = dist[i + w] + 1;
      const dr = dist[i + w + 1] + 1.414, dl = dist[i + w - 1] + 1.414;
      if (r < m) m = r; if (d < m) m = d; if (dr < m) m = dr; if (dl < m) m = dl;
      dist[i] = m;
    }
  }
  return dist;
}

/** Reduce to N thread colours via histogram buckets (fast, stable) */
function quantize(pixels: Uint8ClampedArray, w: number, h: number, maxColors: number): Uint8ClampedArray {
  if (!maxColors || maxColors <= 0) return pixels;
  const out = new Uint8ClampedArray(pixels);
  const hist = new Map<number, { r: number; g: number; b: number; count: number }>();
  const total = w * h;
  const step = Math.max(1, Math.floor(total / 40000));
  for (let i = 0; i < total; i += step) {
    const idx = i * 4;
    if (pixels[idx + 3] < 24) continue;
    const r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const e = hist.get(key);
    if (e) e.count++;
    else hist.set(key, { r, g, b, count: 1 });
  }
  if (!hist.size) return out;
  const sorted = [...hist.values()].sort((a, b) => b.count - a.count);
  const centroids: { r: number; g: number; b: number }[] = [];
  for (const b of sorted) {
    if (centroids.length >= maxColors) break;
    let distinct = true;
    for (const c of centroids) {
      const dr = b.r - c.r, dg = b.g - c.g, db = b.b - c.b;
      if (dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11 < 260) { distinct = false; break; }
    }
    if (distinct) centroids.push({ r: b.r, g: b.g, b: b.b });
  }
  if (!centroids.length) return out;
  const lut = new Map<number, { r: number; g: number; b: number }>();
  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    if (pixels[idx + 3] < 24) continue;
    const r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let m = lut.get(key);
    if (!m) {
      let best = Infinity; let bc = centroids[0];
      for (const c of centroids) {
        const dr = r - c.r, dg = g - c.g, db = b - c.b;
        const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
        if (d < best) { best = d; bc = c; }
      }
      m = bc; lut.set(key, m);
    }
    out[idx] = m.r; out[idx + 1] = m.g; out[idx + 2] = m.b;
  }
  return out;
}

export function renderStitch(
  source: HTMLImageElement | HTMLCanvasElement,
  s: StitchSettings
): HTMLCanvasElement {
  const natW = (source as HTMLImageElement).naturalWidth || source.width;
  const natH = (source as HTMLImageElement).naturalHeight || source.height;

  // Normalise to ~2000px: consistent thread geometry plus enough real pixels
  // that zooming to ~450% still shows rendered threads, not stretched pixels
  const scale = Math.min(2, 2000 / Math.max(natW, natH));
  const w = Math.max(2, Math.round(natW * scale));
  const h = Math.max(2, Math.round(natH * scale));

  const src = makeCanvas(w, h);
  const sctx = src.getContext('2d', { willReadFrequently: true })!;
  sctx.clearRect(0, 0, w, h);
  sctx.drawImage(source, 0, 0, w, h);
  const srcData = sctx.getImageData(0, 0, w, h);
  const px = srcData.data;

  let hasInk = false;
  for (let i = 3; i < px.length; i += 4) { if (px[i] > 10) { hasInk = true; break; } }
  if (!hasInk) return src;

  const painted = quantize(px, w, h, s.maxColors);
  if (s.type === 'satin') {
    return renderSatin(new ImageData(new Uint8ClampedArray(painted), w, h), s);
  }
  const dist = edgeDistance(px, w, h);

  const useBorder = s.border && s.borderWidth > 0;
  // Keep the slider's meaning constant as working resolution changes
  const borderPx = s.borderWidth * (Math.max(w, h) / 1000);

  // Shape-following direction field for satin threads.
  // Thread direction follows the distance-field gradient (across each shape
  // column, like real satin needle penetrations), smoothed so centrelines
  // don't fan, fading back to the global angle deep inside large shapes.
  const needFlow = s.type !== 'tatami' || useBorder;
  let flowAng: Float32Array | null = null;
  let flowConf: Float32Array | null = null;
  let flowW = 0, flowH = 0;
  if (needFlow) {
    flowW = Math.max(2, Math.ceil(w / 2));
    flowH = Math.max(2, Math.ceil(h / 2));
    let vx: Float32Array = new Float32Array(flowW * flowH);
    let vy: Float32Array = new Float32Array(flowW * flowH);
    let vw: Float32Array = new Float32Array(flowW * flowH);
    for (let fy = 0; fy < flowH; fy++) {
      for (let fx = 0; fx < flowW; fx++) {
        const x = Math.min(w - 1, fx * 2), y = Math.min(h - 1, fy * 2);
        const i = y * w + x;
        const d = dist[i];
        if (d <= 0 || d > 34) continue;
        const xm0 = Math.max(0, x - 2), xm1 = Math.min(w - 1, x + 2);
        const ym0 = Math.max(0, y - 2), ym1 = Math.min(h - 1, y + 2);
        const gx = (dist[y * w + xm1] - dist[y * w + xm0]) / Math.max(1, xm1 - xm0);
        const gy = (dist[ym1 * w + x] - dist[ym0 * w + x]) / Math.max(1, ym1 - ym0);
        if (gx * gx + gy * gy < 0.0144) continue;
        const a = Math.atan2(gy, gx);
        const conf = Math.max(0, 1 - d / 34);
        const li = fy * flowW + fx;
        vx[li] = Math.cos(2 * a) * conf;
        vy[li] = Math.sin(2 * a) * conf;
        vw[li] = conf;
      }
    }
    const blurSep = (src: Float32Array): Float32Array => {
      const R = 3;
      const tmp: Float32Array = new Float32Array(src.length);
      for (let y = 0; y < flowH; y++)
        for (let x = 0; x < flowW; x++) {
          let sum = 0, c = 0;
          for (let k = -R; k <= R; k++) {
            const xx = x + k;
            if (xx < 0 || xx >= flowW) continue;
            sum += src[y * flowW + xx]; c++;
          }
          tmp[y * flowW + x] = sum / c;
        }
      const dst: Float32Array = new Float32Array(src.length);
      for (let y = 0; y < flowH; y++)
        for (let x = 0; x < flowW; x++) {
          let sum = 0, c = 0;
          for (let k = -R; k <= R; k++) {
            const yy = y + k;
            if (yy < 0 || yy >= flowH) continue;
            sum += tmp[yy * flowW + x]; c++;
          }
          dst[y * flowW + x] = sum / c;
        }
      return dst;
    };
    vx = blurSep(vx); vy = blurSep(vy); vw = blurSep(vw);
    flowAng = new Float32Array(flowW * flowH);
    flowConf = new Float32Array(flowW * flowH);
    for (let i = 0; i < flowAng.length; i++) {
      flowAng[i] = 0.5 * Math.atan2(vy[i], vx[i]);
      flowConf[i] = Math.min(1, vw[i] * 1.6);
    }
  }
  const sampleFlow = (x: number, y: number): [number, number, number] => {
    if (!flowAng || !flowConf) return [cosA, sinA, 0];
    const ix = Math.min(flowW - 1, Math.max(0, Math.round((x / w) * (flowW - 1))));
    const iy = Math.min(flowH - 1, Math.max(0, Math.round((y / h) * (flowH - 1))));
    const li = iy * flowW + ix;
    return [Math.cos(flowAng[li]), Math.sin(flowAng[li]), flowConf[li]];
  };

  const out = makeCanvas(w, h);
  const octx = out.getContext('2d')!;
  const outImg = octx.createImageData(w, h);
  const op = outImg.data;

  // Fixed flattering light — no user control needed
  const lightAz = (135 * Math.PI) / 180;
  const lightEl = (52 * Math.PI) / 180;
  const lx = Math.cos(lightAz) * Math.cos(lightEl);
  const ly = Math.sin(lightAz) * Math.cos(lightEl);
  const lz = Math.sin(lightEl);

  const rad = (s.angle * Math.PI) / 180;
  const cosA = Math.cos(rad), sinA = Math.sin(rad);

  const thickF = 0.6 + (s.thickness / 10) * 0.9;      // 0.6 – 1.5
  const denseF = 0.5 + (s.density / 10) * 1.3;        // 0.5 – 1.8
  const sheenF = s.sheen / 100;                       // 0 – 1

  // Tatami: airy woven rows with brick stagger · Satin: tight glossy columns
  const tatamiGap = Math.max(2.0, Math.min(9.0, (5.4 * thickF) / denseF));
  const tatamiSeg = Math.max(5, 13 * thickF);
  const satinGap = Math.max(1.2, Math.min(5.2, (2.8 * thickF) / denseF));
  // Long unbroken strands: segmentation far apart so threads read edge-to-edge
  const satinSeg = Math.max(48, 90 * thickF);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const a = px[idx + 3];
      if (a < 24) { op[idx + 3] = 0; continue; }
      const d = dist[y * w + x];

      // Border band is a satin edge in EVERY mode — the toggle always does something
      const inBorderBand = useBorder && d <= borderPx;
      const isSatin = inBorderBand;

      let r = painted[idx], g = painted[idx + 1], b = painted[idx + 2];

      let nx = 0, ny = 0, nz = 1, ao = 1;
      // Per-pixel thread direction (satin may follow the shape; tatami stays global)
      let tX = cosA, tY = sinA;
      // Fibre groove strength + sheen width (satin gets visible filaments + soft highlights)
      let fibreAmp = 0.05, fibreFine = 0;
      let sheenPow = 10;

      if (isSatin) {
        if (needFlow) {
          // Shape-following satin: blend the global angle toward the local
          // outline direction. Border bands follow the outline fully —
          // except in pure Satin mode, which stays uniform (no outline seam).
          const f = sampleFlow(x, y);
          let ax = f[0], ay = f[1];
          if (ax * cosA + ay * sinA < 0) { ax = -ax; ay = -ay; }
          const k = inBorderBand ? 1 : Math.min(1, f[2]) * 0.9;
          const bx = cosA * (1 - k) + ax * k;
          const by = sinA * (1 - k) + ay * k;
          const bl = Math.sqrt(bx * bx + by * by) || 1;
          tX = bx / bl; tY = by / bl;
        }
        fibreAmp = 0.1; fibreFine = 0.035;
        sheenPow = 6.5;
        // Satin columns run ALONG the (possibly shape-following) thread direction
        const perpX = -tY, perpY = tX;
        const row = x * perpX + y * perpY;
        const gap = satinGap;
        // Slight natural variation in spacing per thread (deterministic)
        const rowIndex = Math.floor(row / gap);
        const h1 = Math.abs(Math.sin(rowIndex * 12.9898) * 43758.5453) % 1;
        const mod = (((row + (h1 - 0.5) * gap * 0.35) % gap) + gap) % gap;
        const t = (mod / gap) * 2 - 1;
        // Rounded raised strand, slight thickness variation per thread
        const crown = Math.sqrt(Math.max(0, 1 - t * t)) * (0.94 + h1 * 0.12);
        nx = t * perpX * 0.9;
        ny = t * perpY * 0.9;
        nz = Math.max(0.3, crown * (0.9 + sheenF * 0.7));
        const crevice = Math.pow(Math.abs(t), 2.6) * (0.28 + sheenF * 0.1);
        ao = Math.max(0.45, 1 - crevice);
        // faint needle dips only — strands stay visually continuous edge to edge
        const along = x * tX + y * tY;
        const segM = ((along % satinSeg) + satinSeg) % satinSeg;
        const segT = (segM / satinSeg) * 2 - 1;
        ao *= 1 - Math.pow(Math.abs(segT), 6) * 0.07;
      } else {
        // Tatami brick weave: staggered rows
        const perpX = -sinA, perpY = cosA;
        const rowCoord = x * perpX + y * perpY;
        const rowI = Math.floor(rowCoord / tatamiGap);
        const rowMod = ((rowCoord % tatamiGap) + tatamiGap) % tatamiGap;
        const rowT = (rowMod / tatamiGap) * 2 - 1;
        const stagger = (Math.abs(rowI) % 3) * (tatamiSeg / 3);
        const along = x * cosA + y * sinA + stagger;
        const segM = ((along % tatamiSeg) + tatamiSeg) % tatamiSeg;
        const segT = (segM / tatamiSeg) * 2 - 1;
        const rowProfile = Math.max(0, 1 - Math.pow(Math.abs(rowT), 1.7));
        const segProfile = Math.max(0, 1 - Math.pow(Math.abs(segT), 2.6));
        const height = (0.3 + 0.7 * rowProfile) * (0.35 + 0.65 * segProfile);
        nx = (rowT * perpX * 0.6 + segT * cosA * 0.5) * 0.8;
        ny = (rowT * perpY * 0.6 + segT * sinA * 0.5) * 0.8;
        nz = Math.max(0.28, height * 1.05);
        const crevice = Math.pow(Math.abs(rowT), 3) * 0.3 + Math.pow(Math.abs(segT), 4) * 0.22;
        ao = Math.max(0.4, 1 - crevice);
      }

      // Twist fibre ripple (follows local thread direction; satin adds fine filaments)
      const fph = (x * tX + y * tY) * 1.4;
      const fibre = Math.sin(fph) * fibreAmp + Math.sin(fph * 5.3 + 1.2) * fibreFine;
      nx += fibre * -tY; ny += fibre * tX;

      // Raised edge bevel
      const edgeF = Math.min(1, d / 3.5);
      nz *= 0.35 + 0.65 * edgeF;

      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= len; ny /= len; nz /= len;

      const nDotL = Math.max(0, nx * lx + ny * ly + nz * lz);
      const diffuse = 0.52 + 0.48 * nDotL;
      // Anisotropic sheen along local thread direction (satin: softer, broader)
      const tDotL = tX * lx + tY * ly;
      const sheen = Math.pow(Math.max(0, Math.sqrt(Math.max(0, 1 - tDotL * tDotL))), sheenPow) * (0.15 + sheenF * 0.85);
      const lit = diffuse * (1 + sheen * 0.55) * ao;

      op[idx] = Math.min(255, r * lit + sheen * sheenF * 22);
      op[idx + 1] = Math.min(255, g * lit + sheen * sheenF * 22);
      op[idx + 2] = Math.min(255, b * lit + sheen * sheenF * 22);
      op[idx + 3] = a;
    }
  }
  octx.putImageData(outImg, 0, 0);

  // Soft contact shadow on transparency
  const fin = makeCanvas(w, h);
  const fctx = fin.getContext('2d')!;
  fctx.save();
  fctx.shadowColor = 'rgba(0,0,0,0.35)';
  fctx.shadowBlur = 6;
  fctx.shadowOffsetY = 3;
  fctx.drawImage(out, 0, 0);
  fctx.restore();
  fctx.drawImage(out, 0, 0);
  return fin;
}

