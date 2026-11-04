import { useCallback, useEffect, useRef, useState } from "react";

export type Clock = {
  t: number; playing: boolean; speed: number;
  play: () => void; pause: () => void; toggle: () => void;
  seek: (t: number) => void; setSpeed: (s: number) => void;
};

export const SPEEDS = [1, 4, 16, 64];

/**
 * Local replay clock in session milliseconds. Kept behind this small interface so a
 * watch room can later drive the same replay from a shared clock instead.
 */
export function useReplayClock(start: number, end: number, initialSpeed = 4): Clock {
  const [t, setT] = useState(start);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(initialSpeed);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  useEffect(() => { setT(start); setPlaying(false); }, [start, end]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(250, now - last); // don't jump after the tab was hidden
      last = now;
      setT((prev) => {
        const next = prev + dt * speedRef.current;
        if (next >= end) { setPlaying(false); return end; }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, end]);

  const seek = useCallback((v: number) => setT(Math.max(start, Math.min(end, v))), [start, end]);
  return {
    t, playing, speed,
    play: () => { if (t >= end) setT(start); setPlaying(true); },
    pause: () => setPlaying(false),
    toggle: () => (playing ? setPlaying(false) : (t >= end && setT(start), setPlaying(true))),
    seek,
    setSpeed: setSpeedState,
  };
}
