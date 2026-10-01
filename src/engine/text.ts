export interface TextState {
  text: string;
  font: string;
  size: number;
  color: string;
  spacing: number;
}

export const TEXT_FONTS = [
  { id: "'Alfa Slab One', serif", name: 'Slab Bold' },
  { id: "'Bebas Neue', sans-serif", name: 'Tall Condensed' },
  { id: "'Montserrat', sans-serif", name: 'Modern Bold' },
  { id: "'Playfair Display', serif", name: 'Elegant Serif' },
  { id: "'Oswald', sans-serif", name: 'Sport Classic' },
  { id: "'Great Vibes', cursive", name: 'Script' }
];

export const DEFAULT_TEXT: TextState = {
  text: 'YOUR DESIGN',
  font: "'Alfa Slab One', serif",
  size: 96,
  color: '#b91c1c',
  spacing: 2
};

export function renderText(t: TextState): { url: string; w: number; h: number } {
  const scale = 3;
  const c = document.createElement('canvas');
  c.width = 1400 * scale; c.height = 700 * scale;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = t.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const px = t.size * scale;
  ctx.font = `800 ${px}px ${t.font}`;
  try { (document as Document).fonts?.ready; } catch { /* noop */ }
  const lines = t.text.toUpperCase().split('\n');
  const lh = px * 1.15;
  const cy = c.height / 2;
  const startY = cy - ((lines.length - 1) * lh) / 2;
  lines.forEach((line, i) => {
    if (!t.spacing) { ctx.fillText(line, c.width / 2, startY + i * lh); return; }
    const chars = [...line];
    const widths = chars.map(ch => ctx.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + t.spacing * scale * (chars.length - 1);
    let x = c.width / 2 - total / 2;
    chars.forEach((ch, j) => {
      ctx.fillText(ch, x + widths[j] / 2, startY + i * lh);
      x += widths[j] + t.spacing * scale;
    });
  });
  // trim
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  let minX = c.width, minY = c.height, maxX = 0, maxY = 0;
  for (let y = 0; y < c.height; y += 2) {
    for (let x = 0; x < c.width; x += 2) {
      if (data[(y * c.width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX) return { url: c.toDataURL(), w: 700, h: 350 };
  const pad = 30 * scale;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(c.width - 1, maxX + pad); maxY = Math.min(c.height - 1, maxY + pad);
  const tw = maxX - minX, th = maxY - minY;
  const out = document.createElement('canvas');
  out.width = tw; out.height = th;
  out.getContext('2d')!.drawImage(c, minX, minY, tw, th, 0, 0, tw, th);
  return { url: out.toDataURL('image/png'), w: Math.round(tw / scale), h: Math.round(th / scale) };
}
