import { renderSatin } from './satin';
import { quantize } from './stitch';
import { satinPreviewDetail } from './previewDetail';
import type { StitchSettings } from '../types';

onmessage = async (event: MessageEvent<{ source: Blob; settings: StitchSettings; zoom: number; dpr: number }>) => {
  try {
    const { source, settings, zoom, dpr } = event.data;
    const image = await createImageBitmap(source);
    const base = Math.min(2, 2000 / Math.max(image.width, image.height));
    const w = Math.max(2, Math.round(image.width * base));
    const h = Math.max(2, Math.round(image.height * base));
    const src = new OffscreenCanvas(w, h);
    const ctx = src.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(image, 0, 0, w, h); image.close();
    const raw = ctx.getImageData(0, 0, w, h);
    const data = new ImageData(new Uint8ClampedArray(quantize(raw.data, w, h, settings.maxColors)), w, h);
    const detail = satinPreviewDetail(w, h, zoom, dpr);
    const canvas = renderSatin(data, settings, detail) as unknown as OffscreenCanvas;
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    postMessage({ blob, w, h, detail });
  } catch (error) {
    postMessage({ error: String(error) });
  }
};
