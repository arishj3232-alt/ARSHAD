import { useEffect, useRef, useState } from "react";
import type { CursorData } from "@/hooks/useCursorPresence";

type Props = {
  cursors: CursorData[];
};

const COLORS = [
  "from-pink-500 to-rose-500",
  "from-violet-500 to-purple-600",
  "from-cyan-500 to-blue-500",
  "from-emerald-500 to-teal-500",
];
const NAME_VELOCITY_THRESHOLD = 0.08;
const NAME_IDLE_FRAMES_REQUIRED = 12;
const NAME_PROXIMITY_THRESHOLD_PCT = 4.5;

export default function CursorPresence({ cursors }: Props) {
  const [smoothed, setSmoothed] = useState<Array<CursorData & { opacity: number }>>([]);
  const targetRef = useRef<Record<string, CursorData>>({});
  const posRef = useRef<Record<string, CursorData & { opacity: number }>>({});
  const rafRef = useRef<number | null>(null);
  const idleFramesRef = useRef<Record<string, number>>({});
  const showNameRef = useRef<Record<string, boolean>>({});
  const mousePctRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const nextTargets: Record<string, CursorData> = {};
    for (const c of cursors) {
      nextTargets[c.userId] = c;
      if (!posRef.current[c.userId]) {
        posRef.current[c.userId] = { ...c, opacity: 1 };
      }
    }
    targetRef.current = nextTargets;
  }, [cursors]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mousePctRef.current = {
        x: (e.clientX / window.innerWidth) * 100,
        y: (e.clientY / window.innerHeight) * 100,
      };
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  useEffect(() => {
    const tick = () => {
      const next: Array<CursorData & { opacity: number }> = [];

      Object.entries(posRef.current).forEach(([uid, prev]) => {
        const target = targetRef.current[uid];

        if (target) {
          const x = prev.x + (target.x - prev.x) * 0.2;
          const y = prev.y + (target.y - prev.y) * 0.2;
          const opacity = prev.opacity + (1 - prev.opacity) * 0.2;
          const velocity = Math.hypot(target.x - prev.x, target.y - prev.y);
          const isIdle = velocity < NAME_VELOCITY_THRESHOLD;
          const idleFrames = isIdle ? (idleFramesRef.current[uid] ?? 0) + 1 : 0;
          idleFramesRef.current[uid] = idleFrames;
          const m = mousePctRef.current;
          const isNearMouse = !!m && Math.hypot(m.x - x, m.y - y) < NAME_PROXIMITY_THRESHOLD_PCT;
          showNameRef.current[uid] = idleFrames >= NAME_IDLE_FRAMES_REQUIRED || isNearMouse;
          const smoothedCursor: CursorData & { opacity: number } = { ...target, x, y, opacity };
          posRef.current[uid] = smoothedCursor;
          next.push(smoothedCursor);
          return;
        }

        // Fade stale cursor out smoothly before removal.
        const fadedOpacity = Math.max(0, prev.opacity - 0.08);
        if (fadedOpacity <= 0.01) {
          delete posRef.current[uid];
          delete idleFramesRef.current[uid];
          delete showNameRef.current[uid];
          return;
        }
        const faded: CursorData & { opacity: number } = { ...prev, opacity: fadedOpacity };
        posRef.current[uid] = faded;
        next.push(faded);
      });

      setSmoothed(next);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <>
      {smoothed.map((cursor, i) => (
        <div
          key={cursor.userId}
          className="pointer-events-none fixed z-40"
          style={{
            left: `${cursor.x}%`,
            top: `${cursor.y}%`,
            transform: "translate(-2px, -2px)",
            opacity: cursor.opacity,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="drop-shadow-lg">
            <defs>
              <linearGradient id={`cursor-grad-${i}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={i % 2 === 0 ? "#ec4899" : "#8b5cf6"} />
                <stop offset="100%" stopColor={i % 2 === 0 ? "#f43f5e" : "#7c3aed"} />
              </linearGradient>
            </defs>
            <path
              d="M2 2L16 9L9.5 11L7 17L2 2Z"
              fill={`url(#cursor-grad-${i})`}
              stroke="white"
              strokeWidth="1"
              strokeLinejoin="round"
            />
          </svg>
          <div
            className={`absolute left-4 top-0 bg-gradient-to-r ${COLORS[i % COLORS.length]} text-white text-xs px-2 py-0.5 rounded-full whitespace-nowrap shadow-lg transition-opacity ${
              showNameRef.current[cursor.userId]
                ? "opacity-100 duration-200 delay-100"
                : "opacity-0 duration-100 delay-0"
            }`}
          >
            {cursor.name}
          </div>
        </div>
      ))}
    </>
  );
}
