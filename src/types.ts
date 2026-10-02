export type StitchType = 'tatami' | 'satin' | 'mix';

export interface StitchSettings {
  /** tatami = flat woven fill (big areas) · satin = glossy columns (text / small shapes) · mix = tatami fill + satin border */
  type: StitchType;
  /** stitch direction in degrees */
  angle: number;
  /** 1 (airy) – 10 (very dense) */
  density: number;
  /** 1 (fine) – 10 (chunky) thread */
  thickness: number;
  /** 0 (matte cotton) – 100 (glossy rayon) */
  sheen: number;
  /** satin edge around the design */
  border: boolean;
  /** border width px at working scale */
  borderWidth: number;
  /** max thread colours — 0 = keep full colour */
  maxColors: number;
  /** Raised perimeter stitching, using the artwork's existing edge colours. */
  outline?: boolean;
  /** Width at a 1000px working dimension. */
  outlineWidth?: number;
  /** Include enclosed transparent openings as well as the exterior perimeter. */
  outlineHoles?: boolean;
}

export const DEFAULT_STITCH: StitchSettings = {
  type: 'mix',
  angle: 45,
  density: 6,
  thickness: 5,
  sheen: 55,
  border: true,
  borderWidth: 7,
  maxColors: 0,
  outline: false,
  outlineWidth: 4,
  outlineHoles: true
};

export const STITCH_CARDS: { id: StitchType; name: string; desc: string }[] = [
  { id: 'tatami', name: 'Tatami Fill', desc: 'Woven flat fill · logos & big areas' },
  { id: 'satin', name: 'Satin Stitch', desc: 'Glossy columns · text & small details' },
  { id: 'mix', name: 'Classic Mix', desc: 'Tatami inside + satin edge' }
];
