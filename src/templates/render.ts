import type { TemplateKind, TemplateParams } from '../types';
import { canvasToJpeg } from '../scan/decode';

export const TEMPLATE_NAMES: Record<TemplateKind, string> = { plain: '纯照片', border: '白边相纸', story: '故事卡' };

export const DEFAULT_TEMPLATE: TemplateParams = { kind: 'plain', title: '', showDate: true, showPeople: false };

export interface StoryText { title: string; date?: string; people?: string }

const FONT = '"PingFang SC","Hiragino Sans GB","Noto Sans CJK SC","Source Han Sans SC","Microsoft YaHei",system-ui,sans-serif';
const SERIF = '"Songti SC","STSong","Noto Serif CJK SC","Source Han Serif SC",serif';

/**
 * Draws the export version. The master image is never altered; borders and text
 * are added outside the image and the image keeps its aspect ratio.
 */
export function renderTemplate(img: CanvasImageSource & { width: number; height: number }, t: TemplateParams, text: StoryText): HTMLCanvasElement {
  const W = img.width, H = img.height;
  const c = document.createElement('canvas');
  const ctx = () => c.getContext('2d')!;
  if (t.kind === 'plain') {
    c.width = W; c.height = H;
    ctx().drawImage(img, 0, 0);
    return c;
  }
  const short = Math.min(W, H);
  if (t.kind === 'border') {
    const m = Math.round(short * 0.06);
    const bottom = Math.round(short * 0.16);
    c.width = W + 2 * m; c.height = H + m + bottom;
    const g = ctx();
    g.fillStyle = '#fbfaf6';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, m, m);
    return c;
  }
  // story card
  const m = Math.round(short * 0.07);
  const titleSize = Math.max(18, Math.round(W * 0.05));
  const metaSize = Math.max(12, Math.round(W * 0.03));
  const lines: { text: string; size: number; font: string; color: string }[] = [];
  const innerW = W;
  const g0 = ctx();
  const wrap = (s: string, size: number, font: string) => {
    g0.font = `${size}px ${font}`;
    const out: string[] = [];
    let line = '';
    for (const ch of [...s]) {
      if (g0.measureText(line + ch).width > innerW && line) { out.push(line); line = ch; } else line += ch;
    }
    if (line) out.push(line);
    return out;
  };
  if (text.title) for (const l of wrap(text.title, titleSize, SERIF)) lines.push({ text: l, size: titleSize, font: SERIF, color: '#1f2a24' });
  const meta = [text.date, text.people].filter(Boolean) as string[];
  for (const s of meta) for (const l of wrap(s, metaSize, FONT)) lines.push({ text: l, size: metaSize, font: FONT, color: '#5b665f' });
  const textH = lines.reduce((s, l) => s + l.size * 1.5, 0);
  c.width = W + 2 * m;
  c.height = H + 2 * m + (lines.length ? textH + m * 0.4 : 0);
  const g = ctx();
  g.fillStyle = '#f6f2e8';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, m, m);
  let y = m + H + m * 0.9;
  g.textBaseline = 'top';
  for (const l of lines) {
    g.font = `${l.size}px ${l.font}`;
    g.fillStyle = l.color;
    g.fillText(l.text, m, y);
    y += l.size * 1.5;
  }
  return c;
}

export async function exportTemplateJpeg(img: CanvasImageSource & { width: number; height: number }, t: TemplateParams, text: StoryText): Promise<Blob> {
  return canvasToJpeg(renderTemplate(img, t, text), 0.92);
}
