import { useEffect, useRef } from 'react';

declare global {
  interface Window { Charts?: { bars: (el: HTMLElement, o: Record<string, unknown>) => void; fmt: Record<string, unknown> } }
}

/** Columns drawn by the taste skill's charts.js (square bars, round ticks, one hue on the highlighted bar). */
export function Bars({ labels, values, highlight, format, label, annotations, height = 220 }: {
  labels: string[]; values: number[]; highlight?: number | number[] | null; format: (v: number) => string; label: string;
  annotations?: { at: number; label: string; short?: string }[]; height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let tries = 0;
    const draw = () => {
      if (!ref.current) return;
      if (!window.Charts) { if (tries++ < 40) setTimeout(draw, 50); return; }
      window.Charts.bars(ref.current, { labels, values, highlight, format, height, annotations });
    };
    draw();
  }, [labels, values, highlight, format, height, annotations]);
  return <div ref={ref} className="chart" role="img" aria-label={label} style={{ minHeight: height }} />;
}
