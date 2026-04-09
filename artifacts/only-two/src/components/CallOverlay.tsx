import { useRef, useState, useEffect } from "react";
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Video,
  VideoOff,
  FlipHorizontal,
  Minimize2,
  Maximize2,
  PhoneCall,
} from "lucide-react";
import { cn, formatCallDuration } from "@/lib/utils";
import type { CallType, CallStatus } from "@/hooks/useWebRTC";

type Props = {
  callStatus: CallStatus;
  callType: CallType;
  isMuted: boolean;
  isCameraOff: boolean;
  callDuration: number;
  isMinimized: boolean;
  setIsMinimized: (v: boolean) => void;
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
  onEnd: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onSwitchCamera: () => void;
  onAnswer: () => void;
  onReject: () => void;
  otherName: string;
};

export default function CallOverlay({
  callStatus,
  callType,
  isMuted,
  isCameraOff,
  callDuration,
  isMinimized,
  setIsMinimized,
  localVideoRef,
  remoteVideoRef,
  onEnd,
  onToggleMute,
  onToggleCamera,
  onSwitchCamera,
  onAnswer,
  onReject,
  otherName,
}: Props) {
  const [pos, setPos] = useState({ x: 20, y: 20 });
  const dragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });

  const onMouseDown = (e: React.MouseEvent) => {
    if (!isMinimized) return;
    dragging.current = true;
    startPos.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setPos({ x: e.clientX - startPos.current.x, y: e.clientY - startPos.current.y });
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  if (callStatus === "incoming") {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center">
        <div className="text-center animate-scale-in">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center mx-auto mb-6 shadow-2xl animate-pulse">
            <PhoneCall className="w-10 h-10 text-white" />
          </div>
          <p className="text-white/60 text-sm mb-1">
            {callType === "video" ? "Incoming video call" : "Incoming voice call"}
          </p>
          <h2 className="text-white text-2xl font-bold mb-8">{otherName}</h2>
          <div className="flex justify-center gap-8">
            <button
              onClick={onReject}
              className="w-16 h-16 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center transition-all active:scale-95 shadow-lg"
              data-testid="button-reject-call"
            >
              <PhoneOff className="w-6 h-6" />
            </button>
            <button
              onClick={onAnswer}
              className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center transition-all active:scale-95 shadow-lg"
              data-testid="button-answer-call"
            >
              <Phone className="w-6 h-6" />
            </button>
          </div>
        </div>
        <style>{`
          @keyframes scale-in {
            from { transform: scale(0.8); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
          }
          .animate-scale-in { animation: scale-in 0.3s ease-out; }
        `}</style>
      </div>
    );
  }

  if (callStatus !== "calling" && callStatus !== "connected") return null;

  if (isMinimized) {
    return (
      <div
        className="fixed z-50 w-48 rounded-2xl overflow-hidden shadow-2xl cursor-grab active:cursor-grabbing bg-black border border-white/10"
        style={{ left: pos.x, top: pos.y }}
        onMouseDown={onMouseDown}
      >
        {callType === "video" ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            muted={false}
            className="w-full h-32 object-cover"
          />
        ) : (
          <div className="w-full h-20 bg-gradient-to-br from-pink-900 to-violet-900 flex items-center justify-center">
            <Phone className="w-6 h-6 text-white/50" />
          </div>
        )}
        <div className="bg-black/80 px-3 py-2 flex items-center justify-between">
          <span className="text-white text-xs font-mono">{formatCallDuration(callDuration)}</span>
          <div className="flex gap-1">
            <button
              onClick={() => setIsMinimized(false)}
              className="p-1.5 rounded-lg bg-white/10 text-white hover:bg-white/20"
            >
              <Maximize2 className="w-3 h-3" />
            </button>
            <button
              onClick={onEnd}
              className="p-1.5 rounded-lg bg-rose-500 text-white hover:bg-rose-600"
            >
              <PhoneOff className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0f] flex flex-col">
      {callType === "video" ? (
        <div className="flex-1 relative bg-black">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            muted={false}
            className="w-full h-full object-cover"
          />
          <div className="absolute top-4 right-4 w-36 h-24 rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-gradient-to-b from-[#0a0a0f] to-[#150d1f]">
          <div className="text-center">
            <div className="w-28 h-28 rounded-full bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center mx-auto mb-4 shadow-2xl shadow-pink-500/30">
              <Phone className="w-12 h-12 text-white" />
            </div>
            <h2 className="text-white text-2xl font-bold mb-1">{otherName}</h2>
            <p className="text-white/40 text-sm">
              {callStatus === "calling" ? "Calling..." : formatCallDuration(callDuration)}
            </p>
          </div>
        </div>
      )}

      {callType === "video" && callStatus === "connected" && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/50 backdrop-blur-sm rounded-full px-4 py-1.5">
          <span className="text-white text-sm font-mono">{formatCallDuration(callDuration)}</span>
        </div>
      )}

      <div className="bg-black/80 backdrop-blur-xl px-6 py-6 flex items-center justify-center gap-4">
        <button
          onClick={onToggleMute}
          className={cn(
            "w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95",
            isMuted ? "bg-white/20 text-white" : "bg-white/10 text-white hover:bg-white/20"
          )}
          data-testid="button-toggle-mute"
        >
          {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </button>

        {callType === "video" && (
          <>
            <button
              onClick={onToggleCamera}
              className={cn(
                "w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95",
                isCameraOff ? "bg-white/20 text-white" : "bg-white/10 text-white hover:bg-white/20"
              )}
              data-testid="button-toggle-camera"
            >
              {isCameraOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
            </button>
            <button
              onClick={onSwitchCamera}
              className="w-14 h-14 rounded-full bg-white/10 text-white hover:bg-white/20 flex items-center justify-center transition-all active:scale-95"
              data-testid="button-switch-camera"
            >
              <FlipHorizontal className="w-5 h-5" />
            </button>
          </>
        )}

        <button
          onClick={onEnd}
          className="w-16 h-16 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center transition-all active:scale-95 shadow-lg shadow-rose-500/30"
          data-testid="button-end-call"
        >
          <PhoneOff className="w-6 h-6" />
        </button>

        <button
          onClick={() => setIsMinimized(true)}
          className="w-14 h-14 rounded-full bg-white/10 text-white hover:bg-white/20 flex items-center justify-center transition-all active:scale-95"
        >
          <Minimize2 className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
