import type { StitchSettings } from '../types';

/** Raised edge binding, inset into the silhouette so export dimensions and
 * placement do not move. Internal colour boundaries are never outlined. */
export function applyArtworkOutline(canvas: HTMLCanvasElement, source: ImageData, settings: StitchSettings) {
  if (!settings.outline) return canvas;
  const { width: w, height: h, data } = source;
  const n = w * h;
  const ink = new Uint8Array(n), outside = new Uint8Array(n);
  for (let p = 0; p < n; p++) ink[p] = data[p * 4 + 3] > 32 ? 1 : 0;
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  const enqueue = (p: number) => {
    if (!ink[p] && !outside[p]) { outside[p] = 1; queue[tail++] = p; }
  };
  for (let x = 0; x < w; x++) { enqueue(x); enqueue((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { enqueue(y * w); enqueue(y * w + w - 1); }
  while (head < tail) {
    const p = queue[head++], x = p % w, y = Math.floor(p / w);
    if (x) enqueue(p - 1); if (x < w - 1) enqueue(p + 1);
    if (y) enqueue(p - w); if (y < h - 1) enqueue(p + w);
  }
  if (settings.outlineHoles !== false) for (let p = 0; p < n; p++) outside[p] = ink[p] ? 0 : 1;

  const dist = new Float32Array(n); dist.fill(1e6);
  const nearest = new Int32Array(n); nearest.fill(-1);
  const phase = new Float32Array(n);
  type Edge = { a: number; b: number; p: number; dir: number };
  const edges: Edge[] = [], starts = new Map<number, number[]>();
  const add = (a: number, b: number, p: number, dir: number) => {
    const id = edges.length; edges.push({ a, b, p, dir });
    const list = starts.get(a); if (list) list.push(id); else starts.set(a, [id]);
    dist[p] = 0.5; nearest[p] = p;
  };
  const stride = w + 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x; if (!ink[p]) continue;
    const v = y * stride + x;
    if (!y || outside[p - w]) add(v, v + 1, p, 0);
    if (x === w - 1 || outside[p + 1]) add(v + 1, v + stride + 1, p, 1);
    if (y === h - 1 || outside[p + w]) add(v + stride + 1, v + stride, p, 2);
    if (!x || outside[p - 1]) add(v + stride, v, p, 3);
  }
  // Contour arclength keeps the short binding stitches continuous around bends.
  const seen = new Uint8Array(edges.length);
  for (let first = 0; first < edges.length; first++) {
    if (seen[first]) continue;
    let id = first, length = 0;
    while (!seen[id]) {
      seen[id] = 1; const edge = edges[id]; phase[edge.p] = length++;
      const options = (starts.get(edge.b) ?? []).filter(i => !seen[i]);
      if (!options.length) break;
      // At diagonal contacts, follow the right turn to keep separate contours.
      options.sort((a, b) => ((edges[a].dir - edge.dir + 3) % 4) - ((edges[b].dir - edge.dir + 3) % 4));
      id = options[0];
    }
  }
  const update = (p: number, q: number, cost: number) => {
    if (nearest[q] >= 0 && dist[q] + cost < dist[p]) { dist[p] = dist[q] + cost; nearest[p] = nearest[q]; }
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (x) update(p, p - 1, 1); if (y) update(p, p - w, 1);
    if (x && y) update(p, p - w - 1, Math.SQRT2);
    if (x < w - 1 && y) update(p, p - w + 1, Math.SQRT2);
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const p = y * w + x;
    if (x < w - 1) update(p, p + 1, 1); if (y < h - 1) update(p, p + w, 1);
    if (x < w - 1 && y < h - 1) update(p, p + w + 1, Math.SQRT2);
    if (x && y < h - 1) update(p, p + w - 1, Math.SQRT2);
  }
  const width = Math.max(1, Math.min(12, settings.outlineWidth ?? 4)) * Math.max(w, h) / 1000;
  const ctx = canvas.getContext('2d')!;
  const output = ctx.getImageData(0, 0, canvas.width, canvas.height), out = output.data;
  const scaleX = canvas.width / w, scaleY = canvas.height / h;
  const sample = (field: Float32Array, x: number, y: number) => {
    x = Math.max(0, Math.min(w - 1, x)); y = Math.max(0, Math.min(h - 1, y));
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
    return field[y0 * w + x0] * (1 - fx) * (1 - fy) + field[y0 * w + x1] * fx * (1 - fy)
      + field[y1 * w + x0] * (1 - fx) * fy + field[y1 * w + x1] * fx * fy;
  };
  const ribs = new Float32Array(n);
  for (let p = 0; p < n; p++) if (nearest[p] >= 0 && dist[p] <= width + 2)
    ribs[p] = Math.cos(phase[nearest[p]] * Math.PI * 2 / 3.2);
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const bx = Math.min(w - 1, Math.floor((x + 0.5) / scaleX));
    const by = Math.min(h - 1, Math.floor((y + 0.5) / scaleY));
    const p = by * w + bx, seed = nearest[p];
    if (!ink[p] || seed < 0 || dist[p] > width + 1) continue;
    const lx = (x + 0.5) / scaleX - 0.5, ly = (y + 0.5) / scaleY - 0.5;
    const d = sample(dist, lx, ly);
    const t = Math.max(0, Math.min(1, (d - 0.5) / width));
    const crown = Math.sin(Math.PI * t);
    const grain = sample(ribs, lx, ly);
    const rib = 0.90 + 0.10 * grain;
    const lighting = (0.48 + 0.52 * crown) * rib;
    const shine = Math.pow(crown, 2) * (18 + settings.sheen * 0.35) * (0.8 + 0.2 * grain);
    const blend = Math.max(0, Math.min(1, width + 0.5 - d));
    const i = (y * canvas.width + x) * 4;
    for (let channel = 0; channel < 3; channel++) {
      const value = Math.min(255, data[seed * 4 + channel] * lighting + shine);
      out[i + channel] = out[i + channel] * (1 - blend) + value * blend;
    }
  }
  ctx.putImageData(output, 0, 0);
  return canvas;
}
