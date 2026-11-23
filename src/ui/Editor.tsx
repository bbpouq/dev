import { useEffect, useRef, useState } from 'preact/hooks';
import type { EditParams, Pt, Quad } from '../types';
import { autoCorners, renderPreview, type Source } from '../scan/render';
import { pixelsToCanvas } from '../scan/decode';
import { FULL_QUAD, isConvexQuad } from '../scan/geometry';
import { toast } from './store';

const CORNER_NAMES = ['左上角', '右上角', '右下角', '左下角'];

export function resetParams(): EditParams {
  return { corners: FULL_QUAD.map((p) => [...p]) as Quad, rotation: 0, color: 'original', brightness: 0, contrast: 0 };
}

/** Four-corner perspective editor with rotation, colour and tone controls. */
export function Editor(props: { source: Source; params: EditParams; onChange: (p: EditParams) => void }) {
  const { source, params } = props;
  const W = source.preview.width, H = source.preview.height;
  const holder = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const srcCanvas = useRef<HTMLCanvasElement | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [tone, setTone] = useState(false);
  const [scale, setScale] = useState(1); // viewBox units per CSS px

  useEffect(() => {
    const c = pixelsToCanvas(source.preview);
    c.className = 'src-canvas';
    srcCanvas.current = c;
    const h = holder.current!;
    h.querySelector('.src-canvas')?.remove();
    h.prepend(c);
  }, [source]);

  useEffect(() => {
    const measure = () => { const r = svgRef.current?.getBoundingClientRect(); if (r?.width) setScale(W / r.width); };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined;
    ro?.observe(svgRef.current!);
    return () => ro?.disconnect();
  }, [W]);

  // Debounced result preview through the same chain as the master.
  useEffect(() => {
    const t = setTimeout(() => {
      if (!isConvexQuad(params.corners)) return;
      const c = renderPreview(source, params, 640);
      c.setAttribute('aria-label', '校正效果预览');
      const el = resultRef.current;
      if (el) { el.replaceChildren(c); }
    }, drag === null ? 60 : 250);
    return () => clearTimeout(t);
  }, [source, params, drag === null]);

  const set = (patch: Partial<EditParams>) => props.onChange({ ...params, ...patch });

  const moveCorner = (i: number, pt: Pt) => {
    const c = params.corners.map((p) => [...p]) as Quad;
    c[i] = [Math.max(0, Math.min(1, pt[0])), Math.max(0, Math.min(1, pt[1]))];
    if (!isConvexQuad(c)) return;
    set({ corners: c, autoDetected: false });
  };

  const toNorm = (e: PointerEvent): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };

  const drawLoupe = (pt: Pt) => {
    const lc = loupeRef.current, sc = srcCanvas.current;
    if (!lc || !sc) return;
    const g = lc.getContext('2d')!;
    const size = lc.width, zoom = 3, span = size / zoom * (W / (svgRef.current!.getBoundingClientRect().width || W));
    g.fillStyle = '#000';
    g.fillRect(0, 0, size, size);
    g.drawImage(sc, pt[0] * W - span / 2, pt[1] * H - span / 2, span, span, 0, 0, size, size);
    g.strokeStyle = '#7fe0a6';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(size / 2, 0); g.lineTo(size / 2, size); g.moveTo(0, size / 2); g.lineTo(size, size / 2);
    g.stroke();
  };

  const onDown = (i: number) => (e: PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDrag(i);
    drawLoupe(params.corners[i]);
  };
  const onMove = (i: number) => (e: PointerEvent) => {
    if (drag !== i) return;
    const pt = toNorm(e);
    moveCorner(i, pt);
    drawLoupe(pt);
  };
  const onUp = () => setDrag(null);
  const onKey = (i: number) => (e: KeyboardEvent) => {
    const step = (e.shiftKey ? 10 : 1);
    const d: Record<string, Pt> = { ArrowLeft: [-step / W, 0], ArrowRight: [step / W, 0], ArrowUp: [0, -step / H], ArrowDown: [0, step / H] };
    const v = d[e.key];
    if (!v) return;
    e.preventDefault();
    const p = params.corners[i];
    moveCorner(i, [p[0] + v[0], p[1] + v[1]]);
  };

  const poly = params.corners.map(([x, y]) => `${x * W},${y * H}`).join(' ');
  const r = 11 * scale, hit = 24 * scale;

  return (
    <div class="editor">
      <div class="stage" ref={holder} style={{ aspectRatio: `${W} / ${H}` }}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} class="overlay" role="group" aria-label="四角修边：拖动或用方向键微调（Shift 加速）">
          <path d={`M0,0H${W}V${H}H0Z M${poly.split(' ').join(' L')}Z`} fill="rgba(0,0,0,.45)" fill-rule="evenodd" />
          <polygon points={poly} fill="none" stroke="#7fe0a6" stroke-width={2 * scale} />
          {params.corners.map(([x, y], i) => (
            <g class={'handle' + (drag === i ? ' active' : '')} tabIndex={0} role="slider" aria-label={CORNER_NAMES[i]}
              aria-valuetext={`${Math.round(x * 100)}%, ${Math.round(y * 100)}%`}
              onPointerDown={onDown(i) as any} onPointerMove={onMove(i) as any} onPointerUp={onUp} onPointerCancel={onUp}
              onKeyDown={onKey(i) as any}>
              <circle cx={x * W} cy={y * H} r={hit} fill="transparent" />
              <circle cx={x * W} cy={y * H} r={r} fill="#fff" stroke="#24493a" stroke-width={3 * scale} />
            </g>
          ))}
        </svg>
        <canvas ref={loupeRef} class="loupe" width={120} height={120} style={{ display: drag === null ? 'none' : 'block' }} />
        <div class="result" ref={resultRef} title="校正效果预览" />
      </div>

      <div class="chips wrap">
        <button class="chip" onClick={() => {
          const q = autoCorners(source);
          if (q) set({ corners: q, autoDetected: true });
          else { set({ corners: FULL_QUAD.map((p) => [...p]) as Quad, autoDetected: false }); toast('没有找到照片边缘，已显示整张图片，请拖动四角修边。'); }
        }}>自动找边</button>
        <button class="chip" onClick={() => set({ rotation: (((params.rotation + 90) % 360) as EditParams['rotation']) })}>旋转 90°</button>
        <button class={'chip' + (params.color === 'original' ? ' on' : '')} aria-pressed={params.color === 'original'} onClick={() => set({ color: 'original' })}>原色</button>
        <button class={'chip' + (params.color === 'bw' ? ' on' : '')} aria-pressed={params.color === 'bw'} onClick={() => set({ color: 'bw' })}>黑白</button>
        <button class={'chip' + (tone ? ' on' : '')} aria-expanded={tone} onClick={() => setTone(!tone)}>亮度/对比度</button>
        <button class="chip" onClick={() => props.onChange(resetParams())}>重置</button>
      </div>
      {tone && (
        <div class="stack tight tone">
          <label class="slider">亮度 <input type="range" min={-100} max={100} value={params.brightness}
            onInput={(e) => set({ brightness: +(e.target as HTMLInputElement).value })} /> <output>{params.brightness}</output></label>
          <label class="slider">对比度 <input type="range" min={-100} max={100} value={params.contrast}
            onInput={(e) => set({ contrast: +(e.target as HTMLInputElement).value })} /> <output>{params.contrast}</output></label>
        </div>
      )}
    </div>
  );
}
