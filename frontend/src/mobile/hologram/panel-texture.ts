/**
 * Text and HUD graphics for holographic panels, drawn on a 2D canvas and
 * used as a texture. System fonts only: no font downloads (the server's CSP
 * blocks third-party fonts, and it keeps the builder working offline).
 */
import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';

export const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

export interface PanelCanvas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: CanvasTexture;
  W: number;
  H: number;
}

/** Canvas sized to the panel's aspect ratio, ~512px wide (crisp on a 3x iPhone at typical sizes). */
export function createPanelCanvas(aspect: number): PanelCanvas {
  const W = 512;
  const H = Math.max(64, Math.round(W / Math.max(0.2, aspect)));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  return { canvas, ctx, texture, W, H };
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Wrap `text` to lines that fit `maxWidth`, at most `maxLines`. */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width <= maxWidth || !line) line = test;
    else {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,2}$/, '…');
  }
  return lines;
}

/** Translucent panel fill with scanlines and a top accent bar. */
export function drawPanelBase(p: PanelCanvas, color: string, t: number) {
  const { ctx, W, H } = p;
  ctx.clearRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, rgba(color, 0.22));
  g.addColorStop(1, rgba(color, 0.06));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = rgba(color, 0.07);
  for (let y = (t * 18) % 6; y < H; y += 6) ctx.fillRect(0, y, W, 1);
  ctx.fillStyle = rgba(color, 0.85);
  ctx.fillRect(W * 0.06, H * 0.07, W * 0.18, 3);
}

export function drawTitle(p: PanelCanvas, text: string, color: string, size = 0.11) {
  const { ctx, W, H } = p;
  ctx.fillStyle = '#e6f6ff';
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.font = `700 ${Math.round(Math.min(H * size * 1.6, W * size))}px ${FONT}`;
  ctx.textBaseline = 'top';
  ctx.fillText(text.toUpperCase().slice(0, 40), W * 0.06, H * 0.13, W * 0.88);
  ctx.shadowBlur = 0;
}
