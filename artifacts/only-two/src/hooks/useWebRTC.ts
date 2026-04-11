import { useState, useEffect, useRef, useCallback } from "react";
import {
  collection,
  doc,
  addDoc,
  onSnapshot,
  updateDoc,
  serverTimestamp,
  getDocs,
  writeBatch,
  deleteDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export type CallType = "audio" | "video";
/** `ended` is transient — UI typically returns to `idle` immediately after cleanup */
export type CallStatus =
  | "idle"
  | "calling"
  | "incoming"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "ended";

export type MediaErrorType = "permission-denied" | "no-device" | "overconstrained" | "unknown";
type CallEventStatus = "calling" | "declined" | "missed" | "not_picked" | "completed";
type EmitCallEvent = (event: {
  callType: CallType;
  callStatus: CallEventStatus;
  duration?: number;
}) => Promise<void>;

// ─── ICE Server Configuration ────────────────────────────────────────────────
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  {
    urls: [
      "turn:free.expressturn.com:3478",
      "turns:free.expressturn.com:5349",
    ],
    username: "000000002091192793",
    credential: "rVUJLWmFjp2CYztAu1N7cvWsxA4=",
  },
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turns:openrelay.metered.ca:443",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

const ICE_CONFIG: RTCConfiguration = {
  iceServers: ICE_SERVERS,
  iceTransportPolicy: "all",
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
};
const FALLBACK_ICE_CONFIG: RTCConfiguration = {
  ...ICE_CONFIG,
  iceServers: [ICE_SERVERS[0], ICE_SERVERS[2], ICE_SERVERS[1]],
};

/** Ringing ends → Firestore `missed` + FCM (Cloud Function) if callee never answers. */
const CALL_RING_TIMEOUT_MS = 30_000;
const CONNECTING_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const MAX_BATCH_DELETE = 400;

async function deleteCollectionDocs(
  roomId: string,
  callId: string,
  sub: "offerCandidates" | "answerCandidates"
): Promise<void> {
  const colRef = collection(db, "rooms", roomId, "calls", callId, sub);
  const snap = await getDocs(colRef);
  if (snap.empty) return;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += MAX_BATCH_DELETE) {
    const batch = writeBatch(db);
    docs.slice(i, i + MAX_BATCH_DELETE).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

/** Best-effort: remove ICE subcollections then the call doc (client-side; no cascade in Firestore). */
async function deleteCallDocumentTree(roomId: string, callId: string): Promise<void> {
  try {
    await deleteCollectionDocs(roomId, callId, "offerCandidates");
    await deleteCollectionDocs(roomId, callId, "answerCandidates");
    await deleteDoc(doc(db, "rooms", roomId, "calls", callId));
  } catch {
    // Leave doc as status ended if delete fails (rules, offline, etc.)
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useWebRTC(
  roomId: string,
  userId: string | null,
  emitCallEvent?: EmitCallEvent,
  onMissedCall?: () => void
) {
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [callType, setCallType] = useState<CallType>("audio");
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [isMinimized, setIsMinimized] = useState(false);
  const [mediaError, setMediaError] = useState<{ type: MediaErrorType; message: string } | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [localAttachEpoch, setLocalAttachEpoch] = useState(0);
  const [remoteAttachEpoch, setRemoteAttachEpoch] = useState(0);
  const callStateRef = useRef<CallStatus>("idle");

  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const callDocRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectionFailTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iceRestartAttemptedRef = useRef(false);
  const connectingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isCallerRef = useRef(false);
  const lastCallTypeRef = useRef<CallType>("audio");
  const connectedRef = useRef(false);
  const callStartedAtRef = useRef<number | null>(null);
  const emittedEventsRef = useRef<Set<string>>(new Set());
  const terminalEventRef = useRef<"missed" | "declined" | "completed" | "not_picked" | null>(null);
  const pendingCandidatesRef = useRef<{ offer: RTCIceCandidateInit[]; answer: RTCIceCandidateInit[] }>({
    offer: [],
    answer: [],
  });
  const retryAttemptRef = useRef(0);
  const snapshotActiveRef = useRef(false);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  /** Toggle target when `getSettings().facingMode` is missing (common on mobile). */
  const flipFacingRef = useRef<"user" | "environment">("environment");

  const snapshotUnsubsRef = useRef<Array<() => void>>([]);

  const endCallRef = useRef<(opts?: { skipMissedPatch?: boolean }) => Promise<void>>(async () => {});
  const cleanupRef = useRef<() => void>(() => {});
  const retryCallRef = useRef<
    (
      reason: "auto" | "manual" | "track-ended" | "network-restore" | "resume" | "failure"
    ) => Promise<void>
  >(async () => {});

  const setCallState = useCallback((next: CallStatus) => {
    callStateRef.current = next;
    setCallStatus(next);
    console.log(`[STATE] -> ${next}`);
  }, []);

  /** Log + write Firestore call doc fields (use for every status transition). */
  const writeCallDocPatch = useCallback(
    async (callId: string, patch: Record<string, unknown>) => {
      const st = patch.status;
      if (typeof st === "string") {
        console.log("[WRITE STATUS]", st, "FROM", callStateRef.current);
      }
      await updateDoc(doc(db, "rooms", roomId, "calls", callId), patch);
    },
    [roomId]
  );

  const safeReject = useCallback(
    async (callId: string) => {
      if (
        callStateRef.current === "connecting" ||
        callStateRef.current === "connected" ||
        callStateRef.current === "reconnecting"
      ) {
        console.error("[CRITICAL BUG] Attempt to reject after accept — BLOCKED");
        return;
      }
      if (callStateRef.current !== "calling" && callStateRef.current !== "incoming") {
        console.warn("[REJECT] BLOCKED — invalid state:", callStateRef.current);
        return;
      }
      await writeCallDocPatch(callId, { status: "rejected" });
    },
    [writeCallDocPatch]
  );

  useEffect(() => {
    console.log("ICE servers:", ICE_SERVERS);
  }, []);

  const clearRingTimeout = useCallback(() => {
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
  }, []);

  const clearConnectionFailTimeout = useCallback(() => {
    if (connectionFailTimeoutRef.current) {
      clearTimeout(connectionFailTimeoutRef.current);
      connectionFailTimeoutRef.current = null;
    }
  }, []);

  const clearConnectingTimeout = useCallback(() => {
    if (connectingTimeoutRef.current) {
      clearTimeout(connectingTimeoutRef.current);
      connectingTimeoutRef.current = null;
    }
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const emitOnce = useCallback(
    async (callId: string | null, status: CallEventStatus, duration?: number) => {
      if (!emitCallEvent) return;
      const scopedId = callId ?? "no-call";
      const key = `${scopedId}:${status}`;
      if (emittedEventsRef.current.has(key)) return;
      emittedEventsRef.current.add(key);
      await emitCallEvent({
        callType: lastCallTypeRef.current,
        callStatus: status,
        duration,
      });
    },
    [emitCallEvent]
  );

  const emitTerminalOnce = useCallback(
    async (
      callId: string | null,
      status: "missed" | "declined" | "completed" | "not_picked",
      duration?: number
    ) => {
      if (terminalEventRef.current) return;
      terminalEventRef.current = status;
      await emitOnce(callId, status, duration);
    },
    [emitOnce]
  );

  const startTimer = useCallback(() => {
    stopTimer();
    timerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
  }, [stopTimer]);

  const maybeMarkConnected = useCallback(
    async (pc: RTCPeerConnection) => {
      if (
        pc.connectionState === "connected" &&
        (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed")
      ) {
        connectedRef.current = true;
        callStartedAtRef.current = callStartedAtRef.current ?? Date.now();
        retryAttemptRef.current = 0;
        clearRingTimeout();
        console.log("[TIMEOUT] Ring timeout cleared");
        clearConnectionFailTimeout();
        clearConnectingTimeout();
        setConnectionError(null);
        startTimer();
        if (callStateRef.current !== "connected") setCallState("connected");
        if (isCallerRef.current && callDocRef.current) {
          await writeCallDocPatch(callDocRef.current, {
            status: "connected",
            connectedAt: serverTimestamp(),
          }).catch(() => {});
        }
      }
    },
    [clearRingTimeout, clearConnectionFailTimeout, clearConnectingTimeout, setCallState, startTimer, writeCallDocPatch]
  );

  const cleanup = useCallback(() => {
    clearRingTimeout();
    clearConnectionFailTimeout();
    clearConnectingTimeout();
    stopTimer();
    iceRestartAttemptedRef.current = false;
    isCallerRef.current = false;
    lastCallTypeRef.current = "audio";
    connectedRef.current = false;
    callStartedAtRef.current = null;
    callStateRef.current = "idle";
    emittedEventsRef.current.clear();
    terminalEventRef.current = null;
    pendingCandidatesRef.current.offer = [];
    pendingCandidatesRef.current.answer = [];
    retryAttemptRef.current = 0;
    snapshotActiveRef.current = false;

    snapshotUnsubsRef.current.forEach((fn) => fn());
    snapshotUnsubsRef.current = [];

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.ontrack = null;
      pcRef.current.onicecandidate = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.oniceconnectionstatechange = null;
      pcRef.current.onicegatheringstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    remoteStreamRef.current = null;
    setCallDuration(0);
    setIsMuted(false);
    setIsCameraOff(false);
    setIsMinimized(false);
    setConnectionError(null);
  }, [clearRingTimeout, clearConnectionFailTimeout, clearConnectingTimeout, stopTimer]);

  cleanupRef.current = cleanup;

  useEffect(() => () => cleanupRef.current(), []);

  useEffect(() => {
    if (callType !== "video") return;
    if (callStatus === "idle" || callStatus === "ended") return;
    const stream = localStreamRef.current;
    const el = localVideoRef.current;
    if (!stream || !el) return;
    el.srcObject = stream;
    el.muted = true;
    void el.play().catch(() => {});
    const vt = stream.getVideoTracks()[0];
    console.log("[WEBRTC] effect: local video element", {
      trackCount: stream.getTracks().length,
      videoEnabled: vt?.enabled,
      readyState: vt?.readyState,
    });
  }, [callStatus, callType, localAttachEpoch]);

  useEffect(() => {
    if (callType !== "video") return;
    const stream = remoteStreamRef.current;
    const el = remoteVideoRef.current;
    if (!stream || !el) return;
    el.srcObject = stream;
    el.playsInline = true;
    void el.play().catch(() => {});
    console.log("[WEBRTC] effect: remote video element", { trackCount: stream.getTracks().length });
  }, [callType, callStatus, remoteAttachEpoch]);

  useEffect(() => {
    const onOnline = () => {
      console.log("[NETWORK] Back online");
      if (!connectedRef.current && callStateRef.current !== "ended" && callStateRef.current !== "idle") {
        void retryCallRef.current("network-restore");
      }
    };
    const onOffline = () => {
      console.log("[NETWORK] Offline");
    };
    const onVisibility = () => {
      if (document.hidden) {
        console.log("[APP] Background");
        return;
      }
      console.log("[APP] Foreground");
      if (!connectedRef.current && callStateRef.current !== "ended" && callStateRef.current !== "idle") {
        void retryCallRef.current("resume");
      }
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const showNetworkRestrictionMessage = useCallback((withExtraSuggestion: boolean) => {
    setConnectionError(
      withExtraSuggestion
        ? "Connection failed due to network restrictions. Try again or switch network. If it keeps failing, try switching to mobile data or different WiFi."
        : "Connection failed due to network restrictions. Try again or switch network."
    );
  }, []);

  const getMedia = useCallback(async (type: CallType): Promise<MediaStream | null> => {
    setMediaError(null);
    if (localStreamRef.current) {
      console.log("[WEBRTC] stopping previous local stream (prevent duplicate)");
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    try {
      if (typeof navigator !== "undefined" && navigator.permissions?.query) {
        try {
          const mic = await navigator.permissions.query({ name: "microphone" as PermissionName });
          console.log("[WEBRTC] microphone permission:", mic.state);
          if (type === "video") {
            const cam = await navigator.permissions.query({ name: "camera" as PermissionName });
            console.log("[WEBRTC] camera permission:", cam.state);
          }
        } catch {
          /* not all browsers support query for camera/mic */
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: type === "video",
      });
      if (!stream || stream.getTracks().length === 0) {
        throw new Error("Media stream not available");
      }
      stream.getVideoTracks().forEach((track) => {
        track.enabled = true;
      });
      stream.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });
      const vts = stream.getVideoTracks();
      const ats = stream.getAudioTracks();
      console.log("[WEBRTC] getUserMedia OK", {
        trackCount: stream.getTracks().length,
        audioTracks: ats.length,
        videoTracks: vts.length,
        videoEnabled: vts[0]?.enabled,
        videoReadyState: vts[0]?.readyState,
      });
      if (ats.length === 0) {
        console.warn("[WEBRTC] No audio track");
      }
      if (type === "video" && vts.length === 0) {
        console.warn("[WEBRTC] No video track — check camera / permission");
      }
      localStreamRef.current = stream;
      setLocalAttachEpoch((e) => e + 1);
      if (localVideoRef.current && type === "video") {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.muted = true;
        void localVideoRef.current.play().catch(() => {});
      }
      return stream;
    } catch (err) {
      const e = err as DOMException;
      let errType: MediaErrorType = "unknown";
      let message = "Could not access media devices.";
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        errType = "permission-denied";
        message =
          "Microphone/camera permission denied. Please allow access in your browser settings.";
      } else if (e.name === "NotFoundError" || e.name === "DevicesNotFoundError") {
        errType = "no-device";
        message = "No microphone or camera found. Please connect a device and try again.";
      } else if (e.name === "OverconstrainedError") {
        errType = "overconstrained";
        message = "Camera settings not supported by your device.";
      }
      setMediaError({ type: errType, message });
      return null;
    }
  }, []);

  const restartIceProperly = useCallback(async () => {
    const pc = pcRef.current;
    const callId = callDocRef.current;
    if (!pc || !callId) return;
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      await updateDoc(doc(db, "rooms", roomId, "calls", callId), {
        offer: {
          type: offer.type,
          sdp: offer.sdp,
        },
      });
      console.log("[ICE] Restart via renegotiation");
    } catch (e) {
      console.error("[ICE] Restart failed", e);
    }
  }, [roomId]);

  /** Retry flow: restart ICE, then renegotiate, then terminal end (caller-controlled). */
  const scheduleConnectionFailure = useCallback(() => {
    if (!isCallerRef.current) return;
    clearConnectionFailTimeout();
    connectionFailTimeoutRef.current = setTimeout(() => {
      const pc = pcRef.current;
      if (!pc) return;
      if (connectedRef.current || pc.connectionState === "connected" || pc.iceConnectionState === "connected") return;
      retryAttemptRef.current += 1;
      console.log("[TIMEOUT] connection failure attempt", retryAttemptRef.current);
      if (retryAttemptRef.current > MAX_RETRIES) {
        showNetworkRestrictionMessage(true);
        void retryCallRef.current("failure");
        return;
      }
      if (retryAttemptRef.current === 1) {
        void restartIceProperly();
        return;
      }
      void (async () => {
        await new Promise((res) => setTimeout(res, 1500));
        void retryCallRef.current("auto");
      })();
    }, CONNECTING_TIMEOUT_MS);
  }, [clearConnectionFailTimeout, showNetworkRestrictionMessage, restartIceProperly]);

  const createPeerConnection = useCallback((): RTCPeerConnection => {
    const iceConfig = retryAttemptRef.current >= 2 ? FALLBACK_ICE_CONFIG : ICE_CONFIG;
    console.log("[ICE] using config", retryAttemptRef.current >= 2 ? "fallback" : "primary");
    const pc = new RTCPeerConnection(iceConfig);
    pcRef.current = pc;
    // Do not call addTransceiver here — addTrack (below) already creates sendrecv m-lines.
    // Extra transceivers duplicate m= sections and commonly break remote video/audio.

    pc.ontrack = (event) => {
      console.log("[TRACK RECEIVED]", event.streams);
      if (!event.streams || event.streams.length === 0) {
        console.warn("[TRACK] No streams received");
        return;
      }
      const remoteStream = event.streams[0];
      remoteStreamRef.current = remoteStream;

      remoteStream.getTracks().forEach((track) => {
        track.onended = () => {
          console.log("[TRACK] ended");
          if (connectedRef.current && callStateRef.current !== "ended") {
            setCallState("reconnecting");
            void retryCallRef.current("track-ended");
          }
        };
      });

      console.log(remoteStream.getTracks());
      setRemoteAttachEpoch((e) => e + 1);

      const attachStream = () => {
        if (!remoteVideoRef.current) return;
        console.log("[ATTACH STREAM]");
        const el = remoteVideoRef.current;
        el.srcObject = remoteStream;
        el.playsInline = true;
        const tryPlayVideo = () => {
          void el.play().catch(() => {
            window.setTimeout(() => void el.play().catch(() => {}), 300);
          });
        };
        el.onloadedmetadata = tryPlayVideo;
        tryPlayVideo();
        console.log("[REMOTE VIDEO SRC]", el.srcObject);
      };

      if (lastCallTypeRef.current === "video") {
        if (remoteVideoRef.current) {
          attachStream();
        } else {
          console.warn("[VIDEO REF NOT READY] retrying...");
          setTimeout(attachStream, 200);
        }
      }

      const attachAudio = () => {
        const audioEl = remoteAudioRef.current;
        if (!audioEl) return;
        audioEl.srcObject = remoteStream;
        audioEl.muted = false;
        audioEl.volume = 1;
        const tryPlay = () => {
          void audioEl.play().catch(() => {
            window.setTimeout(() => void audioEl.play().catch(() => {}), 300);
          });
        };
        audioEl.onloadedmetadata = tryPlay;
        tryPlay();
      };
      if (remoteAudioRef.current) {
        attachAudio();
      } else {
        setTimeout(attachAudio, 200);
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log("[CONNECTION STATE]", pc.connectionState);
      console.log("[CALL_FLOW]", {
        state,
        ice: pc.iceConnectionState,
        signaling: pc.signalingState,
      });
      console.log("[STATE]", callStateRef.current);
      console.log("[ICE]", pc.iceConnectionState);
      console.log("[CONNECTION]", pc.connectionState);
      void maybeMarkConnected(pc);
      if (state === "connecting" || state === "new") {
        if (callStateRef.current !== "calling" && callStateRef.current !== "incoming") {
          setCallState("connecting");
        }
      }
      if (state === "failed") {
        console.warn("[ERROR] connectionState failed");
        clearConnectingTimeout();
        if (!connectedRef.current) scheduleConnectionFailure();
      }
      if (state === "disconnected") {
        if (connectedRef.current) {
          setCallState("reconnecting");
          scheduleConnectionFailure();
        }
      }
    };

    pc.oniceconnectionstatechange = () => {
      const ice = pc.iceConnectionState;
      console.log("[ICE]", ice);
      void maybeMarkConnected(pc);
      if (ice === "failed" && !connectedRef.current) {
        scheduleConnectionFailure();
      }
    };

    pc.onicegatheringstatechange = () => {
      console.log("ICE gathering:", pc.iceGatheringState);
    };

    return pc;
  }, [scheduleConnectionFailure, maybeMarkConnected, setCallState]);

  const onMissedCallRef = useRef(onMissedCall);
  onMissedCallRef.current = onMissedCall;

  const endCall = useCallback(async (options?: { skipMissedPatch?: boolean }) => {
    if (callStateRef.current === "ended") return;
    const skipMissed = options?.skipMissedPatch === true;
    const prevCallState = callStateRef.current;
    const docId = callDocRef.current;
    const wasCaller = isCallerRef.current;
    const wasConnected = connectedRef.current;

    if (
      !skipMissed &&
      docId &&
      wasCaller &&
      prevCallState === "calling" &&
      !wasConnected &&
      !terminalEventRef.current
    ) {
      console.log("[CALL ENDED BEFORE ANSWER → MISSED]");
      try {
        await writeCallDocPatch(docId, { status: "missed" });
        await emitTerminalOnce(docId, "missed");
      } catch {
        /* offline / rules */
      }
      window.setTimeout(() => {
        void endCallRef.current({ skipMissedPatch: true });
      }, 300);
      return;
    }

    setCallState("ended");
    snapshotActiveRef.current = false;
    const durationSecs =
      wasConnected && callStartedAtRef.current
        ? Math.max(1, Math.floor((Date.now() - callStartedAtRef.current) / 1000))
        : undefined;
    if (wasConnected && wasCaller && docId) {
      await emitTerminalOnce(docId, "completed", durationSecs);
    }
    clearRingTimeout();
    clearConnectionFailTimeout();
    clearConnectingTimeout();
    stopTimer();

    snapshotUnsubsRef.current.forEach((fn) => fn());
    snapshotUnsubsRef.current = [];

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (pcRef.current) {
      const pc = pcRef.current;
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.onicegatheringstatechange = null;
      pc.close();
      pcRef.current = null;
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    remoteStreamRef.current = null;
    setCallDuration(0);
    setIsMuted(false);
    setIsCameraOff(false);
    setIsMinimized(false);
    setConnectionError(null);
    iceRestartAttemptedRef.current = false;
    isCallerRef.current = false;
    connectedRef.current = false;
    callStartedAtRef.current = null;

    if (docId) {
      try {
        await writeCallDocPatch(docId, { status: "ended" });
      } catch {
        /* offline / rules */
      }
      void deleteCallDocumentTree(roomId, docId);
      callDocRef.current = null;
    }
    setCallState("idle");
  }, [
    roomId,
    clearRingTimeout,
    clearConnectionFailTimeout,
    clearConnectingTimeout,
    stopTimer,
    emitTerminalOnce,
    setCallState,
    writeCallDocPatch,
  ]);

  endCallRef.current = endCall;

  const startCall = useCallback(
    async (type: CallType) => {
      if (!userId) return;
      if (callStateRef.current !== "idle") return;

      isCallerRef.current = true;
      snapshotActiveRef.current = true;
      lastCallTypeRef.current = type;

      setCallType(type);
      setCallState("calling");
      setConnectionError(null);

      const stream = await getMedia(type);
      if (!stream) {
        setCallState("idle");
        return;
      }

      const pc = createPeerConnection();
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      const videoSender = pc.getSenders().find((s) => s.track?.kind === "video");
      if (videoSender) {
        const params = videoSender.getParameters();
        // ~150k was far too low for usable video and caused broken/washed streams on many networks.
        params.encodings = [{ maxBitrate: 1_500_000, networkPriority: "high" }];
        void videoSender.setParameters(params).catch(() => {});
      }
      console.log("Caller tracks:", stream.getTracks());
      console.log("Caller senders:", pc.getSenders());
      console.log("Receivers:", pc.getReceivers());

      pendingCandidatesRef.current.answer = [];
      let remoteDescSet = false;

      const flushPendingAnswerCandidates = () => {
        remoteDescSet = true;
        for (const c of pendingCandidatesRef.current.answer.splice(0)) {
          void pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        }
      };

      const callRef = collection(db, "rooms", roomId, "calls");
      console.log("[WRITE STATUS]", "calling", "FROM", callStateRef.current);
      const callDoc = await addDoc(callRef, {
        callerId: userId,
        type,
        status: "calling",
        createdAt: serverTimestamp(),
        acceptedAt: null,
        connectedAt: null,
      });
      callDocRef.current = callDoc.id;
      emittedEventsRef.current.clear();
      terminalEventRef.current = null;
      await emitOnce(callDoc.id, "calling");

      ringTimeoutRef.current = setTimeout(() => {
        if (callStateRef.current !== "calling") {
          console.warn("[TIMEOUT] Skip ring end — not in calling state");
          return;
        }
        if (connectedRef.current) return;
        if (callDocRef.current !== callDoc.id) return;
        if (pcRef.current?.connectionState === "connected") return;
        if (terminalEventRef.current) return;
        console.log("[CALL TIMEOUT] Missed call");
        void (async () => {
          try {
            await writeCallDocPatch(callDoc.id, { status: "missed" });
            await emitTerminalOnce(callDoc.id, "missed");
          } catch {
            /* offline / rules */
          }
          showNetworkRestrictionMessage(false);
          window.setTimeout(() => {
            void endCallRef.current({ skipMissedPatch: true });
          }, 300);
        })();
      }, CALL_RING_TIMEOUT_MS);

      if (pc.signalingState !== "stable") return;
      try {
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: type === "video",
        });
        await pc.setLocalDescription(offer);
        console.log("LOCAL SDP SET:", pc.localDescription);
        await updateDoc(doc(db, "rooms", roomId, "calls", callDoc.id), {
          offer: { type: offer.type, sdp: offer.sdp },
        });
      } catch (err) {
        console.error("[ERROR] failed creating/sending offer", err);
        void endCallRef.current();
        return;
      }

      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        void addDoc(
          collection(db, "rooms", roomId, "calls", callDoc.id, "offerCandidates"),
          e.candidate.toJSON()
        ).catch(() => {});
      };

      const unsubCandidates = onSnapshot(
        collection(db, "rooms", roomId, "calls", callDoc.id, "answerCandidates"),
        (snap) => {
          if (callStateRef.current === "ended") return;
          snap.docChanges().forEach((change) => {
            if (change.type !== "added") return;
            const cand = change.doc.data() as RTCIceCandidateInit;
            if (remoteDescSet) {
              pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
            } else {
              pendingCandidatesRef.current.answer.push(cand);
            }
          });
        }
      );
      snapshotUnsubsRef.current.push(unsubCandidates);

      const unsubAnswer = onSnapshot(doc(db, "rooms", roomId, "calls", callDoc.id), async (snap) => {
        if (callStateRef.current === "ended") return;
        if (!snapshotActiveRef.current) {
          console.warn("[SNAPSHOT] inactive, skipping");
          return;
        }
        const data = snap.data();
        if (!data) return;
        console.log("[FIRESTORE DATA]", data);
        console.log("CALL STATUS UPDATE:", data.status);
        console.log("CONNECTED:", connectedRef.current);

        if (data.answer) {
          try {
            if (!pc.currentRemoteDescription) {
              console.log("[ANSWER] Applying remote answer");
              clearRingTimeout();
              console.log("[TIMEOUT] Ring timeout cleared");
              clearConnectingTimeout();
              connectingTimeoutRef.current = setTimeout(() => {
                const p = pcRef.current;
                if (!p) return;
                if (connectedRef.current || p.connectionState === "connected" || p.iceConnectionState === "connected") return;
                console.warn("Connection timeout - retrying instead of ending");
                if (!iceRestartAttemptedRef.current) {
                  iceRestartAttemptedRef.current = true;
                  void restartIceProperly();
                  return;
                }
                void (async () => {
                  await new Promise((res) => setTimeout(res, 1500));
                  void retryCallRef.current("auto");
                })();
              }, CONNECTING_TIMEOUT_MS);
              const ans = data.answer as { type?: string; sdp?: string };
              await pc.setRemoteDescription(
                new RTCSessionDescription({
                  type: (ans.type ?? "answer") as RTCSdpType,
                  sdp: ans.sdp ?? "",
                }),
              );
              console.log("REMOTE SDP SET:", pc.remoteDescription);
              setCallState("connecting");
              console.log("[STATE] -> connecting (answer received)");
              flushPendingAnswerCandidates();
            } else {
              console.log("[ANSWER] Already applied, skipping");
            }
          } catch (e) {
            console.error("[ANSWER ERROR]", e);
            scheduleConnectionFailure();
          }
        }
        if (isCallerRef.current && (data.status === "ended" || data.status === "rejected")) {
          if (data.status === "rejected" && callStateRef.current === "connecting") {
            console.error("[BUG] Rejected snapshot while connecting — ignoring");
            return;
          }
          clearRingTimeout();
          clearConnectingTimeout();
          if (data.status === "rejected" && isCallerRef.current && callDocRef.current === callDoc.id) {
            if (!connectedRef.current) {
              void emitTerminalOnce(callDoc.id, "declined");
            }
          }
          void endCallRef.current();
        }
      });
      snapshotUnsubsRef.current.push(unsubAnswer);
    },
    [userId, roomId, getMedia, createPeerConnection, emitOnce, emitTerminalOnce, showNetworkRestrictionMessage, clearRingTimeout, clearConnectingTimeout, setCallState, writeCallDocPatch]
  );

  // Retry implementation (defined after startCall/endCall exist).
  retryCallRef.current = async (
    reason: "auto" | "manual" | "track-ended" | "network-restore" | "resume" | "failure"
  ) => {
    console.log("[CALL_FLOW] retry reason:", reason);
    await new Promise((res) => setTimeout(res, 1500));
    if (reason !== "failure") {
      await restartIceProperly();
    }

    const type = lastCallTypeRef.current;
    const wasCaller = isCallerRef.current;

    await endCallRef.current();

    // Auto retry: only original caller retries to avoid both sides racing.
    if ((reason === "auto" || reason === "failure") && !wasCaller) return;

    setTimeout(() => {
      void startCall(type);
    }, 1500);
  };

  const answerCall = useCallback(
    async (callId: string) => {
      try {
        console.log("[ANSWER FLOW] STARTED");
        console.log("[STATE BEFORE ACCEPT]", callStateRef.current);
        if (!userId) return;
        if (callStateRef.current !== "incoming") return;

        isCallerRef.current = false;

        const snap = await getDocs(collection(db, "rooms", roomId, "calls"));
        const callDocSnap = snap.docs.find((d) => d.id === callId);
        if (!callDocSnap) return;
        const callData = callDocSnap.data();

        const type = callData.type as CallType;
        const offer = callData.offer as { type?: string; sdp?: string } | undefined;
        if (!offer || !offer.sdp || !offer.type) {
          console.error("[ACCEPT ERROR]", new Error("Invalid offer received"));
          setConnectionError("Could not accept call (invalid offer).");
          setCallState("idle");
          snapshotActiveRef.current = false;
          return;
        }

        setCallType(type);
        callDocRef.current = callId;
        lastCallTypeRef.current = type;
        emittedEventsRef.current.clear();
        terminalEventRef.current = null;
        setConnectionError(null);
        snapshotActiveRef.current = true;

        // 1) Media first — no Firestore "connecting" until SDP is ready (avoids reject races).
        const stream = await getMedia(type);
        if (!stream) {
          console.error("[ACCEPT ERROR]", new Error("getUserMedia failed — not writing Firestore"));
          setCallState("idle");
          callDocRef.current = null;
          snapshotActiveRef.current = false;
          return;
        }
        console.log("[STEP] got media");

        const pc = createPeerConnection();
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
        const videoSender = pc.getSenders().find((s) => s.track?.kind === "video");
        if (videoSender) {
          const params = videoSender.getParameters();
          params.encodings = [{ maxBitrate: 1_500_000, networkPriority: "high" }];
          void videoSender.setParameters(params).catch(() => {});
        }
        console.log("Callee tracks:", stream.getTracks());
        console.log("Callee senders:", pc.getSenders());
        console.log("Receivers:", pc.getReceivers());

        pendingCandidatesRef.current.offer = [];
        let remoteDescSet = false;

        const unsubOfferCandidates = onSnapshot(
          collection(db, "rooms", roomId, "calls", callId, "offerCandidates"),
          (snap) => {
            if (callStateRef.current === "ended") return;
            snap.docChanges().forEach((change) => {
              if (change.type !== "added") return;
              const cand = change.doc.data() as RTCIceCandidateInit;
              if (remoteDescSet) {
                pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
              } else {
                pendingCandidatesRef.current.offer.push(cand);
              }
            });
          }
        );
        snapshotUnsubsRef.current.push(unsubOfferCandidates);

        setCallState("connecting");
        clearConnectingTimeout();
        connectingTimeoutRef.current = setTimeout(() => {
          const p = pcRef.current;
          if (!p) return;
          if (connectedRef.current || p.connectionState === "connected" || p.iceConnectionState === "connected") return;
          console.warn("Connection timeout - retrying instead of ending");
          if (!iceRestartAttemptedRef.current) {
            iceRestartAttemptedRef.current = true;
            void restartIceProperly();
            return;
          }
          void (async () => {
            await new Promise((res) => setTimeout(res, 1500));
            void retryCallRef.current("auto");
          })();
        }, CONNECTING_TIMEOUT_MS);

        await pc.setRemoteDescription(
          new RTCSessionDescription({
            type: offer.type as RTCSdpType,
            sdp: offer.sdp,
          }),
        );
        console.log("[STEP] remote desc set");
        console.log("REMOTE SDP SET:", pc.remoteDescription);
        remoteDescSet = true;
        for (const c of pendingCandidatesRef.current.offer.splice(0)) {
          await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        }

        const answer = await pc.createAnswer();
        console.log("[STEP] answer created");
        await pc.setLocalDescription(answer);
        console.log("[STEP] local desc set");
        console.log("LOCAL SDP SET:", pc.localDescription);

        // Single Firestore update after local SDP is set — "rejected" must never appear in accept flow.
        console.log("[STEP] writing to firestore");
        await writeCallDocPatch(callId, {
          status: "connecting",
          acceptedAt: serverTimestamp(),
          answer: { type: "answer", sdp: answer.sdp },
        });

        clearRingTimeout();
        console.log("[TIMEOUT] Ring timeout cleared");

        pc.onicecandidate = (e) => {
          if (!e.candidate) return;
          void addDoc(
            collection(db, "rooms", roomId, "calls", callId, "answerCandidates"),
            e.candidate.toJSON()
          ).catch(() => {});
        };

        const unsubEnd = onSnapshot(doc(db, "rooms", roomId, "calls", callId), (s) => {
          if (callStateRef.current === "ended") return;
          if (!snapshotActiveRef.current) return;
          const data = s.data();
          if (!data) return;
          console.log("CALL STATUS UPDATE:", data.status);
          console.log("CONNECTED:", connectedRef.current);
          if (data.status === "rejected" && callStateRef.current === "connecting") {
            console.error("[BUG] Rejected triggered after accept — ignoring");
            return;
          }
          if (
            isCallerRef.current &&
            (data.status === "ended" || data.status === "rejected") &&
            connectedRef.current
          ) {
            clearRingTimeout();
            clearConnectingTimeout();
            void endCallRef.current();
          }
        });
        snapshotUnsubsRef.current.push(unsubEnd);
      } catch (e) {
        console.error("[ANSWER FLOW ERROR]", e);
        console.error("[ACCEPT ERROR]", e, "accept-failed");
        setConnectionError("Could not complete accept. Ending call.");
        await endCallRef.current();
      }
    },
    [
      userId,
      roomId,
      getMedia,
      createPeerConnection,
      clearRingTimeout,
      clearConnectingTimeout,
      writeCallDocPatch,
      restartIceProperly,
      setCallState,
    ]
  );

  const rejectCall = useCallback(
    async (callId: string) => {
      try {
        await safeReject(callId);
      } catch {
        /* */
      }
      setCallState("idle");
    },
    [safeReject]
  );

  useEffect(() => {
    if (!userId || !roomId) return undefined;
    const unsub = onSnapshot(collection(db, "rooms", roomId, "calls"), (snap) => {
      if (callStateRef.current === "ended") return;
      snap.docChanges().forEach((change) => {
        if (change.type === "added") {
          const data = change.doc.data();
          if (data.callerId !== userId && data.status === "calling") {
            setCallStatus((prev) => {
              if (prev === "idle") {
                callDocRef.current = change.doc.id;
                setCallType(data.type as CallType);
                callStateRef.current = "incoming";
                return "incoming";
              }
              return prev;
            });
          }
        }
        if (change.type === "modified") {
          if (callStateRef.current === "ended") return;
          const data = change.doc.data();
          console.log("CALL STATUS UPDATE:", data.status);
          console.log("CONNECTED:", connectedRef.current);
          if (data.status === "rejected" && callStateRef.current === "connecting") {
            console.error("[BUG] Rejected triggered after accept — ignoring");
            return;
          }
          if (
            !isCallerRef.current &&
            data.status === "missed" &&
            callDocRef.current === change.doc.id &&
            callStateRef.current === "incoming"
          ) {
            onMissedCallRef.current?.();
            callDocRef.current = null;
            cleanupRef.current();
            setCallState("idle");
            return;
          }
          if (
            !isCallerRef.current &&
            (data.status === "ended" || data.status === "rejected") &&
            callDocRef.current === change.doc.id &&
            callStateRef.current === "incoming"
          ) {
            callDocRef.current = null;
            cleanupRef.current();
            setCallState("idle");
            return;
          }
          if (
            isCallerRef.current &&
            (data.status === "ended" || data.status === "rejected") &&
            callDocRef.current === change.doc.id
          ) {
            callDocRef.current = null;
            cleanupRef.current();
            setCallState("idle");
          }
        }
      });
    });
    return () => unsub();
  }, [userId, roomId]);

  const toggleMute = useCallback(() => {
    localStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !t.enabled;
    });
    setIsMuted((m) => !m);
  }, []);

  const toggleCamera = useCallback(() => {
    localStreamRef.current?.getVideoTracks().forEach((t) => {
      t.enabled = !t.enabled;
    });
    setIsCameraOff((c) => !c);
  }, []);

  const switchCamera = useCallback(async () => {
    if (!localStreamRef.current || !pcRef.current) return;
    const oldTrack = localStreamRef.current.getVideoTracks()[0];
    if (!oldTrack) return;

    const settingsFacing = oldTrack.getSettings().facingMode as string | undefined;
    let nextFacing: "user" | "environment";
    if (settingsFacing === "environment" || settingsFacing === "user") {
      nextFacing = settingsFacing === "user" ? "environment" : "user";
      flipFacingRef.current = nextFacing;
    } else {
      flipFacingRef.current = flipFacingRef.current === "user" ? "environment" : "user";
      nextFacing = flipFacingRef.current;
    }

    const replaceVideoTrack = async (newTrack: MediaStreamTrack) => {
      const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === "video");
      if (sender) await sender.replaceTrack(newTrack);
      localStreamRef.current!.removeTrack(oldTrack);
      localStreamRef.current!.addTrack(newTrack);
      if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
      oldTrack.stop();
    };

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: nextFacing }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const newTrack = newStream.getVideoTracks()[0];
      if (newTrack) await replaceVideoTrack(newTrack);
    } catch {
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { exact: nextFacing } },
          audio: false,
        });
        const newTrack = newStream.getVideoTracks()[0];
        if (newTrack) await replaceVideoTrack(newTrack);
      } catch {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const cameras = devices.filter((d) => d.kind === "videoinput");
          if (cameras.length < 2) return;
          const currentId = oldTrack.getSettings().deviceId;
          const other = cameras.find((c) => c.deviceId && c.deviceId !== currentId);
          if (!other?.deviceId) return;
          const newStream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: other.deviceId } },
            audio: false,
          });
          const newTrack = newStream.getVideoTracks()[0];
          if (newTrack) await replaceVideoTrack(newTrack);
        } catch {
          /* */
        }
      }
    }
  }, []);

  const dismissMediaError = useCallback(() => setMediaError(null), []);
  const dismissConnectionError = useCallback(() => setConnectionError(null), []);

  return {
    callStatus,
    callType,
    isMuted,
    isCameraOff,
    callDuration,
    isMinimized,
    setIsMinimized,
    mediaError,
    connectionError,
    dismissMediaError,
    dismissConnectionError,
    retryCall: () => retryCallRef.current("manual"),
    localVideoRef,
    remoteVideoRef,
    remoteAudioRef,
    startCall,
    answerCall,
    endCall,
    rejectCall,
    toggleMute,
    toggleCamera,
    switchCamera,
    incomingCallId: callStatus === "incoming" ? callDocRef.current : null,
  };
}
