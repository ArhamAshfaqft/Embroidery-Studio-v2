/** Knock out a flat white / black photo backdrop (edge flood-fill, keeps inner whites). */
export function removeBackground(img: HTMLImageElement | HTMLCanvasElement, tolerance = 34): string {
  const w = img.width, h = img.height;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const d = data.data;

  const corners = [0, (w - 1) * 4, ((h - 1) * w) * 4, ((h - 1) * w + w - 1) * 4];
  let br = 0, bg = 0, bb = 0;
  for (const i of corners) { br += d[i]; bg += d[i + 1]; bb += d[i + 2]; }
  br = Math.round(br / 4); bg = Math.round(bg / 4); bb = Math.round(bb / 4);
  const bright = (br + bg + bb) / 3;
  const spread = Math.max(br, bg, bb) - Math.min(br, bg, bb);
  // Only strip near-white / near-black artboards, never coloured photos
  if (spread > 26 || (bright > 50 && bright < 205)) return c.toDataURL('image/png');

  const tolSq = tolerance * tolerance * 3;
  const visited = new Uint8Array(w * h);
  const queue: number[] = [];
  for (let x = 0; x < w; x++) { queue.push(x); queue.push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { queue.push(y * w); queue.push(y * w + w - 1); }
  let head = 0;
  while (head < queue.length) {
    const p = queue[head++];
    if (visited[p]) continue;
    visited[p] = 1;
    const idx = p * 4;
    const dr = d[idx] - br, dg = d[idx + 1] - bg, db = d[idx + 2] - bb;
    if (dr * dr + dg * dg + db * db <= tolSq) {
      d[idx + 3] = 0;
      const px = p % w, py = Math.floor(p / w);
      if (px > 0) queue.push(p - 1);
      if (px < w - 1) queue.push(p + 1);
      if (py > 0) queue.push(p - w);
      if (py < h - 1) queue.push(p + w);
    }
  }
  ctx.putImageData(data, 0, 0);
  return c.toDataURL('image/png');
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}
