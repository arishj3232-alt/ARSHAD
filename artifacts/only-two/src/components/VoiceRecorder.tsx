import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, Square, Send, X } from "lucide-react";

type Props = {
  onSend: (blob: Blob) => void;
  onCancel: () => void;
};

export default function VoiceRecorder({ onSend, onCancel }: Props) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [bars, setBars] = useState<number[]>(Array(20).fill(3));
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const animateWaveform = useCallback(() => {
    if (!analyserRef.current) return;
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);
    const step = Math.floor(dataArray.length / 20);
    const newBars = Array.from({ length: 20 }, (_, i) => {
      const val = dataArray[i * step] ?? 0;
      return Math.max(3, Math.round((val / 255) * 32));
    });
    setBars(newBars);
    animFrameRef.current = requestAnimationFrame(animateWaveform);
  }, []);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;
    source.connect(analyser);
    analyserRef.current = analyser;

    const mr = new MediaRecorder(stream);
    mediaRecorderRef.current = mr;
    chunksRef.current = [];
    mr.ondataavailable = (e) => chunksRef.current.push(e.data);
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      setAudioBlob(blob);
      stream.getTracks().forEach((t) => t.stop());
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
    mr.start();
    setRecording(true);
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    animateWaveform();
  }, [animateWaveform]);

  const stop = useCallback(() => {
    mediaRecorderRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    setRecording(false);
    setBars(Array(20).fill(3));
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

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
            <div
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                recording ? "bg-rose-500 animate-pulse" : "bg-white/20"
              }`}
            />
            <span className="text-white/70 font-mono text-sm w-10 flex-shrink-0">
              {timeStr}
            </span>
            <div className="flex gap-0.5 items-end h-8 flex-1">
              {bars.map((h, i) => (
                <div
                  key={i}
                  className={`flex-1 rounded-full transition-all duration-75 ${
                    recording ? "bg-rose-400" : "bg-white/20"
                  }`}
                  style={{ height: `${h}px` }}
                />
              ))}
            </div>
          </div>

          {recording ? (
            <button
              onClick={stop}
              className="p-2.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white transition active:scale-95"
            >
              <Square className="w-4 h-4 fill-white" />
            </button>
          ) : (
            <button
              onClick={start}
              className="p-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-violet-600 text-white transition hover:opacity-90 active:scale-95"
            >
              <Mic className="w-4 h-4" />
            </button>
          )}
        </>
      ) : (
        <>
          <button
            onClick={cancel}
            className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="flex-1 flex items-center gap-2">
            <div className="flex gap-0.5 items-end h-6 flex-1">
              {Array.from({ length: 20 }).map((_, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-full bg-pink-400/60"
                  style={{ height: `${Math.random() * 18 + 4}px` }}
                />
              ))}
            </div>
            <span className="text-white/60 text-sm font-mono flex-shrink-0">
              {timeStr}
            </span>
          </div>
          <button
            onClick={() => audioBlob && onSend(audioBlob)}
            className="p-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-violet-600 text-white hover:opacity-90 transition active:scale-95"
          >
            <Send className="w-4 h-4" />
          </button>
        </>
      )}
    </div>
  );
}
