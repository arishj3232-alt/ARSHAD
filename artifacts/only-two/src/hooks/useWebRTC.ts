import { useState, useEffect, useRef, useCallback } from "react";
import {
  collection,
  doc,
  addDoc,
  onSnapshot,
  updateDoc,
  serverTimestamp,
  getDocs,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export type CallType = "audio" | "video";
export type CallStatus = "idle" | "calling" | "incoming" | "connected" | "ended";
export type MediaErrorType = "permission-denied" | "no-device" | "overconstrained" | "unknown";

// ─── ICE Server Configuration ────────────────────────────────────────────────
//
// STUN-only will work for ~80% of users (normal home/office NAT).
// The remaining ~20% — mobile carriers, symmetric NAT, strict enterprise
// firewalls — REQUIRE a TURN relay. Set these env vars for production:
//
//   VITE_TURN_URL       e.g. "turn:your.turn.server:3478"
//   VITE_TURN_USERNAME  TURN username
//   VITE_TURN_CREDENTIAL TURN credential
//
// Free TURN via Metered (openrelay) is included as a fallback so that calls
// work out of the box without additional config.
function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
    // Public open-relay TURN (Metered free tier — suitable for low-traffic dev/prod)
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

  // Override with custom TURN if env vars are set
  const turnUrl = import.meta.env.VITE_TURN_URL as string | undefined;
  const turnUser = import.meta.env.VITE_TURN_USERNAME as string | undefined;
  const turnCred = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined;
  if (turnUrl && turnUser && turnCred) {
    servers.push({
      urls: [turnUrl, turnUrl.replace(/^turn:/, "turns:")],
      username: turnUser,
      credential: turnCred,
    });
  }

  return servers;
}

