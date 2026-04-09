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

export default function CursorPresence({ cursors }: Props) {
  return (
    <>
      {cursors.map((cursor, i) => (
        <div
          key={cursor.userId}
          className="pointer-events-none fixed z-40 transition-all duration-75"
          style={{
            left: `${cursor.x}%`,
            top: `${cursor.y}%`,
            transform: "translate(-2px, -2px)",
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
            className={`absolute left-4 top-0 bg-gradient-to-r ${COLORS[i % COLORS.length]} text-white text-xs px-2 py-0.5 rounded-full whitespace-nowrap shadow-lg`}
          >
            {cursor.name}
          </div>
        </div>
      ))}
    </>
  );
}
