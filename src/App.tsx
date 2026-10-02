import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Upload, Type, ArrowRight, ArrowLeft, Download, Trash2, Check, ZoomIn, ZoomOut, Maximize2, Hand, FileUp } from 'lucide-react';
import { DEFAULT_STITCH, STITCH_CARDS, StitchSettings } from './types';
import { renderStitch } from './engine/stitch';
import { SatinPreview } from './SatinPreview';
import { DEFAULT_TEXT, TEXT_FONTS, TextState, renderText } from './engine/text';
import { loadImage, removeBackground } from './engine/imageTools';
import { MOCKUPS } from './engine/mockups';
import { DEFAULT_SEW, SewOptions, sewOntoGarment } from './engine/sew';

type Step = 1 | 2 | 3;

const THREAD_COLORS = ['#b91c1c', '#1d4ed8', '#15803d', '#111111', '#f59e0b', '#ec4899', '#ffffff', '#0ea5e9'];

/** Mockup composite resolution — high enough that deep zoom stays sharp */
const COMP = 1400;

function Slider(props: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="flex justify-between text-[13px] mb-1.5">
        <span className="font-medium text-stone-700">{props.label}</span>
        <span className="font-semibold tabular-nums">{props.value}{props.unit ?? ''}</span>
      </div>
      <input type="range" min={props.min} max={props.max} step={props.step ?? 1} value={props.value}
        onChange={e => props.onChange(Number(e.target.value))} />
    </label>
  );
}

interface View { z: number; x: number; y: number }
const freshView = (): View => ({ z: 1, x: 0, y: 0 });

/** Free viewport: wheel = zoom (as much as you want), drag = pan, double-click = reset */
function ZoomViewport(props: {
  view: View; onView: (v: View) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const { view, onView } = props;
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  return (
    <div
      className={`relative overflow-hidden ${props.className ?? ''}`}
      onWheel={e => {
        const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        onView({ ...view, z: Math.min(8, Math.max(0.15, view.z * f)) });
      }}
      onMouseDown={e => {
        if (e.button === 1 || e.button === 0) {
          drag.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
          const move = (ev: MouseEvent) => {
            const d = drag.current!;
            onView({ ...view, x: d.ox + (ev.clientX - d.sx), y: d.oy + (ev.clientY - d.sy) });
          };
          const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
          window.addEventListener('mousemove', move);
          window.addEventListener('mouseup', up);
        }
      }}
      onDoubleClick={() => onView(freshView())}
    >
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }} className="pointer-events-auto">
          {props.children}
        </div>
      </div>
      <div className="absolute top-2 right-2 flex items-center gap-1 bg-white/95 rounded-lg shadow px-1 py-1" onMouseDown={e => e.stopPropagation()}>
        <button title="Zoom out" className="p-1.5 hover:bg-stone-100 rounded"
          onClick={() => onView({ ...view, z: Math.max(0.15, view.z / 1.25) })}><ZoomOut size={14} /></button>
        <span className="text-[11px] font-bold w-11 text-center tabular-nums">{Math.round(view.z * 100)}%</span>
        <button title="Zoom in" className="p-1.5 hover:bg-stone-100 rounded"
          onClick={() => onView({ ...view, z: Math.min(8, view.z * 1.25) })}><ZoomIn size={14} /></button>
        <button title="Reset view" className="p-1.5 hover:bg-stone-100 rounded" onClick={() => onView(freshView())}><Maximize2 size={14} /></button>
      </div>
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 text-[11px] text-stone-500 bg-white/90 rounded-full px-2.5 py-1">
        <Hand size={11} /> scroll = zoom · drag = pan · double-click = reset
      </div>
    </div>
  );
}