const ICE_CONFIG: RTCConfiguration = {
  iceServers: buildIceServers(),
  iceTransportPolicy: "all", // Use TURN relay only when STUN fails
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useWebRTC(roomId: string, userId: string | null) {
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [callType, setCallType] = useState<CallType>("audio");
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [isMinimized, setIsMinimized] = useState(false);
  const [mediaError, setMediaError] = useState<{ type: MediaErrorType; message: string } | null>(null);

  // Remote stream stored in state so effects can reactively bind it to DOM
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const callDocRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  // All per-call Firestore snapshot unsubs — flushed on cleanup()
  const snapshotUnsubsRef = useRef<Array<() => void>>([]);

  // ─── Reactive DOM binding ─────────────────────────────────────────────────
  useEffect(() => {
    if (!remoteStream) return;
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch(() => {});
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch(() => {});
    }
  }, [remoteStream]);

  // ─── Cleanup ──────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    // Unsubscribe all per-call Firestore snapshot listeners
    snapshotUnsubsRef.current.forEach((fn) => fn());
    snapshotUnsubsRef.current = [];

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    setRemoteStream(null);
    setCallDuration(0);
    setIsMuted(false);
    setIsCameraOff(false);
    setIsMinimized(false);
  }, []);

  // Cleanup on hook unmount (component teardown)
  useEffect(() => () => cleanup(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Timer ────────────────────────────────────────────────────────────────
  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
  }, []);

  // ─── Media access ─────────────────────────────────────────────────────────
  const getMedia = useCallback(async (type: CallType): Promise<MediaStream | null> => {
    setMediaError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: type === "video"
          ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }
          : false,
      });
      localStreamRef.current = stream;
      if (localVideoRef.current && type === "video") {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play().catch(() => {});
      }
      return stream;
    } catch (err) {
      const e = err as DOMException;
      let type: MediaErrorType = "unknown";
      let message = "Could not access media devices.";
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        type = "permission-denied";
        message = "Microphone/camera permission denied. Please allow access in your browser settings.";
      } else if (e.name === "NotFoundError" || e.name === "DevicesNotFoundError") {
        type = "no-device";
        message = "No microphone or camera found. Please connect a device and try again.";
      } else if (e.name === "OverconstrainedError") {
        type = "overconstrained";
        message = "Camera settings not supported by your device.";
      }
      setMediaError({ type, message });
      return null;
    }
  }, []);

  // ─── PeerConnection factory ───────────────────────────────────────────────
  const createPeerConnection = useCallback((): RTCPeerConnection => {
    const pc = new RTCPeerConnection(ICE_CONFIG);
    pcRef.current = pc;

    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      setRemoteStream(stream);

      // Belt-and-suspenders: assign directly too, in case the React effect
      // runs before the audio/video elements are in the DOM.
      requestAnimationFrame(() => {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = stream;
          remoteAudioRef.current.play().catch(() => {});
        }
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
          remoteVideoRef.current.play().catch(() => {});
        }
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") { startTimer(); setCallStatus("connected"); }
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        // Give WebRTC a few seconds to auto-recover before ending the call
        setTimeout(() => {
          if (pcRef.current?.connectionState === "disconnected" || pcRef.current?.connectionState === "failed") {
            endCall();
          }
        }, 5000);
      }
    };

    return pc;
  // endCall defined below — ref-stable; safe to omit
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTimer]);

  // ─── End call ────────────────────────────────────────────────────────────
  const endCall = useCallback(async () => {
    const docId = callDocRef.current;
    cleanup();
    if (docId) {
      try {
        await updateDoc(doc(db, "rooms", roomId, "calls", docId), { status: "ended" });
      } catch {}
      callDocRef.current = null;
    }
    setCallStatus("idle");
  }, [cleanup, roomId]);

  // ─── Start call (caller side) ─────────────────────────────────────────────
  const startCall = useCallback(
    async (type: CallType) => {
      if (!userId) return;
      if (callStatus !== "idle") return; // prevent double-start
      setCallType(type);
      setCallStatus("calling");

      const stream = await getMedia(type);
      if (!stream) { setCallStatus("idle"); return; }

      const pc = createPeerConnection();
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      // Per-call ICE queue — candidates may arrive before setRemoteDescription
      const pendingAnswerCandidates: RTCIceCandidateInit[] = [];
      let remoteDescSet = false;

      const callRef = collection(db, "rooms", roomId, "calls");
      const callDoc = await addDoc(callRef, {
        callerId: userId,
        type,
        status: "calling",
        createdAt: serverTimestamp(),
      });
      callDocRef.current = callDoc.id;

      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: type === "video" });
      await pc.setLocalDescription(offer);
      await updateDoc(doc(db, "rooms", roomId, "calls", callDoc.id), {
        offer: { type: offer.type, sdp: offer.sdp },
      });

      pc.onicecandidate = async (e) => {
        if (e.candidate) {
          try {
            await addDoc(collection(db, "rooms", roomId, "calls", callDoc.id, "offerCandidates"), e.candidate.toJSON());
          } catch {}
        }
      };

      // Answer-side ICE candidates — queue until remote desc is ready
      const unsubCandidates = onSnapshot(
        collection(db, "rooms", roomId, "calls", callDoc.id, "answerCandidates"),
        (snap) => {
          snap.docChanges().forEach((change) => {
            if (change.type !== "added") return;
            const cand = change.doc.data() as RTCIceCandidateInit;
            if (remoteDescSet) {
              pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
            } else {
              pendingAnswerCandidates.push(cand);
            }
          });
        }
      );
      snapshotUnsubsRef.current.push(unsubCandidates);

      // Answer listener — sets remote desc, flushes queue
      const unsubAnswer = onSnapshot(
        doc(db, "rooms", roomId, "calls", callDoc.id),
        async (snap) => {
          const data = snap.data();
          if (!data) return;
          if (data.answer && !pc.currentRemoteDescription) {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
              remoteDescSet = true;
              for (const cand of pendingAnswerCandidates.splice(0)) {
                pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
              }
            } catch {}
          }
          if (data.status === "ended" || data.status === "rejected") {
            endCall();
          }
        }
      );
      snapshotUnsubsRef.current.push(unsubAnswer);
    },
    [userId, roomId, callStatus, getMedia, createPeerConnection, endCall]
  );

  // ─── Answer call (callee side) ─────────────────────────────────────────────
  const answerCall = useCallback(
    async (callId: string) => {
      if (!userId) return;

      const snap = await getDocs(collection(db, "rooms", roomId, "calls"));
      const callDocSnap = snap.docs.find((d) => d.id === callId);
      if (!callDocSnap) return;
      const callData = callDocSnap.data();

      const type = callData.type as CallType;
      setCallType(type);
      callDocRef.current = callId;

      const stream = await getMedia(type);
      if (!stream) { setCallStatus("idle"); return; }

      const pc = createPeerConnection();
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      const pendingOfferCandidates: RTCIceCandidateInit[] = [];
      let remoteDescSet = false;

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(callData.offer));
        remoteDescSet = true;
      } catch {
        setCallStatus("idle");
        return;
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await updateDoc(doc(db, "rooms", roomId, "calls", callId), {
        answer: { type: answer.type, sdp: answer.sdp },
        status: "connected",
      });

      pc.onicecandidate = async (e) => {
        if (e.candidate) {
          try {
            await addDoc(collection(db, "rooms", roomId, "calls", callId, "answerCandidates"), e.candidate.toJSON());
          } catch {}
        }
      };

      // Offer-side ICE candidates from the caller
      const unsubOfferCandidates = onSnapshot(
        collection(db, "rooms", roomId, "calls", callId, "offerCandidates"),
        (snap) => {
          snap.docChanges().forEach((change) => {
            if (change.type !== "added") return;
            const cand = change.doc.data() as RTCIceCandidateInit;
            if (remoteDescSet) {
              pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
            } else {
              pendingOfferCandidates.push(cand);
            }
          });
          if (remoteDescSet && pendingOfferCandidates.length > 0) {
            for (const cand of pendingOfferCandidates.splice(0)) {
              pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
            }
          }
        }
      );
      snapshotUnsubsRef.current.push(unsubOfferCandidates);

      // End-signal from caller
      const unsubEnd = onSnapshot(doc(db, "rooms", roomId, "calls", callId), (snap) => {
        const data = snap.data();
        if (data?.status === "ended" || data?.status === "rejected") endCall();
      });
      snapshotUnsubsRef.current.push(unsubEnd);

      setCallStatus("connected");
      startTimer();
    },
    [userId, roomId, getMedia, createPeerConnection, endCall, startTimer]
  );

  // ─── Reject call ─────────────────────────────────────────────────────────
  const rejectCall = useCallback(
    async (callId: string) => {
      try {
        await updateDoc(doc(db, "rooms", roomId, "calls", callId), { status: "rejected" });
      } catch {}
      setCallStatus("idle");
    },
    [roomId]
  );

  // ─── Incoming call listener ───────────────────────────────────────────────
  useEffect(() => {
    if (!userId || !roomId) return;
    const unsub = onSnapshot(collection(db, "rooms", roomId, "calls"), (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === "added") {
          const data = change.doc.data();
          if (data.callerId !== userId && data.status === "calling") {
            setCallStatus((prev) => {
              if (prev === "idle") {
                callDocRef.current = change.doc.id;
                setCallType(data.type);
                return "incoming";
              }
              return prev;
            });
          }
        }
        if (change.type === "modified") {
          const data = change.doc.data();
          if ((data.status === "ended" || data.status === "rejected") && callDocRef.current === change.doc.id) {
            cleanup();
            setCallStatus("idle");
          }
        }
      });
    });
    return () => unsub();
  }, [userId, roomId, cleanup]);

  // ─── Media controls ───────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !t.enabled; });
    setIsMuted((m) => !m);
  }, []);

  const toggleCamera = useCallback(() => {
    localStreamRef.current?.getVideoTracks().forEach((t) => { t.enabled = !t.enabled; });
    setIsCameraOff((c) => !c);
  }, []);

  const switchCamera = useCallback(async () => {
    if (!localStreamRef.current || !pcRef.current) return;
    const oldTrack = localStreamRef.current.getVideoTracks()[0];
    if (!oldTrack) return;
    const currentFacing = oldTrack.getSettings().facingMode ?? "user";
    const nextFacing = currentFacing === "user" ? "environment" : "user";
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: nextFacing }, audio: false });
      const newTrack = newStream.getVideoTracks()[0];
      const sender = pcRef.current.getSenders().find((s) => s.track?.kind === "video");
      if (sender) await sender.replaceTrack(newTrack);
      localStreamRef.current.removeTrack(oldTrack);
      localStreamRef.current.addTrack(newTrack);
      if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
      oldTrack.stop();
    } catch {
      // Fallback: enumerate devices
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter((d) => d.kind === "videoinput");
        if (cameras.length < 2) return;
        const currentId = oldTrack.getSettings().deviceId;
        const other = cameras.find((c) => c.deviceId !== currentId);
        if (!other) return;
        const newStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: other.deviceId } }, audio: false });
        const newTrack = newStream.getVideoTracks()[0];
        const sender = pcRef.current.getSenders().find((s) => s.track?.kind === "video");
        if (sender) await sender.replaceTrack(newTrack);
        localStreamRef.current.removeTrack(oldTrack);
        localStreamRef.current.addTrack(newTrack);
        if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
        oldTrack.stop();
      } catch {}
    }
  }, []);

  const dismissMediaError = useCallback(() => setMediaError(null), []);

  return {
    callStatus,
    callType,
    isMuted,
    isCameraOff,
    callDuration,
    isMinimized,
    setIsMinimized,
    mediaError,
    dismissMediaError,
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
