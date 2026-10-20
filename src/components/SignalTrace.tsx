"use client";

import { useEffect, useRef } from "react";

/** A live trace of a recording's signal: it moves while the voice speaks, and tears where the signal breaks up. */
export function SignalTrace({ torn, talking, className }: { torn: boolean; talking: () => boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const tornRef = useRef(torn);
  const talkingRef = useRef(talking);
  useEffect(() => {
    tornRef.current = torn;
    talkingRef.current = talking;
  }, [torn, talking]);
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    let raf = 0;
    const bars = 72;
    const level = new Float32Array(bars);
    const draw = (t: number) => {
      const w = c.width, h = c.height;
      g.clearRect(0, 0, w, h);
      const voiced = talkingRef.current();
      const rip = tornRef.current;
      for (let i = 0; i < bars; i++) {
        const voice = voiced ? 0.25 + 0.75 * Math.abs(Math.sin(t / 90 + i * 0.7) * Math.sin(t / 233 + i * 0.31)) * Math.random() : 0.04;
        const target = rip && Math.random() < 0.18 ? (Math.random() < 0.5 ? 0 : 1) : voice;
        level[i] += (target - level[i]) * 0.35;
        const bh = Math.max(1, level[i] * (h - 4));
        g.fillStyle = rip && Math.random() < 0.08 ? "#ff4747" : "#47ffa9";
        g.fillRect(i * (w / bars) + (rip ? (Math.random() - 0.5) * 3 : 0), (h - bh) / 2, w / bars - 1.5, bh);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} width={420} height={44} className={className} />;
}
