import { useRef, useCallback, useState, useEffect } from "react";
import { vibrateShort } from "@/lib/haptics";

export type HoldSwipeMode = "audio" | "video";

const LOCK_PX = 80;
const MIN_SEND_MS = 450;
const MAX_AUDIO_S = 120;
const MAX_VIDEO_S = 60;

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

type Options = {
  onSend: (blob: Blob, mode: HoldSwipeMode) => void | Promise<void>;
};

export function useHoldSwipeRecording({ onSend }: Options) {
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<HoldSwipeMode>("audio");
  const [locked, setLocked] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [bars, setBars] = useState<number[]>(() => Array(20).fill(3));
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const pointerIdRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const lockedRef = useRef(false);
  const recordingStartedAtRef = useRef(0);
  const disarmRef = useRef(false);
  const sessionActiveRef = useRef(false);
  const recordingLiveRef = useRef(false);
  const modeRef = useRef<HoldSwipeMode>("audio");
  const endingRef = useRef(false);
  const secondsRef = useRef(0);

  const gestureListenersRef = useRef<{
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
  } | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cleanupAnalyser = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    analyserRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  const removeGestureListeners = useCallback(() => {
    const l = gestureListenersRef.current;
    if (!l) return;
    window.removeEventListener("pointermove", l.move, true);
    window.removeEventListener("pointerup", l.up, true);
    window.removeEventListener("pointercancel", l.up, true);
    gestureListenersRef.current = null;
  }, []);

  const blobMime = (m: HoldSwipeMode) => (m === "audio" ? "audio/webm" : "video/webm");

  const stopRecorderToBlob = useCallback(async (): Promise<Blob | null> => {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state === "inactive") return null;
    return new Promise((resolve) => {
      mr.onstop = () => {
        const b = new Blob(chunksRef.current, { type: blobMime(modeRef.current) });
        resolve(b.size > 0 ? b : null);
      };
      try {
        mr.stop();
      } catch {
        resolve(null);
      }
    });
  }, []);

  const hardStopTracksAndVideo = useCallback(() => {
    stopTracks(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const resetStateAfterEnd = useCallback(() => {
    clearTimer();
    cleanupAnalyser();
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    hardStopTracksAndVideo();
    setOpen(false);
    setLocked(false);
    lockedRef.current = false;
    secondsRef.current = 0;
    setSeconds(0);
    setBars(Array(20).fill(3));
    setError(null);
    pointerIdRef.current = null;
    startYRef.current = null;
    disarmRef.current = false;
    sessionActiveRef.current = false;
    recordingLiveRef.current = false;
    endingRef.current = false;
  }, [clearTimer, cleanupAnalyser, hardStopTracksAndVideo]);

  const endSession = useCallback(
    async (shouldSend: boolean) => {
      if (endingRef.current) return;
      endingRef.current = true;
      removeGestureListeners();
      clearTimer();
      cleanupAnalyser();

      const blob = await stopRecorderToBlob();
      const dt = Date.now() - recordingStartedAtRef.current;
      const m = modeRef.current;

      hardStopTracksAndVideo();
      mediaRecorderRef.current = null;
      chunksRef.current = [];

      try {
        if (shouldSend && blob && dt >= MIN_SEND_MS) {
          await onSendRef.current(blob, m);
          vibrateShort(40);
        }
      } finally {
        resetStateAfterEnd();
      }
    },
    [cleanupAnalyser, clearTimer, hardStopTracksAndVideo, removeGestureListeners, resetStateAfterEnd, stopRecorderToBlob]
  );

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

  const attachGestureListeners = useCallback(() => {
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerIdRef.current) return;
      if (lockedRef.current) return;
      if (startYRef.current == null) return;
      if (startYRef.current - ev.clientY > LOCK_PX) {
        if (!lockedRef.current) vibrateShort(35);
        lockedRef.current = true;
        setLocked(true);
      }
      if (ev.pointerType === "touch" && ev.cancelable) ev.preventDefault();
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerIdRef.current) return;
      if (!recordingLiveRef.current || endingRef.current) return;
      if (lockedRef.current) {
        removeGestureListeners();
        return;
      }
      void endSession(true);
    };

    gestureListenersRef.current = { move: onMove, up: onUp };
    window.addEventListener("pointermove", onMove, { capture: true, passive: false });
    window.addEventListener("pointerup", onUp, { capture: true });
    window.addEventListener("pointercancel", onUp, { capture: true });
  }, [endSession, removeGestureListeners]);

  const runStartSession = useCallback(
    async (m: HoldSwipeMode, _clientY: number, pointerId: number) => {
      modeRef.current = m;
      setMode(m);
      setLocked(false);
      lockedRef.current = false;
      setError(null);
      pointerIdRef.current = pointerId;
      disarmRef.current = false;
      recordingLiveRef.current = false;

      stopTracks(streamRef.current);
      streamRef.current = null;

      try {
        const constraints: MediaStreamConstraints =
          m === "audio"
            ? { audio: true }
            : { audio: true, video: { facingMode: "user" } };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (disarmRef.current || !sessionActiveRef.current) {
          stopTracks(stream);
          resetStateAfterEnd();
          return;
        }
        streamRef.current = stream;

        if (m === "audio") {
          const audioCtx = new AudioContext();
          await audioCtx.resume().catch(() => {});
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 128;
          source.connect(analyser);
          audioCtxRef.current = audioCtx;
          analyserRef.current = analyser;
        } else {
          requestAnimationFrame(() => {
            if (videoRef.current && streamRef.current) {
              videoRef.current.srcObject = streamRef.current;
              videoRef.current.muted = true;
            }
          });
        }

        if (disarmRef.current || !sessionActiveRef.current) {
          hardStopTracksAndVideo();
          resetStateAfterEnd();
          return;
        }

        const mr = new MediaRecorder(stream);
        mediaRecorderRef.current = mr;
        chunksRef.current = [];
        mr.ondataavailable = (e) => {
          if (e.data.size) chunksRef.current.push(e.data);
        };
        mr.start(250);
        recordingStartedAtRef.current = Date.now();
        secondsRef.current = 0;
        setSeconds(0);
        setOpen(true);
        vibrateShort(45);
        recordingLiveRef.current = true;

        clearTimer();
        timerRef.current = setInterval(() => {
          if (endingRef.current) return;
          secondsRef.current += 1;
          setSeconds(secondsRef.current);
          const max = modeRef.current === "audio" ? MAX_AUDIO_S : MAX_VIDEO_S;
          if (secondsRef.current >= max) {
            clearTimer();
            void endSession(true);
          }
        }, 1000);

        if (m === "audio") animateWaveform();
        attachGestureListeners();
      } catch {
        resetStateAfterEnd();
        const msg = m === "audio" ? "Microphone unavailable" : "Camera unavailable";
        setError(msg);
        window.setTimeout(() => setError(null), 3800);
      }
    },
    [
      animateWaveform,
      attachGestureListeners,
      clearTimer,
      endSession,
      hardStopTracksAndVideo,
      resetStateAfterEnd,
    ]
  );

  const handleHoldPointerDown = useCallback(
    (e: React.PointerEvent, m: HoldSwipeMode) => {
      if (e.button !== 0) return;
      if (open || sessionActiveRef.current || endingRef.current) return;
      if (e.pointerType === "touch") e.preventDefault();

      sessionActiveRef.current = true;
      const pid = e.pointerId;
      startYRef.current = e.clientY;
      recordingLiveRef.current = false;

      const earlyUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pid) return;
        if (!recordingLiveRef.current) disarmRef.current = true;
      };
      window.addEventListener("pointerup", earlyUp, true);
      window.addEventListener("pointercancel", earlyUp, true);

      void (async () => {
        try {
          await runStartSession(m, e.clientY, pid);
        } finally {
          window.removeEventListener("pointerup", earlyUp, true);
          window.removeEventListener("pointercancel", earlyUp, true);
        }
      })();
    },
    [open, runStartSession]
  );

  const lockedCancel = useCallback(() => {
    void endSession(false);
  }, [endSession]);

  const lockedSend = useCallback(() => {
    void endSession(true);
  }, [endSession]);

  useEffect(() => {
    return () => {
      removeGestureListeners();
      clearTimer();
      cleanupAnalyser();
      try {
        mediaRecorderRef.current?.stop();
      } catch {
        /* noop */
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [cleanupAnalyser, clearTimer, removeGestureListeners]);

  const maxSeconds = mode === "audio" ? MAX_AUDIO_S : MAX_VIDEO_S;

  return {
    open,
    mode,
    locked,
    seconds,
    maxSeconds,
    bars,
    error,
    videoRef,
    handleHoldPointerDown,
    lockedCancel,
    lockedSend,
  };
}
