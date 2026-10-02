/** Match the image's fitted CSS size and screen density, not the zoom label alone.
 * Discrete tiers avoid rerendering on every wheel tick. Limit allocations on HiDPI.
 */
export function satinPreviewDetail(w: number, h: number, zoom: number, dpr: number) {
  const fit = Math.min(1, 408 / w, 448 / h);
  const needed = fit * zoom * dpr;
  const tier = [1, 1.5, 2, 3, 4, 6, 8].find(v => v >= needed) ?? 8;
  return Math.max(1, Math.min(tier, 8192 / w, 8192 / h, Math.sqrt(16_000_000 / (w * h))));
}
