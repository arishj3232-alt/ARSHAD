import type { RefObject } from "react";
import { Mic, Video, Lock, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRecordingClock } from "@/lib/formatDuration";
import type { HoldSwipeMode } from "@/hooks/useHoldSwipeRecording";

type Props = {
  open: boolean;
  mode: HoldSwipeMode;
  locked: boolean;
  seconds: number;
  maxSeconds: number;
  bars: number[];
  error: string | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  onLockedSend: () => void;
  onLockedCancel: () => void;
};

export default function HoldSwipeRecordOverlay({
  open,
  mode,
  locked,
  seconds,
  maxSeconds,
  bars,
  error,
  videoRef,
  onLockedSend,
  onLockedCancel,
}: Props) {
  if (!open && !error) return null;

  const timeStr = formatRecordingClock(seconds);
  const progress = maxSeconds > 0 ? (seconds / maxSeconds) * 100 : 0;

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-[85] bg-black/55 backdrop-blur-[2px] touch-none"
          style={{ touchAction: "none" }}
          aria-hidden
        />
      )}

      {open && (
        <div
          className="fixed bottom-0 left-0 right-0 z-[90] flex flex-col items-center pb-[max(5.5rem,env(safe-area-inset-bottom,0px)+4.5rem)] pt-6 px-4 pointer-events-none"
          style={{ touchAction: "none" }}
        >
          <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-white/10 bg-[#12121c]/95 shadow-2xl backdrop-blur-xl px-4 py-4">
            <div className="flex items-center gap-3 mb-3">
              {mode === "audio" ? (
                <Mic className="w-5 h-5 text-pink-400 shrink-0" />
              ) : (
                <Video className="w-5 h-5 text-sky-400 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-pink-500 to-violet-500 transition-all duration-300"
                    style={{ width: `${Math.min(100, progress)}%` }}
                  />
                </div>
              </div>
              <span className="text-white/80 font-mono text-xs tabular-nums shrink-0 animate-pulse">{timeStr}</span>
            </div>

            {mode === "audio" ? (
              <div className="flex gap-0.5 items-end h-10 mb-2">
                {bars.map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-full bg-rose-400/90 transition-all duration-75"
                    style={{ height: `${h}px` }}
                  />
                ))}
              </div>
            ) : (
              <div className="relative w-full aspect-video max-h-40 rounded-xl overflow-hidden bg-black mb-2 border border-white/10">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={cn("w-full h-full object-cover", "scale-x-[-1]")}
                />
              </div>
            )}

            {!locked && (
              <p className="text-center text-xs text-white/45 animate-pulse mb-1">Swipe up to lock</p>
            )}
            {locked && (
              <p className="text-center text-sm text-emerald-400/90 flex items-center justify-center gap-1.5 mb-3">
                <Lock className="w-4 h-4" />
                Locked — recording
              </p>
            )}

            {locked && (
              <div className="flex gap-3 justify-center">
                <button
                  type="button"
                  onClick={onLockedCancel}
                  className="flex items-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white px-5 py-2.5 text-sm font-medium transition active:scale-[0.98]"
                >
                  <X className="w-4 h-4" />
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onLockedSend}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 text-sm font-medium transition active:scale-[0.98]"
                >
                  <Send className="w-4 h-4" />
                  Send
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {error && !open && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[95] px-4 py-2 rounded-xl bg-rose-950/90 border border-rose-500/40 text-rose-200 text-sm max-w-[90vw] text-center">
          {error}
        </div>
      )}
    </>
  );
}
