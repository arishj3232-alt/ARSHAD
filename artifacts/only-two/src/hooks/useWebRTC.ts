import { useState, useEffect, useRef, useCallback } from "react";
import {
  collection,
  doc,
  addDoc,
  onSnapshot,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  getDocs,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export type CallType = "audio" | "video";
export type CallStatus =
  | "idle"
  | "calling"
  | "incoming"
  | "connected"
  | "ended";

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export function useWebRTC(roomId: string, userId: string | null) {
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [callType, setCallType] = useState<CallType>("audio");
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [isMinimized, setIsMinimized] = useState(false);

  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const callDocRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

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
    setCallDuration(0);
    setIsMuted(false);
    setIsCameraOff(false);
    setIsMinimized(false);
  }, []);

  const startTimer = useCallback(() => {
    timerRef.current = setInterval(() => {
      setCallDuration((d) => d + 1);
    }, 1000);
  }, []);

  const getMedia = useCallback(async (type: CallType) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: type === "video",
    });
    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    return stream;
  }, []);

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;

    pc.ontrack = (event) => {
      remoteStreamRef.current = event.streams[0];
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    return pc;
  }, []);

  const startCall = useCallback(
    async (type: CallType) => {
      if (!userId) return;
      setCallType(type);
      setCallStatus("calling");

      const stream = await getMedia(type);
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

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await updateDoc(doc(db, "rooms", roomId, "calls", callDoc.id), {
        offer: { type: offer.type, sdp: offer.sdp },
      });

      pc.onicecandidate = async (e) => {
        if (e.candidate) {
          await addDoc(
            collection(
              db,
              "rooms",
              roomId,
              "calls",
              callDoc.id,
              "offerCandidates"
            ),
            e.candidate.toJSON()
          );
        }
      };

      const unsub = onSnapshot(
        doc(db, "rooms", roomId, "calls", callDoc.id),
        async (snap) => {
          const data = snap.data();
          if (!data) return;
          if (data.answer && !pc.currentRemoteDescription) {
            await pc.setRemoteDescription(
              new RTCSessionDescription(data.answer)
            );
            setCallStatus("connected");
            startTimer();
            unsub();
          }
          if (data.status === "ended") {
            endCall();
            unsub();
          }
        }
      );

      onSnapshot(
        collection(
          db,
          "rooms",
          roomId,
          "calls",
          callDoc.id,
          "answerCandidates"
        ),
        (snap) => {
          snap.docChanges().forEach((change) => {
            if (change.type === "added") {
              pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
            }
          });
        }
      );
    },
    [userId, roomId, getMedia, createPeerConnection, startTimer]
  );

  const answerCall = useCallback(
    async (callId: string) => {
      if (!userId) return;
      const callDocSnap = await getDocs(
        collection(db, "rooms", roomId, "calls")
      );
      const callData = callDocSnap.docs.find((d) => d.id === callId)?.data();
      if (!callData) return;

      setCallType(callData.type);
      setCallStatus("connected");
      callDocRef.current = callId;

      const stream = await getMedia(callData.type);
      const pc = createPeerConnection();
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      await pc.setRemoteDescription(
        new RTCSessionDescription(callData.offer)
      );

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await updateDoc(doc(db, "rooms", roomId, "calls", callId), {
        answer: { type: answer.type, sdp: answer.sdp },
        status: "connected",
      });

      pc.onicecandidate = async (e) => {
        if (e.candidate) {
          await addDoc(
            collection(
              db,
              "rooms",
              roomId,
              "calls",
              callId,
              "answerCandidates"
            ),
            e.candidate.toJSON()
          );
        }
      };

      onSnapshot(
        collection(
          db,
          "rooms",
          roomId,
          "calls",
          callId,
          "offerCandidates"
        ),
        (snap) => {
          snap.docChanges().forEach((change) => {
            if (change.type === "added") {
              pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
            }
          });
        }
      );

      startTimer();
    },
    [userId, roomId, getMedia, createPeerConnection, startTimer]
  );

  const endCall = useCallback(async () => {
    cleanup();
    if (callDocRef.current) {
      await updateDoc(
        doc(db, "rooms", roomId, "calls", callDocRef.current),
        { status: "ended" }
      );
      callDocRef.current = null;
    }
    setCallStatus("idle");
  }, [cleanup, roomId]);

  const rejectCall = useCallback(
    async (callId: string) => {
      await updateDoc(doc(db, "rooms", roomId, "calls", callId), {
        status: "rejected",
      });
      setCallStatus("idle");
    },
    [roomId]
  );

  useEffect(() => {
    if (!userId || !roomId) return;
    const callsRef = collection(db, "rooms", roomId, "calls");
    const unsub = onSnapshot(callsRef, (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === "added") {
          const data = change.doc.data();
          if (
            data.callerId !== userId &&
            data.status === "calling" &&
            callStatus === "idle"
          ) {
            setCallStatus("incoming");
            setCallType(data.type);
            callDocRef.current = change.doc.id;
          }
        }
        if (change.type === "modified") {
          const data = change.doc.data();
          if (data.status === "ended" || data.status === "rejected") {
            if (callDocRef.current === change.doc.id) {
              cleanup();
              setCallStatus("idle");
            }
          }
        }
      });
    });
    return () => unsub();
  }, [userId, roomId, callStatus, cleanup]);

  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;
    localStreamRef.current.getAudioTracks().forEach((t) => {
      t.enabled = !t.enabled;
    });
    setIsMuted((m) => !m);
  }, []);

  const toggleCamera = useCallback(() => {
    if (!localStreamRef.current) return;
    localStreamRef.current.getVideoTracks().forEach((t) => {
      t.enabled = !t.enabled;
    });
    setIsCameraOff((c) => !c);
  }, []);

  const switchCamera = useCallback(async () => {
    if (!localStreamRef.current || !pcRef.current) return;
    const oldTrack = localStreamRef.current.getVideoTracks()[0];
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((d) => d.kind === "videoinput");
    if (cameras.length < 2) return;
    const currentId = oldTrack.getSettings().deviceId;
    const other = cameras.find((c) => c.deviceId !== currentId);
    if (!other) return;
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: other.deviceId },
      audio: false,
    });
    const newTrack = newStream.getVideoTracks()[0];
    const sender = pcRef.current
      .getSenders()
      .find((s) => s.track?.kind === "video");
    if (sender) await sender.replaceTrack(newTrack);
    localStreamRef.current.removeTrack(oldTrack);
    localStreamRef.current.addTrack(newTrack);
    if (localVideoRef.current)
      localVideoRef.current.srcObject = localStreamRef.current;
    oldTrack.stop();
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
