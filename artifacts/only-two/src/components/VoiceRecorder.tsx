import { useState, useRef, useCallback } from "react";
import { Mic, Square, Send, X } from "lucide-react";

type Props = {
  onSend: (blob: Blob) => void;
  onCancel: () => void;
};

export default function VoiceRecorder({ onSend, onCancel }: Props) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream);
    mediaRecorderRef.current = mr;
    chunksRef.current = [];
    mr.ondataavailable = (e) => chunksRef.current.push(e.data);
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      setAudioBlob(blob);
      stream.getTracks().forEach((t) => t.stop());
    };
    mr.start();
    setRecording(true);
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  }, []);

  const stop = useCallback(() => {
    mediaRecorderRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
  }, []);

  const handleSend = () => {
    if (audioBlob) {
      onSend(audioBlob);
    }
  };

  const cancel = () => {
    stop();
    setAudioBlob(null);
    setSeconds(0);
    onCancel();
  };

  const pad = (n: number) => String(n).padStart(2, "0");
  const timeStr = `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;

  return (
    <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
      {!audioBlob ? (
        <>
          <button
            onClick={cancel}
            className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex-1 flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${recording ? "bg-rose-500 animate-pulse" : "bg-white/20"}`} />
            <span className="text-white/70 font-mono text-sm">{timeStr}</span>
            {recording && (
              <div className="flex gap-0.5 items-center h-5">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-0.5 bg-rose-400 rounded-full animate-pulse"
                    style={{
                      height: `${Math.random() * 80 + 20}%`,
                      animationDelay: `${i * 50}ms`,
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {recording ? (
            <button
              onClick={stop}
              className="p-2.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white transition"
            >
              <Square className="w-4 h-4 fill-white" />
            </button>
          ) : (
            <button
              onClick={start}
              className="p-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-violet-600 text-white transition hover:opacity-90"
            >
              <Mic className="w-4 h-4" />
            </button>
          )}
        </>
      ) : (
        <>
          <button onClick={cancel} className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition">
            <X className="w-4 h-4" />
          </button>
          <span className="flex-1 text-white/60 text-sm">Voice message ({timeStr})</span>
          <button
            onClick={handleSend}
            className="p-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-violet-600 text-white hover:opacity-90 transition"
          >
            <Send className="w-4 h-4" />
          </button>
        </>
      )}
    </div>
  );
}
