import { useEffect, useRef, useState } from 'react';

/* ---------- 数字滚动动画：值变化时平滑插值滚动 ---------- */
export function AnimatedNumber({
  value,
  prefix = '',
  suffix = '',
  decimals = 1,
  className,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    fromRef.current = value;
    let raf = 0;
    const start = performance.now();
    const dur = 550;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      // easeOutCubic：先快后慢，滚动自然
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (value - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return (
    <span className={className}>
      {prefix}{display.toFixed(decimals)}{suffix}
    </span>
  );
}
