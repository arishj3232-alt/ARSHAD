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

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

export function useWebRTC(roomId: string, userId: string | null) {
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [callType, setCallType] = useState<CallType>("audio");
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [isMinimized, setIsMinimized] = useState(false);
  // Store remote stream in state so effects can bind it reactively
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const callDocRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Refs that CallOverlay will bind to its DOM elements
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  // Reactively assign remote stream to DOM elements whenever either changes
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

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    setRemoteStream(null);
    setCallDuration(0);
    setIsMuted(false);
    setIsCameraOff(false);
    setIsMinimized(false);
  }, []);

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
  }, []);

  const getMedia = useCallback(async (type: CallType): Promise<MediaStream> => {
    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: type === "video"
        ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }
        : false,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    localStreamRef.current = stream;
    if (localVideoRef.current && type === "video") {
      localVideoRef.current.srcObject = stream;
      localVideoRef.current.play().catch(() => {});
    }
    return stream;
  }, []);

  const createPeerConnection = useCallback((): RTCPeerConnection => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;

    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      setRemoteStream(stream);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        startTimer();
        setCallStatus("connected");
      }
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        endCall();
      }
    };

    return pc;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTimer]);

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

  const startCall = useCallback(
    async (type: CallType) => {
      if (!userId) return;
      setCallType(type);
      setCallStatus("calling");

      let stream: MediaStream;
      try {
        stream = await getMedia(type);
      } catch {
        setCallStatus("idle");
        return;
      }
      const pc = createPeerConnection();
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      const callRef = collection(db, "rooms", roomId, "calls");
      const callDoc = await addDoc(callRef, {
        callerId: userId,
        type,
        status: "calling",
        createdAt: serverTimestamp(),
      });
      callDocRef.current = callDoc.id;

      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: type === "video",
      });
      await pc.setLocalDescription(offer);

      await updateDoc(doc(db, "rooms", roomId, "calls", callDoc.id), {
        offer: { type: offer.type, sdp: offer.sdp },
      });

      pc.onicecandidate = async (e) => {
        if (e.candidate) {
          try {
            await addDoc(
              collection(db, "rooms", roomId, "calls", callDoc.id, "offerCandidates"),
              e.candidate.toJSON()
            );
          } catch {}
        }
      };

      // Listen for answer
      const unsubAnswer = onSnapshot(
        doc(db, "rooms", roomId, "calls", callDoc.id),
        async (snap) => {
          const data = snap.data();
          if (!data) return;
          if (data.answer && pc.signalingState !== "stable" && !pc.currentRemoteDescription) {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            } catch {}
            unsubAnswer();
          }
          if (data.status === "ended" || data.status === "rejected") {
            endCall();
            unsubAnswer();
          }
        }
      );

      // Listen for answer ICE candidates
      onSnapshot(
        collection(db, "rooms", roomId, "calls", callDoc.id, "answerCandidates"),
        (snap) => {
          snap.docChanges().forEach((change) => {
            if (change.type === "added") {
              try {
                pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
              } catch {}
            }
          });
        }
      );
    },
    [userId, roomId, getMedia, createPeerConnection, endCall]
  );

  const answerCall = useCallback(
    async (callId: string) => {
      if (!userId) return;

      // Get call doc
      const snap = await getDocs(collection(db, "rooms", roomId, "calls"));
      const callDocSnap = snap.docs.find((d) => d.id === callId);
      if (!callDocSnap) return;
      const callData = callDocSnap.data();

      const type = callData.type as CallType;
      setCallType(type);
      callDocRef.current = callId;

      let stream: MediaStream;
      try {
        stream = await getMedia(type);
      } catch {
        setCallStatus("idle");
        return;
      }
      const pc = createPeerConnection();
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      await pc.setRemoteDescription(new RTCSessionDescription(callData.offer));

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await updateDoc(doc(db, "rooms", roomId, "calls", callId), {
        answer: { type: answer.type, sdp: answer.sdp },
        status: "connected",
      });

      pc.onicecandidate = async (e) => {
        if (e.candidate) {
          try {
            await addDoc(
              collection(db, "rooms", roomId, "calls", callId, "answerCandidates"),
              e.candidate.toJSON()
            );
          } catch {}
        }
      };

      // Listen for offer ICE candidates
      onSnapshot(
        collection(db, "rooms", roomId, "calls", callId, "offerCandidates"),
        (snap) => {
          snap.docChanges().forEach((change) => {
            if (change.type === "added") {
              try {
                pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
              } catch {}
            }
          });
        }
      );

      // Listen for end signal
      onSnapshot(doc(db, "rooms", roomId, "calls", callId), (snap) => {
        const data = snap.data();
        if (data?.status === "ended" || data?.status === "rejected") {
          endCall();
        }
      });

      setCallStatus("connected");
      startTimer();
    },
    [userId, roomId, getMedia, createPeerConnection, endCall, startTimer]
  );

  const rejectCall = useCallback(
    async (callId: string) => {
      try {
        await updateDoc(doc(db, "rooms", roomId, "calls", callId), { status: "rejected" });
      } catch {}
      setCallStatus("idle");
    },
    [roomId]
  );

  // Listen for incoming calls
  useEffect(() => {
    if (!userId || !roomId) return;
    const callsRef = collection(db, "rooms", roomId, "calls");
    const unsub = onSnapshot(callsRef, (snap) => {
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
          if (
            (data.status === "ended" || data.status === "rejected") &&
            callDocRef.current === change.doc.id
          ) {
            cleanup();
            setCallStatus("idle");
          }
        }
      });
    });
    return () => unsub();
  }, [userId, roomId, cleanup]);

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

    // Try facing mode swap first (mobile), then device enumeration (desktop)
    const currentFacing = oldTrack.getSettings().facingMode ?? "user";
    const nextFacing = currentFacing === "user" ? "environment" : "user";

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextFacing },
        audio: false,
      });
      const newTrack = newStream.getVideoTracks()[0];
      const sender = pcRef.current.getSenders().find((s) => s.track?.kind === "video");
      if (sender) await sender.replaceTrack(newTrack);
      localStreamRef.current.removeTrack(oldTrack);
      localStreamRef.current.addTrack(newTrack);
      if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
      oldTrack.stop();
    } catch {
      // Fallback: enumerate devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter((d) => d.kind === "videoinput");
      if (cameras.length < 2) return;
      const currentId = oldTrack.getSettings().deviceId;
      const other = cameras.find((c) => c.deviceId !== currentId);
      if (!other) return;
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: other.deviceId } },
        audio: false,
      });
      const newTrack = newStream.getVideoTracks()[0];
      const sender = pcRef.current.getSenders().find((s) => s.track?.kind === "video");
      if (sender) await sender.replaceTrack(newTrack);
      localStreamRef.current.removeTrack(oldTrack);
      localStreamRef.current.addTrack(newTrack);
      if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
      oldTrack.stop();
    }
  }, []);

  return {
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
