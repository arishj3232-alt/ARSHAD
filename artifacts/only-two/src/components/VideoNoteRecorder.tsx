import { useState, useRef, useCallback, useEffect } from "react";
import { Video, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  onSend: (blob: Blob) => void;
  onCancel: () => void;
};

export default function VideoNoteRecorder({ onSend, onCancel }: Props) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const MAX_SECONDS = 60;

  useEffect(() => {
    startPreview();
    return () => stopPreview();
  }, []);

  useEffect(() => {
    if (seconds >= MAX_SECONDS && recording) stop();
  }, [seconds, recording]);

  const startPreview = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 240, height: 240 },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
      }
    } catch {
      // Camera unavailable
    }
  };

  const stopPreview = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const start = useCallback(() => {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const mr = new MediaRecorder(streamRef.current);
    mediaRecorderRef.current = mr;
    mr.ondataavailable = (e) => chunksRef.current.push(e.data);
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      setVideoBlob(blob);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
    };
    mr.start();
    setRecording(true);
    setSeconds(0);
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  }, []);

  const stop = useCallback(() => {
    mediaRecorderRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
  }, []);

  const cancel = () => {
    stop();
    stopPreview();
    setVideoBlob(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    onCancel();
  };

  const handleSend = () => {
    if (!videoBlob) return;
    stop();
    stopPreview();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    onSend(videoBlob);
  };

  const pad = (n: number) => String(n).padStart(2, "0");
  const timeStr = `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
  const progress = (seconds / MAX_SECONDS) * 100;

  const circumference = 2 * Math.PI * 54;

  return (
    <div className="flex flex-col items-center gap-4 py-4 px-6 bg-white/5 border border-white/10 rounded-2xl">
      <div className="relative w-32 h-32">
        <svg className="absolute inset-0 -rotate-90 w-full h-full" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="4" />
          {recording && (
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke="url(#grad)"
              strokeWidth="4"
              strokeDasharray={circumference}
              strokeDashoffset={circumference - (progress / 100) * circumference}
              strokeLinecap="round"
            />
          )}
          <defs>
            <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ec4899" />
              <stop offset="100%" stopColor="#8b5cf6" />
            </linearGradient>
          </defs>
        </svg>

        <div className="absolute inset-2 rounded-full overflow-hidden bg-black">
          {!videoBlob ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover scale-x-[-1]"
            />
          ) : previewUrl ? (
            <video
              src={previewUrl}
              autoPlay
              loop
              playsInline
              muted
              className="w-full h-full object-cover scale-x-[-1]"
            />
          ) : null}
        </div>

        {recording && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
        )}
      </div>

      <span className="text-white/50 font-mono text-sm">{timeStr}</span>

      <div className="flex items-center gap-4">
        <button
          onClick={cancel}
          className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition"
        >
          <X className="w-4 h-4" />
        </button>

        {!videoBlob ? (
          <button
            onClick={recording ? stop : start}
            className={cn(
              "w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95 shadow-lg",
              recording
                ? "bg-rose-500 hover:bg-rose-600 shadow-rose-500/30"
                : "bg-gradient-to-r from-pink-500 to-violet-600 shadow-pink-500/30"
            )}
          >
            {recording ? (
              <div className="w-5 h-5 rounded bg-white" />
            ) : (
              <Video className="w-6 h-6 text-white" />
            )}
          </button>
        ) : (
          <button
            onClick={handleSend}
            className="w-14 h-14 rounded-full bg-gradient-to-r from-pink-500 to-violet-600 flex items-center justify-center transition-all active:scale-95 shadow-lg shadow-pink-500/30"
          >
            <Send className="w-5 h-5 text-white" />
          </button>
        )}
      </div>

      <p className="text-white/25 text-xs text-center">
        {recording ? "Recording… tap to stop" : videoBlob ? "Preview ready" : "Tap to start recording"}
      </p>
    </div>
  );
}
