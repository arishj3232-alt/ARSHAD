import { useState, useRef, useCallback, useEffect } from "react";
import { Video, Send, X, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

type Props = {
  onSend: (blob: Blob) => void;
  onCancel: () => void;
  disabled?: boolean;
};

export default function VideoNoteRecorder({ onSend, onCancel, disabled = false }: Props) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const MAX_SECONDS = 60;

  useEffect(() => {
    return () => {
      const s = streamRef.current;
      if (s) {
        s.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, []);

  const acquireStream = useCallback(async (facing: "user" | "environment") => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing },
      audio: true,
    });
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.muted = true;
    }
    return stream;
  }, []);

  useEffect(() => {
    if (disabled) {
      stopStream(streamRef.current);
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      setPreviewReady(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await acquireStream("user");
        if (cancelled) {
          stopStream(streamRef.current);
          streamRef.current = null;
          return;
        }
        setFacingMode("user");
        setPermissionError(null);
        setPreviewReady(true);
      } catch (err) {
        if (cancelled) return;
        const e = err as DOMException;
        if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
          setPermissionError("Camera/Microphone access denied. Please allow permissions.");
        } else {
          setPermissionError("Camera/Microphone unavailable on this device.");
        }
        setPreviewReady(false);
      }
    })();
    return () => {
      cancelled = true;
      stopStream(streamRef.current);
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [disabled, acquireStream]);

  const startPreview = useCallback(async () => {
    if (streamRef.current) return true;
    try {
      await acquireStream(facingMode);
      setPermissionError(null);
      setPreviewReady(true);
      return true;
    } catch (err) {
      const e = err as DOMException;
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        setPermissionError("Camera/Microphone access denied. Please allow permissions.");
      } else {
        setPermissionError("Camera/Microphone unavailable on this device.");
      }
      setPreviewReady(false);
      return false;
    }
  }, [acquireStream, facingMode]);

  const stopPreview = () => {
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setPreviewReady(false);
  };

  const flipCamera = useCallback(async () => {
    if (disabled || recording || videoBlob || !streamRef.current) return;
    const next = facingMode === "user" ? "environment" : "user";
    try {
      await acquireStream(next);
      setFacingMode(next);
      setPermissionError(null);
      setPreviewReady(true);
    } catch (err) {
      const e = err as DOMException;
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        setPermissionError("Camera/Microphone access denied. Please allow permissions.");
      } else {
        setPermissionError("Could not switch camera.");
      }
    }
  }, [disabled, recording, videoBlob, facingMode, acquireStream]);

  const start = useCallback(async () => {
    if (disabled) return;
    const ok = await startPreview();
    if (!ok || !streamRef.current) return;
    if (streamRef.current.getTracks().length === 0) return;
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
  }, [disabled, startPreview]);

  const stop = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setRecording(false);
  }, []);

  useEffect(() => {
    if (seconds >= MAX_SECONDS && recording) stop();
  }, [seconds, recording, stop]);

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
              className={cn("w-full h-full object-cover", facingMode === "user" && "scale-x-[-1]")}
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

        {!videoBlob && !recording && previewReady && (
          <button
            type="button"
            onClick={() => void flipCamera()}
            disabled={disabled}
            className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition disabled:opacity-40"
            title="Flip camera"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}

        {!videoBlob ? (
          <button
            onClick={recording ? stop : () => { if (!disabled) void start(); }}
            disabled={disabled}
            className={cn(
              "w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95 shadow-lg",
              disabled
                ? "bg-white/10 text-white/30 cursor-not-allowed shadow-none"
                : recording
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
        {permissionError
          ? permissionError
          : disabled
            ? "Video notes disabled by admin"
          : recording
            ? "Recording… tap to stop"
            : videoBlob
              ? "Preview ready"
              : previewReady
                ? "Tap to start recording"
                : "Tap to enable camera and start recording"}
      </p>
    </div>
  );
}
