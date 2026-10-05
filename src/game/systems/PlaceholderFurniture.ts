/**
 * Procedural placeholder textures for shop furniture without final art.
 * Same architecture as real furniture — swap sprite later without breaking function.
 */
import Phaser from 'phaser';

export interface PlaceholderSpec {
  key: string;
  /** Fill color (hex). */
  color: number;
  /** Short label drawn on the diamond. */
  label: string;
  w?: number;
  h?: number;
}

/** Ensure a simple iso-diamond texture exists (no-op if already loaded). */
export function ensurePlaceholderTexture(scene: Phaser.Scene, spec: PlaceholderSpec): void {
  if (scene.textures.exists(spec.key)) return;
  const w = spec.w ?? 72;
  const h = spec.h ?? 88;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const cx = w / 2;
  const top = 8;
  const midY = h * 0.42;
  const bot = h - 10;
  const halfW = w * 0.42;
  // Diamond body
  g.fillStyle(spec.color, 1);
  g.beginPath();
  g.moveTo(cx, top);
  g.lineTo(cx + halfW, midY);
  g.lineTo(cx, bot);
  g.lineTo(cx - halfW, midY);
  g.closePath();
  g.fillPath();
  // Edge highlight
  g.lineStyle(2, 0xffffff, 0.35);
  g.beginPath();
  g.moveTo(cx, top);
  g.lineTo(cx + halfW, midY);
  g.lineTo(cx, bot);
  g.lineTo(cx - halfW, midY);
  g.closePath();
  g.strokePath();
  // Side shade
  g.fillStyle(0x000000, 0.22);
  g.beginPath();
  g.moveTo(cx, midY - 4);
  g.lineTo(cx + halfW, midY);
  g.lineTo(cx, bot);
  g.closePath();
  g.fillPath();
  g.generateTexture(spec.key, w, h);
  g.destroy();
  // Tiny label via canvas overlay
  try {
    const tex = scene.textures.get(spec.key);
    const src = tex.getSourceImage() as HTMLCanvasElement | HTMLImageElement;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(src as CanvasImageSource, 0, 0);
      ctx.fillStyle = 'rgba(255,240,255,0.92)';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const words = spec.label.split(' ');
      const line = words.length <= 2 ? spec.label : words.slice(0, 2).join(' ');
      ctx.fillText(line.slice(0, 10), cx, midY - 2, w - 12);
      if (scene.textures.exists(spec.key)) scene.textures.remove(spec.key);
      scene.textures.addCanvas(spec.key, canvas);
    }
  } catch {
    // diamond without text is fine
  }
}

/** Batch-create placeholders listed in the shop catalog that lack real art. */
export function ensureShopPlaceholders(
  scene: Phaser.Scene,
  items: Array<{ sprite: string; name: string; placeholderColor?: number }>
): void {
  const palette = [
    0xc45c26, 0x8b5a2b, 0x5c7a3a, 0x3a6a8b, 0x6a3a8b, 0x8b3a5c, 0xb8860b, 0x4a5568, 0x2f855a,
    0x9b2c2c, 0x2b6cb0, 0x744210, 0x553c9a, 0x285e61, 0x975a16,
  ];
  let i = 0;
  for (const it of items) {
    if (scene.textures.exists(it.sprite)) continue;
    const color = it.placeholderColor ?? palette[i % palette.length];
    ensurePlaceholderTexture(scene, {
      key: it.sprite,
      color,
      label: it.name,
    });
    i += 1;
  }
}
