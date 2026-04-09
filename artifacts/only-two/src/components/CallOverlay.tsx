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
  Volume2,
  VolumeX,
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
  remoteAudioRef: React.RefObject<HTMLAudioElement | null>;
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
  remoteAudioRef,
  onEnd,
  onToggleMute,
  onToggleCamera,
  onSwitchCamera,
  onAnswer,
  onReject,
  otherName,
}: Props) {
  const [pos, setPos] = useState({ x: 20, y: 20 });
  const [isSpeakerOff, setIsSpeakerOff] = useState(false);
  const dragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });

  const toggleSpeaker = () => {
    setIsSpeakerOff((s) => {
      const next = !s;
      if (remoteVideoRef.current) remoteVideoRef.current.muted = next;
      if (remoteAudioRef.current) remoteAudioRef.current.muted = next;
      return next;
    });
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (!isMinimized) return;
    dragging.current = true;
    startPos.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (!isMinimized) return;
    dragging.current = true;
    startPos.current = {
      x: e.touches[0].clientX - pos.x,
      y: e.touches[0].clientY - pos.y,
    };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setPos({ x: e.clientX - startPos.current.x, y: e.clientY - startPos.current.y });
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!dragging.current) return;
      setPos({
        x: e.touches[0].clientX - startPos.current.x,
        y: e.touches[0].clientY - startPos.current.y,
      });
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onUp);
    };
  }, []);

  if (callStatus === "idle") return null;

  return (
    <>
      {/* Hidden audio element — always present during a call to play remote audio */}
      <audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
        muted={isSpeakerOff}
        style={{ display: "none" }}
      />

      {callStatus === "incoming" && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center">
          <div className="text-center animate-scale-in px-8">
            <div className="relative w-28 h-28 mx-auto mb-6">
              <div className="absolute inset-0 rounded-full bg-pink-500/30 animate-ping" />
              <div className="w-28 h-28 rounded-full bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center shadow-2xl shadow-pink-500/30">
                <PhoneCall className="w-12 h-12 text-white relative z-10" />
              </div>
            </div>
            <p className="text-white/50 text-sm mb-1">
              {callType === "video" ? "Incoming video call" : "Incoming voice call"}
            </p>
            <h2 className="text-white text-2xl font-bold mb-10">{otherName}</h2>
            <div className="flex justify-center gap-12">
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={onReject}
                  className="w-16 h-16 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center transition-all active:scale-90 shadow-lg shadow-rose-500/30"
                  data-testid="button-reject-call"
                >
                  <PhoneOff className="w-6 h-6" />
                </button>
                <span className="text-white/40 text-xs">Decline</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={onAnswer}
                  className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center transition-all active:scale-90 shadow-lg shadow-emerald-500/30"
                  data-testid="button-answer-call"
                >
                  <Phone className="w-6 h-6" />
                </button>
                <span className="text-white/40 text-xs">Accept</span>
              </div>
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
      )}

      {(callStatus === "calling" || callStatus === "connected") && (
        <>
          {isMinimized ? (
            <div
              className="fixed z-50 w-44 rounded-2xl overflow-hidden shadow-2xl cursor-grab active:cursor-grabbing bg-black border border-white/10 select-none"
              style={{ left: pos.x, top: pos.y }}
              onMouseDown={onMouseDown}
              onTouchStart={onTouchStart}
            >
              {callType === "video" ? (
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  muted={isSpeakerOff}
                  className="w-full h-28 object-cover"
                />
              ) : (
                <div className="w-full h-16 bg-gradient-to-br from-pink-900/80 to-violet-900/80 flex items-center justify-center gap-2">
                  <Phone className="w-4 h-4 text-white/40" />
                  <span className="text-white/50 text-xs font-mono">
                    {formatCallDuration(callDuration)}
                  </span>
                </div>
              )}
              <div className="bg-black/90 px-2.5 py-2 flex items-center justify-between gap-1">
                <span className="text-white text-xs font-mono">
                  {formatCallDuration(callDuration)}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setIsMinimized(false)}
                    className="p-1.5 rounded-lg bg-white/10 text-white hover:bg-white/20 active:scale-90 transition"
                  >
                    <Maximize2 className="w-3 h-3" />
                  </button>
                  <button
                    onClick={onEnd}
                    className="p-1.5 rounded-lg bg-rose-500 text-white hover:bg-rose-600 active:scale-90 transition"
                  >
                    <PhoneOff className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="fixed inset-0 z-50 bg-[#080810] flex flex-col">
              {callType === "video" ? (
                <div className="flex-1 relative bg-black">
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    muted={isSpeakerOff}
                    className="w-full h-full object-cover"
                  />
                  {callStatus === "connected" && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/50 backdrop-blur-sm rounded-full px-4 py-1.5">
                      <span className="text-white text-sm font-mono">
                        {formatCallDuration(callDuration)}
                      </span>
                    </div>
                  )}
                  {/* Local video PiP */}
                  <div className="absolute top-4 right-4 w-32 h-44 rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl">
                    <video
                      ref={localVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                    />
                  </div>
                  {callStatus === "calling" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <div className="text-center">
                        <p className="text-white/60 text-sm mb-2">Calling...</p>
                        <h2 className="text-white text-2xl font-bold">{otherName}</h2>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center bg-gradient-to-b from-[#0a0a0f] to-[#150d1f]">
                  <div className="text-center">
                    <div className="relative w-28 h-28 mx-auto mb-6">
                      {callStatus === "calling" && (
                        <div className="absolute inset-0 rounded-full bg-pink-500/20 animate-ping" />
                      )}
                      <div className="w-28 h-28 rounded-full bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center shadow-2xl shadow-pink-500/30">
                        <Phone className="w-12 h-12 text-white" />
                      </div>
                    </div>
                    <h2 className="text-white text-2xl font-bold mb-2">{otherName}</h2>
                    <p className="text-white/40 text-sm">
                      {callStatus === "calling" ? "Calling…" : formatCallDuration(callDuration)}
                    </p>
                  </div>
                </div>
              )}

              <div className="bg-black/90 backdrop-blur-xl px-6 py-6 flex items-center justify-center gap-3 flex-wrap">
                <CallBtn onClick={onToggleMute} active={isMuted} label={isMuted ? "Unmute" : "Mute"} testId="button-toggle-mute">
                  {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </CallBtn>

                <CallBtn onClick={toggleSpeaker} active={isSpeakerOff} label={isSpeakerOff ? "Speaker on" : "Speaker off"}>
                  {isSpeakerOff ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </CallBtn>

                {callType === "video" && (
                  <>
                    <CallBtn onClick={onToggleCamera} active={isCameraOff} label={isCameraOff ? "Camera on" : "Camera off"} testId="button-toggle-camera">
                      {isCameraOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                    </CallBtn>
                    <CallBtn onClick={onSwitchCamera} label="Flip" testId="button-switch-camera">
                      <FlipHorizontal className="w-5 h-5" />
                    </CallBtn>
                  </>
                )}

                <button
                  onClick={onEnd}
                  className="w-16 h-16 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center transition-all active:scale-90 shadow-lg shadow-rose-500/30"
                  data-testid="button-end-call"
                >
                  <PhoneOff className="w-6 h-6" />
                </button>

                <CallBtn onClick={() => setIsMinimized(true)} label="Minimize">
                  <Minimize2 className="w-5 h-5" />
                </CallBtn>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

function CallBtn({
  children,
  onClick,
  active,
  label,
  testId,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  label?: string;
  testId?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        onClick={onClick}
        data-testid={testId}
        className={cn(
          "w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-90",
          active ? "bg-white/25 text-white" : "bg-white/10 text-white hover:bg-white/20"
        )}
      >
        {children}
      </button>
      {label && <span className="text-white/30 text-[10px] text-center">{label}</span>}
    </div>
  );
}