export default function App() {
  const [step, setStep] = useState<Step>(1);
  const [sourceTab, setSourceTab] = useState<'upload' | 'text'>('upload');

  // source
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState('No artwork yet');
  const [sourceSize, setSourceSize] = useState({ w: 0, h: 0 });
  const [text, setText] = useState<TextState>(DEFAULT_TEXT);

  // stitch
  const [stitch, setStitch] = useState<StitchSettings>(DEFAULT_STITCH);
  const [stitchedUrl, setStitchedUrl] = useState<string | null>(null);
  const [isStitching, setIsStitching] = useState(false);
  const [compare, setCompare] = useState(false);
  const stitchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [view2, setView2] = useState<View>(freshView());

  // mockup
  const [mockupId, setMockupId] = useState(MOCKUPS[0].id);
  const [customMockups, setCustomMockups] = useState<{ id: string; name: string; url: string }[]>([]);
  const mockupFileRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ x: 50, y: 42, scale: 0.42, rotation: 0 });
  const [sew, setSew] = useState<SewOptions>(DEFAULT_SEW);
  const [sewStatus, setSewStatus] = useState('');
  const [isPlacing, setIsPlacing] = useState(false);
  const mockupCanvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [garmentImg, setGarmentImg] = useState<HTMLImageElement | null>(null);
  const [view3, setView3] = useState<View>(freshView());
  const [geom, setGeom] = useState<{ cx: number; cy: number; cw: number; ch: number } | null>(null);

  const allMockups = useMemo(
    () => [...customMockups.map(c => ({ id: c.id, name: c.name, file: c.url })), ...MOCKUPS],
    [customMockups]
  );
  const mockup = useMemo(
    () => allMockups.find(m => m.id === mockupId) ?? allMockups[0],
    [allMockups, mockupId]
  );

  /** Client's own garment photo as a mockup background */
  const handleMockupFile = async (f: File) => {
    if (!f.type.startsWith('image/')) { alert('Please upload an image (PNG / JPG / WebP).'); return; }
    const url = URL.createObjectURL(f);
    try {
      await loadImage(url);
      const id = `custom_${Date.now()}`;
      setCustomMockups(prev => [{ id, name: f.name.replace(/\.[^.]+$/, ''), url }, ...prev]);
      setMockupId(id);
    } catch {
      URL.revokeObjectURL(url);
      alert('Could not read that image.');
    }
  };
  const removeCustomMockup = (id: string) => {
    setCustomMockups(prev => {
      const found = prev.find(c => c.id === id);
      if (found) URL.revokeObjectURL(found.url);
      return prev.filter(c => c.id !== id);
    });
    if (mockupId === id) setMockupId(MOCKUPS[0].id);
  };

  // ---- text → source ----
  const textRender = useMemo(() => {
    try { return renderText(text); } catch { return null; }
  }, [text]);
  useEffect(() => {
    if (sourceTab === 'text' && textRender) {
      setSourceUrl(textRender.url);
      setSourceName(`Text: ${text.text.slice(0, 20) || 'untitled'}`);
      setSourceSize({ w: textRender.w, h: textRender.h });
    }
  }, [sourceTab, textRender]);

  // ---- stitch render (debounced) ----
  useEffect(() => {
    if (!sourceUrl || step < 2) return;
    let cancelled = false;
    setIsStitching(true);
    const t = setTimeout(async () => {
      try {
        const img = await loadImage(sourceUrl);
        if (cancelled) return;
        const out = renderStitch(img, stitch);
        stitchCanvasRef.current = out;
        setStitchedUrl(out.toDataURL('image/png'));
      } catch (e) { console.warn('stitch failed', e); }
      if (!cancelled) setIsStitching(false);
    }, 180);
    return () => { cancelled = true; clearTimeout(t); };
  }, [sourceUrl, stitch, step]);

  // ---- garment load ----
  useEffect(() => {
    if (step !== 3) return;
    loadImage(mockup.file).then(setGarmentImg).catch(() => setGarmentImg(null));
  }, [mockup, step]);

  // ---- sewn mockup composite: instant paste while dragging, full sew on release ----
  const paintMockup = useCallback(() => {
    const canvas = mockupCanvasRef.current;
    if (!canvas || !garmentImg || !stitchCanvasRef.current) return;
    const stitch = stitchCanvasRef.current;
    if (isPlacing) {
      // fast preview so the design tracks the cursor 1:1 — full sew settles on release
      canvas.width = COMP; canvas.height = COMP;
      const ctx = canvas.getContext('2d')!;
      const gRatio = garmentImg.width / garmentImg.height;
      let dw = COMP, dh = COMP / gRatio;
      if (dh < COMP) { dh = COMP; dw = COMP * gRatio; }
      ctx.fillStyle = '#e9e5de';
      ctx.fillRect(0, 0, COMP, COMP);
      ctx.drawImage(garmentImg, (COMP - dw) / 2, (COMP - dh) / 2, dw, dh);
      const ew = COMP * pos.scale, eh = ew * (stitch.height / stitch.width);
      ctx.save();
      ctx.translate((pos.x / 100) * COMP, (pos.y / 100) * COMP);
      ctx.rotate((pos.rotation * Math.PI) / 180);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(stitch, -ew / 2, -eh / 2, ew, eh);
      ctx.restore();
      setSewStatus('');
      return;
    }
    setSewStatus('Sewing into fabric…');
    const t = setTimeout(() => {
      try {
        const sewn = sewOntoGarment(garmentImg, stitch, COMP, COMP, pos, sew);
        canvas.width = COMP; canvas.height = COMP;
        canvas.getContext('2d')!.drawImage(sewn, 0, 0);
      } catch (e) { console.warn('sew failed', e); }
      setSewStatus('');
    }, 200);
    return () => clearTimeout(t);
  }, [garmentImg, pos, sew, isPlacing]);
  useEffect(() => { const cancel = paintMockup(); return cancel; }, [paintMockup, stitchedUrl]);

  // ---- design hit-test (internal 900px coords) ----
  const designHalf = () => {
    const emb = stitchCanvasRef.current;
    const ew = COMP * pos.scale;
    const eh = emb ? ew * (emb.height / emb.width) : ew;
    return { ew, eh };
  };
  const insideDesign = (ix: number, iy: number) => {
    const { ew, eh } = designHalf();
    const cx = (pos.x / 100) * COMP, cy = (pos.y / 100) * COMP;
    const rot = (-pos.rotation * Math.PI) / 180;
    const dx = ix - cx, dy = iy - cy;
    const lx = dx * Math.cos(rot) - dy * Math.sin(rot);
    const ly = dx * Math.sin(rot) + dy * Math.cos(rot);
    return Math.abs(lx) <= ew / 2 + 12 && Math.abs(ly) <= eh / 2 + 12;
  };
  const toInternal = (clientX: number, clientY: number) => {
    const canvas = mockupCanvasRef.current!;
    const r = canvas.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * COMP,
      y: ((clientY - r.top) / r.height) * COMP
    };
  };

  // ---- track canvas rect on screen (for overlay handles) ----
  useLayoutEffect(() => {
    const update = () => {
      const vp = viewportRef.current, cv = mockupCanvasRef.current;
      if (!vp || !cv) return;
      const vr = vp.getBoundingClientRect(), cr = cv.getBoundingClientRect();
      setGeom({ cx: cr.left - vr.left, cy: cr.top - vr.top, cw: cr.width, ch: cr.height });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [step, view3, pos, stitchedUrl, garmentImg]);

  const toScreen = (ix: number, iy: number) =>
    geom ? { x: geom.cx + (ix / COMP) * geom.cw, y: geom.cy + (iy / COMP) * geom.ch } : { x: 0, y: 0 };

  /** four rotated design corners + top rotation-handle anchor, in internal coords */
  const designCorners = () => {
    const { ew, eh } = designHalf();
    const cx = (pos.x / 100) * COMP, cy = (pos.y / 100) * COMP;
    const rot = (pos.rotation * Math.PI) / 180;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const pt = (sx: number, sy: number) => {
      const lx = sx * ew / 2, ly = sy * eh / 2;
      return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
    };
    return {
      corners: [pt(-1, -1), pt(1, -1), pt(1, 1), pt(-1, 1)],
      center: { x: cx, y: cy },
      rotHandle: (() => {
        const lx = 0, ly = -eh / 2 - 90;
        return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
      })()
    };
  };

  const startResize = (e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault();
    setIsPlacing(true);
    const start = toInternal(e.clientX, e.clientY);
    const c = designCorners().center;
    const d0 = Math.max(20, Math.hypot(start.x - c.x, start.y - c.y));
    const s0 = pos.scale;
    const move = (ev: MouseEvent) => {
      const p = toInternal(ev.clientX, ev.clientY);
      const d1 = Math.hypot(p.x - c.x, p.y - c.y);
      setPos(prev => ({ ...prev, scale: Math.min(1, Math.max(0.05, s0 * (d1 / d0))) }));
    };
    const up = () => { setIsPlacing(false); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const startRotate = (e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault();
    setIsPlacing(true);
    const start = toInternal(e.clientX, e.clientY);
    const c = designCorners().center;
    const a0 = Math.atan2(start.y - c.y, start.x - c.x);
    const r0 = pos.rotation;
    const move = (ev: MouseEvent) => {
      const p = toInternal(ev.clientX, ev.clientY);
      const a1 = Math.atan2(p.y - c.y, p.x - c.x);
      const deg = ((a1 - a0) * 180) / Math.PI;
      setPos(prev => ({ ...prev, rotation: Math.min(45, Math.max(-45, Math.round(r0 + deg))) }));
    };
    const up = () => { setIsPlacing(false); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // ---- upload handlers ----
  const fileRef = useRef<HTMLInputElement>(null);
  const fontFileRef = useRef<HTMLInputElement>(null);
  const [customFonts, setCustomFonts] = useState<{ id: string; name: string }[]>([]);
  const handleFile = async (f: File) => {
    if (!f.type.startsWith('image/')) { alert('Please upload an image (PNG / JPG / WebP / SVG).'); return; }
    const url = URL.createObjectURL(f);
    try {
      const img = await loadImage(url);
      // Downscale huge photos (e.g. 12MP phone pics) at import — the stitch
      // engine normalises to ~1000px anyway, so this only removes the
      // seconds-long freeze after picking a file, with zero quality loss.
      const MAX = 2000;
      const k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d')!.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      // Automatic cleanup: strip an edge-connected white/black photo backdrop
      // (logos on white would otherwise stitch as a solid rectangle).
      // Interior whites and transparent PNGs are left untouched.
      let dataUrl = c.toDataURL('image/png');
      try {
        // removeBackground only strips an edge-connected near-white/black
        // artboard and returns the image unchanged otherwise
        dataUrl = removeBackground(c);
      } catch { /* keep original */ }
      setSourceUrl(dataUrl);
      setSourceName(f.name.replace(/\.[^.]+$/, ''));
      setSourceSize({ w, h });
      setSourceTab('upload');
    } catch { alert('Could not read that image.'); }
  };
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of Array.from(items)) {
        if (it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (f) handleFile(f);
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  /** Client font upload (.ttf / .otf / .woff) — available instantly in the font grid */
  const handleFontFile = async (f: File) => {
    if (!/\.(ttf|otf|woff2?)$/i.test(f.name)) { alert('Please choose a font file (.TTF, .OTF, .WOFF).'); return; }
    const base = f.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9 ]/g, '').trim() || 'Custom';
    const family = `Uploaded ${base}`;
    const cssId = `"${family}", sans-serif`;
    if (customFonts.some(c => c.id === cssId)) { setText(t => ({ ...t, font: cssId })); return; }
    try {
      const face = new FontFace(family, await f.arrayBuffer());
      await face.load();
      document.fonts.add(face);
      setCustomFonts(prev => [...prev, { id: cssId, name: base }]);
      setText(t => ({ ...t, font: cssId }));
    } catch { alert('Could not load that font file.'); }
  };

  const canContinue1 = !!sourceUrl;
  const set = (p: Partial<StitchSettings>) => setStitch(s => ({ ...s, ...p }));

  const download = (url: string, name: string) => {
    const a = document.createElement('a');
    a.href = url; a.download = name;
    a.click();
  };

  return (
    <div className="h-full flex flex-col">
      {/* header */}
      <header className="bg-[#1c1917] text-white px-5 py-3 flex items-center justify-between shrink-0">
        <div className="font-bold leading-none text-[15px]">Embroidery Studio</div>
        <div className="flex items-center gap-1 text-[13px]">
          {(['Artwork', 'Stitch', 'Mockup'] as const).map((label, i) => {
            const n = (i + 1) as Step;
            const active = step === n, done = step > n;
            return (
              <button key={label} onClick={() => { if (n === 1 || sourceUrl) setStep(n); }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full font-medium ${active ? 'bg-white text-stone-900' : done ? 'text-amber-300' : 'text-stone-400'}`}>
                <span className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center ${active ? 'bg-stone-900 text-white' : 'bg-white/15'}`}>
                  {done ? <Check size={12} /> : n}
                </span>{label}
              </button>
            );
          })}
        </div>
      </header>

      {/* STEP 1 */}
      {step === 1 && (
        <div className="flex-1 flex overflow-hidden">
          <div className="w-[340px] shrink-0 bg-white border-r border-stone-200 p-4 overflow-y-auto">
            <div className="grid grid-cols-2 gap-1 p-1 bg-stone-100 rounded-xl mb-4">
              <button onClick={() => setSourceTab('upload')}
                className={`py-2 rounded-lg text-[13px] font-semibold flex items-center justify-center gap-1.5 ${sourceTab === 'upload' ? 'bg-stone-900 text-white shadow' : 'text-stone-500'}`}>
                <Upload size={14} /> Upload image</button>
              <button onClick={() => setSourceTab('text')}
                className={`py-2 rounded-lg text-[13px] font-semibold flex items-center justify-center gap-1.5 ${sourceTab === 'text' ? 'bg-stone-900 text-white shadow' : 'text-stone-500'}`}>
                <Type size={14} /> Add text</button>
            </div>

            {sourceTab === 'upload' ? (
              <div className="space-y-3">
                <div onClick={() => fileRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
                  className="border-2 border-dashed border-stone-300 hover:border-stone-500 rounded-2xl p-8 text-center cursor-pointer bg-stone-50 transition-colors">
                  <Upload size={22} className="mx-auto mb-2 text-stone-400" />
                  <div className="text-sm font-semibold">Drop image here or click to browse</div>
                  <div className="text-xs text-stone-500 mt-1">PNG · JPG · WebP · SVG — or press Ctrl+V to paste</div>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                </div>
                {sourceUrl && sourceTab === 'upload' && (
                  <div className="rounded-xl border border-stone-200 p-3 space-y-2">
                    <div className="text-[13px] font-semibold truncate">{sourceName}</div>
                    <div className="text-xs text-stone-500">{sourceSize.w} × {sourceSize.h} px</div>
                    <button onClick={() => setSourceUrl(null)}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-stone-500 hover:text-red-600 text-[13px]">
                      <Trash2 size={14} /> Remove image</button>
                  </div>
                )}
                <div className="text-xs text-stone-500 leading-relaxed bg-stone-100 rounded-xl p-3">
                  Tip: bold shapes with 2–6 flat colours stitch best. Very fine detail will be simplified automatically.
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="text-[13px] font-semibold mb-1.5">Your text</div>
                  <textarea value={text.text} rows={2} onChange={e => setText({ ...text, text: e.target.value })}
                    className="w-full rounded-xl border border-stone-300 p-2.5 text-sm font-semibold focus:outline-none focus:border-stone-900" />
                </div>
                <div>
                  <div className="text-[13px] font-semibold mb-1.5">Font style</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[...TEXT_FONTS, ...customFonts].map(f => (
                      <button key={f.id} onClick={() => setText({ ...text, font: f.id })}
                        className={`rounded-lg border px-2 py-2 text-left ${text.font === f.id ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-200 bg-white'}`}>
                        <div className="text-[15px] leading-none" style={{ fontFamily: f.id }}>Ag</div>
                        <div className="text-[11px] mt-1 opacity-70">{f.name}</div>
                      </button>
                    ))}
                  </div>
                  <button onClick={() => fontFileRef.current?.click()}
                    className="mt-2 w-full flex items-center justify-center gap-2 py-2 rounded-xl border-2 border-dashed border-stone-300 hover:border-stone-500 text-[13px] font-semibold text-stone-600">
                    <FileUp size={14} /> Upload your own font
                  </button>
                  <input ref={fontFileRef} type="file" accept=".ttf,.otf,.woff,.woff2" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFontFile(f); e.target.value = ''; }} />
                </div>
                <Slider label="Size" value={text.size} min={40} max={180} onChange={v => setText({ ...text, size: v })} />
                <div>
                  <div className="text-[13px] font-semibold mb-1.5">Thread colour</div>
                  <div className="flex gap-1.5 flex-wrap">
                    {THREAD_COLORS.map(c => (
                      <button key={c} onClick={() => setText({ ...text, color: c })}
                        className={`w-8 h-8 rounded-full border-2 ${text.color === c ? 'border-stone-900 scale-110' : 'border-stone-200'}`}
                        style={{ background: c }} />
                    ))}
                    <input type="color" value={text.color} onChange={e => setText({ ...text, color: e.target.value })}
                      className="w-8 h-8 rounded-full cursor-pointer" title="Custom colour" />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 flex flex-col bg-[#eceae6]">
            <div className="flex-1 flex items-center justify-center p-10 overflow-auto">
              {sourceUrl ? (
                <img src={sourceUrl} alt="artwork"
                  className="max-w-[520px] max-h-[520px] object-contain drop-shadow-xl bg-white rounded-2xl p-6 canvas-checker" />
              ) : (
                <div className="text-center text-stone-400">
                  <Upload size={36} className="mx-auto mb-3" />
                  <div className="font-semibold text-stone-600">Upload an image or write some text</div>
                  <div className="text-sm">Your artwork will appear here</div>
                </div>
              )}
            </div>
            <div className="p-4 bg-white border-t border-stone-200 flex justify-end">
              <button disabled={!canContinue1} onClick={() => setStep(2)}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm ${canContinue1 ? 'bg-stone-900 text-white hover:bg-stone-700' : 'bg-stone-200 text-stone-400 cursor-not-allowed'}`}>
                Convert to stitches <ArrowRight size={16} /></button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 2 — free zoom/pan preview */}
      {step === 2 && (
        <div className="flex-1 flex overflow-hidden">
          <div className="w-[330px] shrink-0 bg-white border-r border-stone-200 p-4 overflow-y-auto space-y-4">
            <div>
              <div className="text-[13px] font-bold mb-2">1 · Stitch style</div>
              <div className="space-y-1.5">
                {STITCH_CARDS.map(c => (
                  <button key={c.id} onClick={() => set(c.id === 'satin' ? { type: c.id, angle: 0 } : { type: c.id })}
                    className={`w-full text-left rounded-xl border-2 px-3 py-2.5 transition-all ${stitch.type === c.id ? 'border-stone-900 bg-stone-900 text-white shadow' : 'border-stone-200 hover:border-stone-400'}`}>
                    <div className="text-[13px] font-bold">{c.name}</div>
                    <div className={`text-[11px] ${stitch.type === c.id ? 'text-stone-300' : 'text-stone-500'}`}>{c.desc}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <div className="text-[13px] font-bold">2 · Fine-tune</div>
              <Slider label="Stitch direction" value={stitch.angle} min={0} max={90} unit="°" onChange={v => set({ angle: v })} />
              <Slider label="Density" value={stitch.density} min={1} max={10} onChange={v => set({ density: v })} />
              <Slider label="Thread thickness" value={stitch.thickness} min={1} max={10} onChange={v => set({ thickness: v })} />
              <Slider label="Thread shine" value={stitch.sheen} min={0} max={100} unit="%" onChange={v => set({ sheen: v })} />
            </div>
            <div className="rounded-xl bg-stone-100 p-3 space-y-2.5">
              {stitch.type !== 'satin' && <label className="flex items-center justify-between cursor-pointer">
                <span className="text-[13px] font-semibold">Satin border edge</span>
                <input type="checkbox" checked={stitch.border} onChange={e => set({ border: e.target.checked })} className="w-5 h-5 accent-stone-900" />
              </label>}
              {stitch.type !== 'satin' && stitch.border && (
                <Slider label="Border width" value={stitch.borderWidth} min={2} max={14} unit="px" onChange={v => set({ borderWidth: v })} />
              )}
              <div>
                <div className="text-[13px] font-semibold mb-1.5">Thread colours</div>
                <div className="grid grid-cols-4 gap-1">
                  {[{ v: 0, l: 'Full' }, { v: 12, l: '12' }, { v: 8, l: '8' }, { v: 6, l: '6' }].map(o => (
                    <button key={o.l} onClick={() => set({ maxColors: o.v })}
                      className={`py-1.5 rounded-lg text-[12px] font-bold ${stitch.maxColors === o.v ? 'bg-stone-900 text-white' : 'bg-white border border-stone-200'}`}>{o.l}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col bg-[#eceae6]">
            <div className="px-5 pt-3 flex items-center justify-between">
              <div className="text-[13px] text-stone-500">
                {isStitching ? 'Stitching…' : 'Live stitch preview — zoom freely'} · <span className="font-semibold text-stone-700">{sourceName}</span>
              </div>
              <label className="flex items-center gap-2 text-[13px] font-medium cursor-pointer">
                <input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} className="w-4 h-4 accent-stone-900" />
                Compare with original</label>
            </div>
            <ZoomViewport view={view2} onView={setView2} className="flex-1 m-4 rounded-2xl bg-[#e2ded7]">
              <div className="flex gap-4">
                {(compare ? [sourceUrl, stitchedUrl] : [stitchedUrl]).map((url, i) => url ? (
                  <div key={i} className="text-center">
                    {stitch.type === 'satin' && !(i === 0 && compare) && sourceUrl ?
                      <SatinPreview source={sourceUrl} baseline={url} settings={stitch} zoom={view2.z} /> :
                      <img src={url} alt={i === 0 && compare ? 'original' : 'stitched'}
                        className="max-w-[440px] max-h-[480px] object-contain rounded-2xl shadow-xl canvas-checker bg-white p-4" draggable={false} />}
                    <div className="text-[11px] font-bold uppercase tracking-wider text-stone-500 mt-2">
                      {compare ? (i === 0 ? 'Original artwork' : 'Stitched result') : 'Stitched result'}</div>
                  </div>
                ) : null)}
                {!stitchedUrl && <div className="text-stone-400 text-sm animate-pulse">Rendering threads…</div>}
              </div>
            </ZoomViewport>
            <div className="p-4 bg-white border-t border-stone-200 flex justify-between">
              <button onClick={() => setStep(1)} className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm text-stone-600 hover:bg-stone-100">
                <ArrowLeft size={16} /> Back</button>
              <div className="flex gap-2">
                <button disabled={!stitchedUrl || isStitching} onClick={() => stitchedUrl && download(stitchedUrl, `${sourceName}-stitch.png`)}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm border border-stone-300 ${!stitchedUrl || isStitching ? 'opacity-40 cursor-wait' : 'hover:bg-stone-100'}`}>
                  <Download size={16} /> Save PNG</button>
                <button disabled={!stitchedUrl} onClick={() => setStep(3)}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm bg-amber-400 hover:bg-amber-300 text-stone-950 disabled:opacity-40">
                  Place on mockup <ArrowRight size={16} /></button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 3 — free zoom/pan viewport + realistic sew blending */}
      {step === 3 && (
        <div className="flex-1 flex overflow-hidden">
          <div className="w-[330px] shrink-0 bg-white border-r border-stone-200 p-4 overflow-y-auto space-y-4">
            <div>
              <div className="text-[13px] font-bold mb-2">Choose garment</div>
              <div className="grid grid-cols-3 gap-1.5">
                {allMockups.map(m => {
                  const isCustom = customMockups.some(c => c.id === m.id);
                  return (
                    <div key={m.id} className="relative">
                      <button onClick={() => setMockupId(m.id)} title={m.name}
                        className={`rounded-xl overflow-hidden border-2 w-full ${mockupId === m.id ? 'border-stone-900 shadow' : 'border-stone-200 hover:border-stone-400'}`}>
                        <img src={m.file} alt={m.name} className="w-full h-16 object-cover" />
                      </button>
                      {isCustom && (
                        <button onClick={() => removeCustomMockup(m.id)} title="Remove"
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-stone-900 text-white text-[11px] font-bold leading-none shadow">×</button>
                      )}
                    </div>
                  );
                })}
              </div>
              <button onClick={() => mockupFileRef.current?.click()}
                className="mt-2 w-full flex items-center justify-center gap-2 py-2 rounded-xl border-2 border-dashed border-stone-300 hover:border-stone-500 text-[13px] font-semibold text-stone-600">
                <Upload size={14} /> Use your own mockup photo
              </button>
              <input ref={mockupFileRef} type="file" accept="image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleMockupFile(f); e.target.value = ''; }} />
              <div className="text-[12px] text-stone-500 mt-1.5 font-medium">{mockup.name} · scroll to zoom, drag background to pan, drag design to move it</div>
            </div>
            <div className="space-y-3">
              <div className="text-[13px] font-bold">Design placement</div>
              <Slider label="Design size" value={Math.round(pos.scale * 100)} min={10} max={90} unit="%" onChange={v => setPos(p => ({ ...p, scale: v / 100 }))} />
              <Slider label="Rotation" value={pos.rotation} min={-45} max={45} unit="°" onChange={v => setPos(p => ({ ...p, rotation: v }))} />
              <button onClick={() => { setPos({ x: 50, y: 42, scale: 0.42, rotation: 0 }); setView3(freshView()); }}
                className="text-[13px] font-semibold text-stone-500 hover:text-stone-900">Reset placement + view</button>
            </div>
            <div className="rounded-xl bg-stone-100 p-3 space-y-3">
              <div className="text-[13px] font-bold">Fabric blend</div>
              <Slider label="Fabric shading" value={sew.sewIn} min={0} max={100} unit="%" onChange={v => setSew(s => ({ ...s, sewIn: v }))} />
              <Slider label="Wrinkle wrap" value={sew.wrap} min={0} max={100} unit="%" onChange={v => setSew(s => ({ ...s, wrap: v }))} />
              <Slider label="Contact shadow" value={sew.shadow} min={0} max={100} unit="%" onChange={v => setSew(s => ({ ...s, shadow: v }))} />
            </div>
          </div>

          <div className="flex-1 flex flex-col bg-[#eceae6]">
            <div className="px-5 pt-3 text-[13px] text-stone-500">
              {sewStatus ? <span className="font-semibold text-amber-700 animate-pulse">{sewStatus}</span> : <span>{mockup.name} · sewn-in preview</span>}
            </div>
            <div
              ref={viewportRef}
              className="flex-1 m-4 rounded-2xl bg-[#e2ded7] relative overflow-hidden"
              onWheel={e => {
                const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
                setView3(v => ({ ...v, z: Math.min(8, Math.max(0.15, v.z * f)) }));
              }}
              onMouseDown={e => {
                if (e.button !== 0) return;
                const start = toInternal(e.clientX, e.clientY);
                const movingDesign = insideDesign(start.x, start.y);
                if (movingDesign) setIsPlacing(true);
                const sx = e.clientX, sy = e.clientY;
                const ox = pos.x, oy = pos.y, vx = view3.x, vy = view3.y;
                const move = (ev: MouseEvent) => {
                  if (movingDesign) {
                    const r = mockupCanvasRef.current!.getBoundingClientRect();
                    setPos(p => ({
                      ...p,
                      x: Math.min(95, Math.max(5, ox + ((ev.clientX - sx) / r.width) * 100)),
                      y: Math.min(95, Math.max(5, oy + ((ev.clientY - sy) / r.height) * 100))
                    }));
                  } else {
                    setView3(v => ({ ...v, x: vx + (ev.clientX - sx), y: vy + (ev.clientY - sy) }));
                  }
                };
                const up = () => { setIsPlacing(false); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
                  window.addEventListener('mousemove', move);
                  window.addEventListener('mouseup', up);
                }}
              onDoubleClick={() => setView3(freshView())}
            >
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <canvas ref={mockupCanvasRef} width={COMP} height={COMP}
                  className="rounded-2xl shadow-2xl bg-white pointer-events-auto"
                  style={{ width: 560, height: 560, transform: `translate(${view3.x}px, ${view3.y}px) scale(${view3.z})`, cursor: 'move' }} />
              </div>
              {/* direct-manipulation gizmo: corners = resize, top handle = rotate */}
              {geom && stitchedUrl && garmentImg && (() => {
                const { corners, rotHandle } = designCorners();
                const sp = corners.map(c => toScreen(c.x, c.y));
                const rp = toScreen(rotHandle.x, rotHandle.y);
                const topMid = { x: (sp[0].x + sp[1].x) / 2, y: (sp[0].y + sp[1].y) / 2 };
                const cursors = ['nwse-resize', 'nesw-resize', 'nwse-resize', 'nesw-resize'];
                return (
                  <div className="absolute inset-0 pointer-events-none">
                    <svg className="absolute inset-0 w-full h-full">
                      <polygon points={sp.map(p => `${p.x},${p.y}`).join(' ')}
                        fill="none" stroke="#fff" strokeWidth="2" strokeDasharray="7 5"
                        style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,.6))' }} />
                      <line x1={topMid.x} y1={topMid.y} x2={rp.x} y2={rp.y} stroke="#fff" strokeWidth="2"
                        style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,.6))' }} />
                    </svg>
                    {sp.map((p, i) => (
                      <div key={i} data-handle onMouseDown={startResize}
                        className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full bg-white border-2 border-stone-900 shadow-lg pointer-events-auto hover:scale-125 transition-transform"
                        style={{ left: p.x, top: p.y, cursor: cursors[i] }} title="Drag to resize" />
                    ))}
                    <div data-handle onMouseDown={startRotate}
                      className="absolute w-7 h-7 -ml-3.5 -mt-3.5 rounded-full bg-white border-2 border-stone-900 shadow-xl pointer-events-auto hover:scale-110 transition-transform flex items-center justify-center"
                      style={{ left: rp.x, top: rp.y, cursor: 'grab' }} title="Drag to rotate">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1c1917" strokeWidth="2.5">
                        <path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" />
                      </svg>
                    </div>
                    <div className="absolute -translate-x-1/2 bg-stone-900/90 text-white rounded-full px-2.5 py-0.5 text-[10px] font-mono whitespace-nowrap"
                      style={{ left: (sp[2].x + sp[3].x) / 2, top: (sp[2].y + sp[3].y) / 2 + 12 }}>
                      {Math.round(pos.scale * 100)}% · {pos.rotation}°
                    </div>
                  </div>
                );
              })()}
              <div className="absolute top-2 right-2 flex items-center gap-1 bg-white/95 rounded-lg shadow px-1 py-1">
                <button title="Zoom out" className="p-1.5 hover:bg-stone-100 rounded"
                  onClick={() => setView3(v => ({ ...v, z: Math.max(0.15, v.z / 1.25) }))}><ZoomOut size={14} /></button>
                <span className="text-[11px] font-bold w-11 text-center tabular-nums">{Math.round(view3.z * 100)}%</span>
                <button title="Zoom in" className="p-1.5 hover:bg-stone-100 rounded"
                  onClick={() => setView3(v => ({ ...v, z: Math.min(8, v.z * 1.25) }))}><ZoomIn size={14} /></button>
                <button title="Reset view" className="p-1.5 hover:bg-stone-100 rounded" onClick={() => setView3(freshView())}><Maximize2 size={14} /></button>
              </div>
              {!garmentImg && <div className="absolute inset-0 flex items-center justify-center text-stone-400 text-sm">Loading garment…</div>}
            </div>
            <div className="p-4 bg-white border-t border-stone-200 flex justify-between">
              <button onClick={() => setStep(2)} className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm text-stone-600 hover:bg-stone-100">
                <ArrowLeft size={16} /> Back to stitches</button>
              <div className="flex gap-2">
                <button disabled={sewStatus !== '' || isPlacing || !garmentImg || !stitchedUrl} onClick={() => stitchedUrl && download(stitchedUrl, `${sourceName}-stitch.png`)}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm border border-stone-300 ${(sewStatus !== '' || isPlacing || !garmentImg || !stitchedUrl) ? 'opacity-40 cursor-wait' : 'hover:bg-stone-100'}`}>
                  <Download size={16} /> Stitch PNG</button>
                <button disabled={sewStatus !== '' || isPlacing || !garmentImg} onClick={() => {
                  const c = mockupCanvasRef.current;
                  if (c) download(c.toDataURL('image/png'), `${sourceName}-${mockupId}.png`);
                }} className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm bg-stone-900 text-white ${(sewStatus !== '' || isPlacing || !garmentImg) ? 'opacity-40 cursor-wait' : 'hover:bg-stone-700'}`}>
                  <Download size={16} /> Export mockup</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
