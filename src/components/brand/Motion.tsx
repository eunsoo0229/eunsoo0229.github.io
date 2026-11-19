// Restrained motion for the Index identity: content rises once into view, numbers count up once.
// Both respect prefers-reduced-motion (show the end state immediately).
import { createElement, useEffect, useRef, useState, type ElementType, type HTMLAttributes, type ReactNode } from 'react';

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function Reveal({ as = 'div', children, className = '', ...rest }: { as?: ElementType; children: ReactNode; className?: string } & HTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(() => reduced() || typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (shown || !ref.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [shown]);
  return createElement(as, { ref, className: `mx-reveal${shown ? ' is-in' : ''} ${className}`, ...rest }, children);
}

export function CountUp({ to, duration = 900 }: { to: number; duration?: number }) {
  const [v, setV] = useState(() => (reduced() ? to : 0));
  const started = useRef(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (reduced()) {
      setV(to);
      return;
    }
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const run = () => {
      if (started.current) return;
      started.current = true;
      const t0 = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        setV(Math.round(to * eased));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    if (typeof IntersectionObserver === 'undefined') run();
    else {
      const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (run(), io.disconnect()));
      io.observe(el);
      return () => {
        io.disconnect();
        cancelAnimationFrame(raf);
      };
    }
    return () => cancelAnimationFrame(raf);
  }, [to, duration]);
  // keep the final value correct if the data changes after the animation ran
  useEffect(() => {
    if (started.current) setV(to);
  }, [to]);
  return <span ref={ref} className="mx-num">{v.toLocaleString('ko-KR')}</span>;
}
