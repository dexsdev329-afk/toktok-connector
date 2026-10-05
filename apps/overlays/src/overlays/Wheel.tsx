import { WheelOverlayOptionsSchema, wheelSliceColor } from '@toktok/shared';
import { useEffect, useRef, useState } from 'react';

export interface WheelSpin {
  id: string;
  index: number;
  label: string;
  durationMs: number;
  by?: string;
}

const R = 100;

/** Point on the circle; angle in degrees, 0 = top, clockwise. */
function polar(angle: number, radius: number): [number, number] {
  const rad = ((angle - 90) * Math.PI) / 180;
  return [radius * Math.cos(rad), radius * Math.sin(rad)];
}

function slicePath(start: number, end: number): string {
  const [x1, y1] = polar(start, R);
  const [x2, y2] = polar(end, R);
  const large = end - start > 180 ? 1 : 0;
  return `M0 0 L${x1} ${y1} A${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`;
}

export function Wheel(props: { options: Record<string, unknown>; spin: WheelSpin | null }) {
  const opts = WheelOverlayOptionsSchema.parse(props.options);
  const n = opts.segments.length;
  const slice = 360 / n;
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState<WheelSpin | null>(null);
  const [spinning, setSpinning] = useState(false);
  const rotationRef = useRef(0);
  const { spin } = props;

  useEffect(() => {
    if (!spin) return;
    // Land the pointer (top) inside the chosen slice, away from its edges.
    const center = (spin.index + 0.5) * slice;
    const jitter = (Math.random() - 0.5) * slice * 0.6;
    const base = Math.ceil(rotationRef.current / 360) * 360;
    const target = base + 360 * Math.max(3, Math.round(spin.durationMs / 1000)) + (360 - center) + jitter;
    rotationRef.current = target;
    setResult(null);
    setSpinning(true);
    // Two frames so the browser applies the transition from the previous angle.
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setRotation(target)));
    const done = setTimeout(() => {
      setSpinning(false);
      setResult(spin);
    }, spin.durationMs);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(done);
    };
  }, [spin, slice]);

  const hidden = opts.hideWhenIdle && !spinning && !result;
  useEffect(() => {
    if (!opts.hideWhenIdle || !result) return;
    const t = setTimeout(() => setResult(null), 2500);
    return () => clearTimeout(t);
  }, [result, opts.hideWhenIdle]);

  return (
    <div className="wheel" style={{ visibility: hidden ? 'hidden' : 'visible' }}>
      {opts.title && <div className="wheel-title">{opts.title}</div>}
      <div className="wheel-box">
        <div className="wheel-pointer" />
        <svg
          viewBox="-104 -104 208 208"
          className="wheel-svg"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition:
              spinning && spin ? `transform ${spin.durationMs}ms cubic-bezier(0.12, 0.8, 0.18, 1)` : 'none',
          }}
        >
          {opts.segments.map((s, i) => {
            const start = i * slice;
            const mid = start + slice / 2;
            const [tx, ty] = polar(mid, R * 0.62);
            return (
              <g key={i}>
                <path
                  d={slicePath(start, start + slice)}
                  fill={s.color ?? wheelSliceColor(i, n)}
                  stroke="rgba(0,0,0,.35)"
                />
                <text
                  x={tx}
                  y={ty}
                  // Radial text, flipped on the left half so it is never upside down.
                  transform={`rotate(${mid > 180 ? mid + 90 : mid - 90} ${tx} ${ty})`}
                  className="wheel-label"
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {s.label.length > 14 ? `${s.label.slice(0, 13)}…` : s.label}
                </text>
              </g>
            );
          })}
          <circle r={R} fill="none" stroke="var(--primary)" strokeWidth="4" />
          <circle r="12" fill="var(--primary)" />
        </svg>
      </div>
      {result && (
        <div className="card wheel-result enter">
          {result.label}
          {result.by && <div className="wheel-by">{result.by}</div>}
        </div>
      )}
    </div>
  );
}
