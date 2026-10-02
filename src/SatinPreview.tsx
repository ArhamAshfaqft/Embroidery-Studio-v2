import { useEffect, useState } from 'react';
import type { StitchSettings } from './types';

/** Zoom detail is separate from exports/mockups. Keep the last valid base image
 * visible while a cancellable worker computes genuinely new material samples. */
export function SatinPreview({ source, baseline, settings, zoom }: {
  source: string; baseline: string; settings: StitchSettings; zoom: number;
}) {
  const [preview, setPreview] = useState<{ url: string; baseline: string; w: number; h: number } | null>(null);
  const [dpr, setDpr] = useState(window.devicePixelRatio || 1);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview.url);
  }, [preview]);
  useEffect(() => {
    const update = () => setDpr(window.devicePixelRatio || 1);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  // Quantize screen demand so adjacent wheel events reuse the same render.
  const demand = Math.ceil(zoom * dpr * 2) / 2;
  useEffect(() => {
    let cancelled = false;
    let worker: Worker | undefined;
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const blob = await (await fetch(source)).blob();
        if (cancelled) return;
        worker = new Worker(new URL('./engine/satinPreview.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => {
          if (cancelled) return;
          if (data.blob) {
            const url = URL.createObjectURL(data.blob);
            setPreview({ url, baseline, w: data.w, h: data.h });
          }
          setBusy(false); worker?.terminate();
        };
        worker.onerror = () => { if (!cancelled) setBusy(false); worker?.terminate(); };
        worker.postMessage({ source: blob, settings, zoom: demand, dpr: 1 });
      } catch { if (!cancelled) setBusy(false); }
    }, 160);
    return () => {
      cancelled = true; clearTimeout(timer); worker?.terminate();
    };
  }, [source, baseline, settings, demand]);
  const current = preview?.baseline === baseline ? preview : null;
  const fit = current ? Math.min(1, 408 / current.w, 448 / current.h) : 1;
  return <div className="relative">
    <img src={current?.url ?? baseline} alt="stitched" draggable={false}
      style={current ? { width: current.w * fit + 32, height: current.h * fit + 32 } : undefined}
      className="max-w-[440px] max-h-[480px] object-contain rounded-2xl shadow-xl canvas-checker bg-white p-4" />
    {busy && <span role="status" className="absolute left-2 bottom-2 rounded bg-white/90 px-2 py-1 text-[10px] text-stone-500">Refining detail…</span>}
  </div>;
}
