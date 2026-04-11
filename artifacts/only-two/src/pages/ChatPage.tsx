import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  KeyboardEvent,
} from "react";
import {
  Send,
  Phone,
  Video,
  Search,
  Image as ImageIcon,
  Mic,
  X,
  Images,
  Video as VideoIcon,
  Plus,
  Paperclip,
  Check,
  Ghost,
  Eye,
  EyeOff,
  WifiOff,
} from "lucide-react";
import { ref, set, onValue, onDisconnect, serverTimestamp } from "firebase/database";
import { rtdb } from "@/lib/firebase";
import { cn, formatDate, formatLastSeen } from "@/lib/utils";
import { useMessages } from "@/hooks/useMessages";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useMediaUpload } from "@/hooks/useMediaUpload";
import { usePresence, useNetworkStatus } from "@/hooks/useSession";
import { useTypingIndicator } from "@/hooks/useTypingIndicator";
import { useRateLimit } from "@/hooks/useRateLimit";
import { useCursorPresence } from "@/hooks/useCursorPresence";
import { useAdmin } from "@/hooks/useAdmin";
import { useNotifications } from "@/hooks/useNotifications";
import { useProfile } from "@/hooks/useProfile";
import { useUserStatus, useOtherUserStatus } from "@/hooks/useUserStatus";
import ChatMessage from "@/components/ChatMessage";
import VoiceRecorder from "@/components/VoiceRecorder";
import VideoNoteRecorder from "@/components/VideoNoteRecorder";
import CallOverlay from "@/components/CallOverlay";
import SearchPanel from "@/components/SearchPanel";
import GalleryPanel from "@/components/GalleryPanel";
import CursorPresence from "@/components/CursorPresence";
import AdminPanel from "@/components/AdminPanel";
import type { Message } from "@/hooks/useMessages";
const TYPING_DEBOUNCE_MS = 1500;

const isMobileDevice =
  typeof window !== "undefined" &&
  ("ontouchstart" in window || navigator.maxTouchPoints > 0);
const LEAVE_BEACON_URL = import.meta.env.VITE_LEAVE_BEACON_URL as string | undefined;

type Props = {
  userId: string;
  userName: string;
  roomCode: string;
  otherId: string | null;
  onForceLogout?: () => void;
  onLeaveRoom?: () => Promise<void> | void;
};

type InputMode = "text" | "voice" | "videonote";

const STATUS_DOT: Record<string, { color: string; label: string }> = {
  online: { color: "bg-emerald-400", label: "Online" },
  recording: { color: "bg-blue-400", label: "Recording voice" },
  viewingMedia: { color: "bg-yellow-400", label: "Viewing media" },
  browsing: { color: "bg-white/60", label: "Browsing" },
  offline: { color: "bg-white/20", label: "" },
};

// Compute "off" keyword from any keyword string — "off" + first 2 chars (lowercase)
function offKeyword(keyword: string): string {
  return "off" + keyword.slice(0, 2).toLowerCase();
}

export default function ChatPage({ userId, userName, roomCode, otherId, onForceLogout, onLeaveRoom }: Props) {
  const ROOM_ID = roomCode;
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingMsg, setEditingMsg] = useState<Message | null>(null);
  const [editText, setEditText] = useState("");
  const [inputMode, setInputMode] = useState<InputMode>("text");
  const [panel, setPanel] = useState<"none" | "search" | "gallery">("none");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showDpMenu, setShowDpMenu] = useState(false);
  const [viewOnceNext, setViewOnceNext] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [roleCount, setRoleCount] = useState(0);
  const [missedCallBanner, setMissedCallBanner] = useState(false);

  // --- Command-driven states ---
  const [ghostMode, setGhostMode] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false); // persistent toggle

  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioFileRef = useRef<HTMLInputElement>(null);
  const dpInputRef = useRef<HTMLInputElement>(null);
  const nearBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { settings, updateSetting } = useAdmin();
  const readReceiptsOn = settings.readReceiptsEnabled !== false;
  const { notify } = useNotifications(settings.notificationsEnabled, userId);
  const presence = usePresence(userId, roomCode);
  const { isConnected } = useNetworkStatus();
  const { check: checkMsgRateLimit } = useRateLimit(5, 10_000); // max 5 messages per 10 s

  const handleLeaveRoom = useCallback(async () => {
    await onLeaveRoom?.();
    try {
      window.history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch {
      // App state already transitions to entry when leaveRoom sets session idle.
    }
  }, [onLeaveRoom]);

  // Derive the other user from live presence — do NOT rely on the null otherId prop
  const otherUser = Object.values(presence).find((u) => u.id !== userId) ?? null;
  const resolvedOtherId = otherUser?.id ?? otherId ?? null;
  const otherName = otherUser?.name
    ?? (Object.keys(presence).length === 0 ? "Connecting…" : "Waiting…");

  const { profile, uploading: dpUploading, uploadDp, deleteDp, getDpUrl } = useProfile(userId);
  const otherDpUrl = resolvedOtherId ? getDpUrl(resolvedOtherId) : null;

  const { setStatus: setMyStatus } = useUserStatus(roomCode, userId);
  const otherStatus = useOtherUserStatus(roomCode, resolvedOtherId);

  // Activity status (suppressed in ghost mode)
  useEffect(() => {
    if (ghostMode) return;
    if (document.hidden) setMyStatus("browsing");
    else if (inputMode === "voice") setMyStatus("recording");
    else if (panel === "gallery") setMyStatus("viewingMedia");
    else if (panel === "search") setMyStatus("browsing");
    else setMyStatus("online");
  }, [inputMode, panel, setMyStatus, ghostMode]);

  // Keep status aligned with tab visibility changes.
  useEffect(() => {
    if (!userId || ghostMode) return undefined;
    const onVisibility = () => {
      if (document.hidden) setMyStatus("browsing");
      else setMyStatus("online");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [userId, setMyStatus, ghostMode]);

  // Force-logout listener
  useEffect(() => {
    if (!userId) return undefined;
    try {
      const unsub = onValue(
        ref(rtdb, `forceLogout/${roomCode}/${userId}`),
        (snap) => {
          if (snap.val() === true) {
            set(ref(rtdb, `forceLogout/${roomCode}/${userId}`), null).catch(() => {});
            sessionStorage.removeItem("onlytwo-user-id");
            sessionStorage.removeItem("onlytwo-user-name");
            sessionStorage.removeItem("onlytwo-role");
            sessionStorage.removeItem("onlytwo-room");
            if (onForceLogout) onForceLogout();
            else window.location.reload();
          }
        },
        () => {}
      );
      return () => unsub();
    } catch {
      return undefined;
    }
  }, [roomCode, userId, onForceLogout]);

  useEffect(() => {
    const rolesRef = ref(rtdb, `rooms/${roomCode}/roles`);
    const unsub = onValue(rolesRef, (snap) => {
      const data = (snap.val() ?? {}) as Record<string, unknown>;
      setRoleCount(Object.keys(data).length);
    });
    return () => unsub();
  }, [roomCode]);

  useEffect(() => {
    // Best-effort only. Real cleanup is guaranteed via RTDB onDisconnect handlers.
    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      if (!LEAVE_BEACON_URL) return;
      try {
        if (navigator.sendBeacon) {
          const payload = JSON.stringify({ roomCode, userId, ts: Date.now(), event: "leave_hint" });
          navigator.sendBeacon(LEAVE_BEACON_URL, payload);
        }
      } catch {
        // Ignore beacon errors.
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [roomCode, userId]);

  // Device registration
  useEffect(() => {
    if (!userId) return undefined;
    const deviceId = `${Date.now() % 100000}_${Math.random().toString(36).slice(2, 5)}`;
    const browser = (() => {
      const ua = navigator.userAgent;
      if (ua.includes("Chrome")) return "Chrome";
      if (ua.includes("Safari")) return "Safari";
      if (ua.includes("Firefox")) return "Firefox";
      return "Browser";
    })();
    const path = `devices/${roomCode}/${userId}/${deviceId}`;
    const deviceRef = ref(rtdb, path);
    try {
      set(deviceRef, {
        browser,
        platform: navigator.platform || "Unknown",
        lastActive: Date.now(),
        online: true,
        userId,
      }).catch(() => {});
      const d = onDisconnect(deviceRef);
      d.set({
        browser,
        platform: navigator.platform || "Unknown",
        lastActive: serverTimestamp(),
        online: false,
        userId,
      }).catch(() => {});
      return () => {
        d.cancel().catch(() => {});
        set(deviceRef, null).catch(() => {});
      };
    } catch {
      return undefined;
    }
  }, [roomCode, userId]);

  const viewOnceTimerMs = Math.max(1, settings.viewOnceTimerSeconds) * 1000;

  const {
    messages,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    sendMessage,
    editMessage,
    deleteForMe,
    deleteForEveryone,
    markSeen,
    addReaction,
    removeReaction,
    markViewOnceViewed,
  } = useMessages(ROOM_ID, userId, viewOnceTimerMs);

  const sendCallEvent = useCallback(
    async (event: {
      callType: "audio" | "video";
      callStatus: "calling" | "declined" | "missed" | "not_picked" | "completed";
      duration?: number;
    }) => {
      await sendMessage({
        type: "call",
        callType: event.callType,
        callStatus: event.callStatus,
        duration: event.duration,
      });
    },
    [sendMessage]
  );

  const { isOtherTyping, setTyping } = useTypingIndicator(ROOM_ID, userId);
  const { uploading, progress, uploadMedia } = useMediaUpload();
  const { otherCursors } = useCursorPresence(roomCode, userId, userName);
  const mediaMessages = useMemo(
    () => messages.filter((m) => !m.deleted && (m.type === "image" || m.type === "video")),
    [messages]
  );

  const {
    callStatus, callType, isMuted, isCameraOff, callDuration,
    isMinimized, setIsMinimized, localVideoRef, remoteVideoRef, remoteAudioRef,
    startCall, answerCall, endCall, rejectCall, toggleMute, toggleCamera,
    switchCamera, incomingCallId, mediaError, dismissMediaError,
    connectionError, dismissConnectionError,
  } = useWebRTC(ROOM_ID, userId, sendCallEvent, () => setMissedCallBanner(true));

  useEffect(() => {
    if (!missedCallBanner) return undefined;
    const t = window.setTimeout(() => setMissedCallBanner(false), 4500);
    return () => window.clearTimeout(t);
  }, [missedCallBanner]);

  /** Service worker focuses an existing /chat tab and sends deep-link hints (no duplicate tab). */
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return undefined;
    const onSwMessage = (e: MessageEvent) => {
      const d = e.data as {
        type?: string;
        user?: string;
        callId?: string;
        roomId?: string;
        action?: string;
      } | null;
      if (!d || typeof d !== "object") return;
      if (d.type === "OPEN_CHAT" && typeof d.user === "string") {
        const u = new URL(window.location.href);
        u.searchParams.set("user", d.user);
        const q = u.searchParams.toString();
        window.history.replaceState({}, "", u.pathname + (q ? `?${q}` : "") + u.hash);
        window.focus();
        return;
      }
      if (d.type === "OPEN_CALL") {
        if (d.roomId && d.roomId !== roomCode) return;
        const u = new URL(window.location.href);
        if (d.callId) u.searchParams.set("callId", d.callId);
        if (d.roomId) u.searchParams.set("roomId", d.roomId);
        if (d.action === "accept") u.searchParams.set("autoAccept", "true");
        else if (d.action === "reject") u.searchParams.set("reject", "true");
        const q = u.searchParams.toString();
        window.history.replaceState({}, "", u.pathname + (q ? `?${q}` : "") + u.hash);
        window.focus();
        setIsMinimized(false);
      }
    };
    navigator.serviceWorker.addEventListener("message", onSwMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onSwMessage);
  }, [roomCode, setIsMinimized]);

  const pushCallBridgeHandledRef = useRef<string | null>(null);

  /** FCM / service worker opens /call?callId=…&roomId=…&autoAccept=… — bridge to answerCall/rejectCall without changing WebRTC internals. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const callId = params.get("callId");
    if (!callId) return;
    const roomParam = params.get("roomId");
    if (roomParam && roomParam !== roomCode) return;

    setIsMinimized(false);

    const clearPushParams = () => {
      const u = new URL(window.location.href);
      ["callId", "autoAccept", "reject", "roomId"].forEach((k) => u.searchParams.delete(k));
      const q = u.searchParams.toString();
      window.history.replaceState({}, "", u.pathname + (q ? `?${q}` : "") + u.hash);
    };

    if (params.get("autoAccept") === "true") {
      const key = `accept:${callId}`;
      if (incomingCallId === callId && callStatus === "incoming") {
        if (pushCallBridgeHandledRef.current === key) return;
        pushCallBridgeHandledRef.current = key;
        console.log("[AUTO ACCEPT FROM NOTIFICATION]");
        void answerCall(callId).finally(() => clearPushParams());
      }
      return;
    }

    if (params.get("reject") === "true") {
      const key = `reject:${callId}`;
      if (incomingCallId === callId && callStatus === "incoming") {
        if (pushCallBridgeHandledRef.current === key) return;
        pushCallBridgeHandledRef.current = key;
        void rejectCall(callId);
        clearPushParams();
      }
      return;
    }

    if (incomingCallId === callId && callStatus === "incoming") {
      setIsMinimized(false);
    }
  }, [roomCode, incomingCallId, callStatus, answerCall, rejectCall, setIsMinimized]);

  // Call-specific status overrides
  useEffect(() => {
    if (ghostMode) return;
    if (document.hidden) return;
    if (callStatus === "connected" && callType === "video") setMyStatus("viewingMedia");
    else if (callStatus === "connected" && callType === "audio") setMyStatus("recording");
    else if (callStatus === "connecting" || callStatus === "calling") setMyStatus("browsing");
  }, [callStatus, callType, setMyStatus, ghostMode]);

  // ============================================================
  // CENTRALIZED KEYWORD ENGINE
  // ============================================================
  const triggerKeyword = useCallback(
    (input: string): boolean => {
      const trimmed = input.trim();
      const lower = trimmed.toLowerCase();

      // --- OFF keywords (off + first 2 chars of keyword, case-insensitive) ---
      if (lower === offKeyword(settings.revealKeyword) && settings.allowReadReceiptToggle) {
        setShowDeleted(false);
        return true;
      }
      if (lower === offKeyword(settings.ghostKeyword) && settings.allowGhostMode) {
        setGhostMode(false);
        return true;
      }
      if (lower === offKeyword(settings.readReceiptKeyword) && settings.allowReadReceiptToggle) {
        void updateSetting("readReceiptsEnabled", false);
        return true;
      }

      // --- ON keywords (exact match, case-sensitive as admin configured) ---
      if (trimmed === settings.adminKeyword) {
        setShowAdmin(true);
        return true;
      }

      if (trimmed === settings.revealKeyword) {
        setShowDeleted((prev) => {
          const next = !prev;
          return next;
        });
        return true;
      }

      if (trimmed === settings.ghostKeyword && settings.allowGhostMode) {
        setGhostMode((prev) => {
          const next = !prev;
          return next;
        });
        return true;
      }

      if (trimmed === settings.readReceiptKeyword && settings.allowReadReceiptToggle) {
        void updateSetting("readReceiptsEnabled", !readReceiptsOn);
        return true;
      }

      return false;
    },
    [settings, readReceiptsOn, updateSetting]
  );

  // Incoming message notifications
  useEffect(() => {
    const prev = prevMessageCountRef.current;
    const curr = messages.length;
    if (curr > prev && prev > 0) {
      const newest = messages[messages.length - 1];
      if (newest && newest.senderId !== userId && !newest.deleted && !newest.ghost) {
        const type = newest.type as "text" | "image" | "video" | "audio" | "call";
        const body =
          type === "text" ? (newest.text?.slice(0, 80) ?? "") :
          type === "image" ? "📸 Photo" :
          type === "video" ? "🎥 Video" :
          type === "audio" ? "🎤 Voice message" :
          type === "call"
            ? `${newest.callType === "video" ? "🎥" : "📞"} ${newest.callStatus === "completed" ? "Call" : "Missed call"}`
            : `Sent a ${type}`;
        notify(otherName, body);
      }
    }
    prevMessageCountRef.current = curr;
  }, [messages, userId, otherName, notify]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "S") { e.preventDefault(); setShowAdmin((p) => !p); }
      if (e.key === "Escape") { setShowAttachMenu(false); setShowDpMenu(false); setShowAdmin(false); setEditingMsg(null); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const isNearBottom = useCallback((): boolean => {
    const el = containerRef.current;
    if (!el) return true;
    const threshold = 150; // px
    return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = containerRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
    });
  }, []);

  // ID-based detection: robust against Firestore array replacement and pagination prepends.
  useEffect(() => {
    if (!messages.length) return;
    const lastMessage = messages[messages.length - 1];

    // First load -> establish baseline and jump to bottom instantly.
    if (!lastMessageIdRef.current) {
      lastMessageIdRef.current = lastMessage.id;
      setNewMessageCount(0);
      scrollToBottom(false);
      return;
    }

    // Same tail message => no-op (covers prepends and snapshot re-emits).
    if (lastMessage.id === lastMessageIdRef.current) return;

    const isIncoming = lastMessage.senderId !== userId;
    if (isIncoming) {
      if (!(nearBottomRef.current || isNearBottom())) {
        setNewMessageCount((prev) => prev + 1);
      } else {
        scrollToBottom(true);
        setNewMessageCount(0);
      }
    } else {
      // Own outgoing message -> always keep anchored to latest.
      scrollToBottom(true);
    }

    lastMessageIdRef.current = lastMessage.id;
  }, [messages, userId, isNearBottom, scrollToBottom]);

  // Mark seen (skipped in ghost mode / when read receipts off)
  useEffect(() => {
    if (!readReceiptsOn || ghostMode) return;
    const unseenFromOther = messages.filter((m) => m.senderId !== userId && !m.seen && !m.deleted && !m.ghost);
    unseenFromOther.forEach((m) => markSeen(m.id));
  }, [messages, userId, markSeen, readReceiptsOn, ghostMode]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    nearBottomRef.current = isNearBottom();
    if (nearBottomRef.current) setNewMessageCount(0);

    if (!hasMore || loadingMore) return;
    if (el.scrollTop < 100) {
      const prev = el.scrollHeight;
      loadMore().then(() => { el.scrollTop = el.scrollHeight - prev; });
    }
  }, [hasMore, loadingMore, loadMore, isNearBottom]);

  // ============================================================
  // SEND / EDIT
  // ============================================================
  const handleSendText = useCallback(async () => {
    if (!settings.messagingEnabled) return;
    const t = text.trim();
    if (!t) return;

    if (triggerKeyword(t)) {
      setText("");
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      setTyping(false);
      return;
    }

    // Rate limit: max 5 messages per 10 seconds
    if (!checkMsgRateLimit()) {
      return;
    }

    setText("");
    setReplyTo(null);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    setTyping(false);

    await sendMessage({
      type: "text",
      text: t,
      replyToId: replyTo?.id,
      replyToText: replyTo?.text?.slice(0, 80),
      ghost: ghostMode,
    });
  }, [text, replyTo, sendMessage, setTyping, settings.messagingEnabled, triggerKeyword, ghostMode, checkMsgRateLimit]);

  const handleEditSubmit = useCallback(async () => {
    if (!editingMsg || !editText.trim()) return;
    await editMessage(editingMsg.id, editText.trim());
    setEditingMsg(null);
    setEditText("");
  }, [editingMsg, editText, editMessage]);

  const startEdit = useCallback((msg: Message) => {
    setEditingMsg(msg);
    setEditText(msg.text ?? "");
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (editingMsg) handleEditSubmit();
      else handleSendText();
    }
    if (e.key === "Escape" && editingMsg) { setEditingMsg(null); setEditText(""); }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    if (editingMsg) { setEditText(val); return; }
    setText(val);
    if (settings.typingIndicatorEnabled && !ghostMode) {
      if (val.length > 0) {
        setTyping(true);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => setTyping(false), TYPING_DEBOUNCE_MS);
      } else {
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        setTyping(false);
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>, isAudio = false) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setShowAttachMenu(false);
    if (file.type.startsWith("image/") && !settings.imageUploadEnabled) return;
    if (file.type.startsWith("video/") && !settings.videoUploadEnabled) return;
    const { url, type } = await uploadMedia(file);
    await sendMessage({
      type: isAudio ? "audio" : type,
      mediaUrl: url,
      replyToId: replyTo?.id,
      replyToText: replyTo?.text?.slice(0, 80),
      viewOnce: !isAudio && viewOnceNext,
      ghost: ghostMode,
    });
    setReplyTo(null);
    setViewOnceNext(false);
  };

  const handleVoiceSend = async (blob: Blob) => {
    const file = new File([blob], `voice_${Date.now()}.webm`, { type: "audio/webm" });
    const { url } = await uploadMedia(file);
    await sendMessage({ type: "audio", mediaUrl: url, ghost: ghostMode });
    setInputMode("text");
  };

  const handleVideoNoteSend = async (blob: Blob) => {
    if (!settings.videoNoteEnabled) return;
    const file = new File([blob], `vidnote_${Date.now()}.webm`, { type: "video/webm" });
    const { url } = await uploadMedia(file);
    await sendMessage({ type: "video", mediaUrl: url, ghost: ghostMode });
    setInputMode("text");
  };

  const safeStartCall = useCallback((type: "audio" | "video") => {
    if (type === "video" && !settings.videoCallEnabled) return;
    if (type === "audio" && !settings.voiceCallsEnabled) return;
    startCall(type);
  }, [settings.videoCallEnabled, settings.voiceCallsEnabled, startCall]);

  const handleReact = useCallback(
    async (messageId: string, emoji: string) => {
      if (!settings.reactionsEnabled) return;
      if (!emoji) await removeReaction(messageId);
      else await addReaction(messageId, emoji);
    },
    [addReaction, removeReaction, settings.reactionsEnabled]
  );

  const handleDeleteForEveryone = useCallback(
    async (messageId: string) => {
      await deleteForEveryone(messageId, settings.deletedText);
    },
    [deleteForEveryone, settings.deletedText]
  );

  const scrollToMessage = useCallback((id: string) => {
    const el = messageRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
      setHighlightId(id);
      highlightTimeoutRef.current = setTimeout(() => setHighlightId(null), 1500);
    }
  }, []);

  const groupedMessages = useMemo(() => {
    const groups: { date: string; msgs: Message[] }[] = [];
    let currentDate = "";
    messages.forEach((msg) => {
      if (msg.ghost && msg.senderId !== userId) return;
      const d = msg.createdAt ? formatDate(msg.createdAt) : "Today";
      if (d !== currentDate) { groups.push({ date: d, msgs: [] }); currentDate = d; }
      groups[groups.length - 1].msgs.push(msg);
    });
    return groups;
  }, [messages, userId]);

  const showCursors = settings.cursorPresenceEnabled && !isMobileDevice;
  const statusDot = STATUS_DOT[otherStatus] ?? STATUS_DOT.offline;
  const activeValue = editingMsg ? editText : text;

  return (
    <div className="flex bg-[#080810] overflow-hidden" style={{ height: "100dvh", userSelect: "none" }}>
      {showCursors && <CursorPresence cursors={otherCursors} />}

      {showAdmin && (
        <AdminPanel settings={settings} onUpdate={updateSetting} onClose={() => setShowAdmin(false)} currentUserId={userId} roomCode={roomCode} />
      )}

      {missedCallBanner && (
        <div
          className="fixed top-0 left-0 right-0 z-[70] px-4 py-3 text-center text-sm text-white bg-violet-950/95 border-b border-violet-500/30 shadow-lg backdrop-blur-md"
          role="status"
        >
          Missed call
        </div>
      )}

      <div className="flex flex-col flex-1 min-w-0 h-full">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 bg-[#0c0c16]/80 backdrop-blur-xl flex-shrink-0">
          {/* Other user's avatar + presence dot */}
          <div className="relative flex-shrink-0">
            <div className="w-9 h-9 rounded-full overflow-hidden bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center shadow-lg shadow-pink-500/20">
              {otherDpUrl ? (
                <img src={otherDpUrl} alt={otherName} className="w-full h-full object-cover" />
              ) : (
                <span className="text-white font-bold text-sm select-none">{otherName[0]?.toUpperCase() ?? "?"}</span>
              )}
            </div>
            <div className={cn("absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#0c0c16]", statusDot.color)} title={statusDot.label} />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm leading-tight">{otherName}</p>
            <p className="text-white/35 text-xs truncate">
              {isOtherTyping && settings.typingIndicatorEnabled && !ghostMode ? (
                <span className="text-pink-400/70">typing…</span>
              ) : otherStatus === "recording" ? (
                <span className="text-blue-400/70">🎙 recording…</span>
              ) : otherStatus === "viewingMedia" ? (
                <span className="text-yellow-400/70">viewing media…</span>
              ) : roleCount < 2 ? (
                "Waiting for other user..."
              ) : roleCount >= 2 ? (
                "Online"
              ) : settings.lastSeenEnabled ? (
                `last seen ${formatLastSeen(otherUser?.lastSeen ?? null)}`
              ) : ""}
            </p>
          </div>

          {!readReceiptsOn && (
            <div title="Read receipts off" className="text-white/20 flex-shrink-0">
              <EyeOff className="w-4 h-4" />
            </div>
          )}

          <div className="flex items-center gap-0.5">
            <HeaderBtn onClick={() => setPanel(panel === "search" ? "none" : "search")} active={panel === "search"} testId="button-search"><Search className="w-4 h-4" /></HeaderBtn>
            <HeaderBtn onClick={() => setPanel(panel === "gallery" ? "none" : "gallery")} active={panel === "gallery"} testId="button-gallery"><Images className="w-4 h-4" /></HeaderBtn>
            {settings.voiceCallsEnabled && <HeaderBtn onClick={() => safeStartCall("audio")} testId="button-voice-call"><Phone className="w-4 h-4" /></HeaderBtn>}
            {settings.videoCallEnabled && <HeaderBtn onClick={() => safeStartCall("video")} testId="button-video-call"><Video className="w-4 h-4" /></HeaderBtn>}
            <button
              onClick={() => { void handleLeaveRoom(); }}
              className="p-2 rounded-lg hover:bg-red-500/20 transition text-white/60 hover:text-red-300"
              title="Leave Room"
            >
              🚪
            </button>
          </div>
        </div>

        {/* Network reconnection banner — shown when RTDB loses connection */}
        {!isConnected && (
          <div className="flex items-center gap-2 px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/20 text-yellow-300/80 text-xs flex-shrink-0">
            <WifiOff className="w-3.5 h-3.5 flex-shrink-0" />
            <span>Connection lost — reconnecting…</span>
          </div>
        )}

        {/* Messages */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 space-y-1"
          style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent" }}
        >
          {loadingMore && (
            <div className="flex justify-center py-2">
              <div className="w-4 h-4 border-2 border-pink-500/30 border-t-pink-500 rounded-full animate-spin" />
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-6 h-6 border-2 border-pink-500/30 border-t-pink-500 rounded-full animate-spin" />
            </div>
          ) : (
            groupedMessages.map(({ date, msgs }) => (
              <div key={date}>
                <div className="flex items-center gap-3 my-5">
                  <div className="flex-1 h-px bg-white/5" />
                  <span className="text-white/20 text-[11px] px-2 bg-white/3 rounded-full py-0.5">{date}</span>
                  <div className="flex-1 h-px bg-white/5" />
                </div>
                <div className="space-y-0.5">
                  {msgs.map((msg) => (
                    <div key={msg.id} ref={(el) => { if (el) messageRefs.current[msg.id] = el; }} className="py-0.5">
                      <ChatMessage
                        message={msg}
                        isOwn={msg.senderId === userId}
                        currentUserId={userId}
                        onDelete={handleDeleteForEveryone}
                        onDeleteForMe={deleteForMe}
                        onDeleteForEveryone={handleDeleteForEveryone}
                        onEdit={startEdit}
                        onReply={settings.repliesEnabled ? setReplyTo : () => {}}
                        onReact={handleReact}
                        onScrollTo={scrollToMessage}
                        onViewOnce={markViewOnceViewed}
                        highlighted={highlightId === msg.id}
                        reactionsEnabled={settings.reactionsEnabled}
                        repliesEnabled={settings.repliesEnabled}
                        reactionEmojis={settings.reactionEmojis}
                        fastReactionEmoji={settings.fastReactionEmoji}
                        replyMode={settings.replyMode}
                        deletedForEveryoneText={settings.deletedText}
                        viewOnceLimitText={settings.viewOnceLimitText}
                        dpUrl={msg.senderId !== userId ? otherDpUrl : null}
                        showDeleted={showDeleted}
                        readReceiptsEnabled={readReceiptsOn}
                        viewOnceEnabled={settings.viewOnceEnabled}
                        viewOnceTimerMs={viewOnceTimerMs}
                        imageDownloadProtection={settings.imageDownloadProtection}
                        onCallAgain={safeStartCall}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}

          {isOtherTyping && settings.typingIndicatorEnabled && !ghostMode && (
            <div className="flex items-center gap-2 px-2 py-1">
              <div className="bg-white/7 backdrop-blur-sm border border-white/8 rounded-2xl rounded-bl-sm px-4 py-3">
                <div className="flex gap-1 items-center h-4">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="w-1.5 h-1.5 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
                  ))}
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {newMessageCount > 0 && (
          <button
            type="button"
            className="fixed bottom-24 right-6 z-[60] px-4 py-2 rounded-full bg-pink-500 text-white shadow-lg flex items-center gap-2 transition-all duration-200 ease-out animate-in fade-in slide-in-from-bottom-2"
            onClick={() => {
              scrollToBottom(false);
              setNewMessageCount(0);
              nearBottomRef.current = true;
            }}
            aria-label="Scroll to newest messages"
          >
            ↓ {newMessageCount > 99 ? "99+" : newMessageCount} new message{newMessageCount === 1 ? "" : "s"}
          </button>
        )}

        {/* Input */}
        <div className="px-3 sm:px-4 flex-shrink-0" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
          {editingMsg && (
            <div className="flex items-center gap-3 bg-violet-500/10 border border-violet-500/20 rounded-xl px-4 py-2.5 mb-2">
              <div className="w-0.5 self-stretch bg-violet-400 rounded-full" />
              <div className="flex-1 min-w-0">
                <p className="text-violet-400 text-xs mb-0.5 font-medium">Editing message</p>
                <p className="text-white/40 text-sm truncate">{editingMsg.text}</p>
              </div>
              <button onClick={() => { setEditingMsg(null); setEditText(""); }} className="text-white/30 hover:text-white/60 transition p-1"><X className="w-4 h-4" /></button>
            </div>
          )}

          {replyTo && !editingMsg && settings.repliesEnabled && (
            <div className="flex items-center gap-3 bg-white/5 border border-white/8 rounded-xl px-4 py-2.5 mb-2">
              <div className="w-0.5 self-stretch bg-pink-500 rounded-full" />
              <div className="flex-1 min-w-0">
                <p className="text-pink-400 text-xs mb-0.5">Replying to</p>
                <p className="text-white/45 text-sm truncate">{replyTo.text ?? "[media]"}</p>
              </div>
              <button onClick={() => setReplyTo(null)} className="text-white/30 hover:text-white/60 transition p-1"><X className="w-4 h-4" /></button>
            </div>
          )}

          {uploading && (
            <div className="mb-2 bg-white/5 border border-white/8 rounded-xl px-4 py-2.5 flex items-center gap-3">
              <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-pink-500 to-violet-600 rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
              <span className="text-white/40 text-xs">{Math.round(progress)}%</span>
            </div>
          )}

          {inputMode === "voice" ? (
            <VoiceRecorder onSend={handleVoiceSend} onCancel={() => setInputMode("text")} />
          ) : inputMode === "videonote" ? (
            <VideoNoteRecorder onSend={handleVideoNoteSend} onCancel={() => setInputMode("text")} disabled={!settings.videoNoteEnabled} />
          ) : (
            <div className="flex items-end gap-2">
              {/* YOUR profile picture — left of input, tap for context menu */}
              <div className="relative flex-shrink-0 self-end pb-1">
                {/* Hidden DP file input */}
                <input
                  ref={dpInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDp(f); e.target.value = ""; }}
                />

                {/* Context menu backdrop */}
                {showDpMenu && (
                  <div className="fixed inset-0 z-30" onClick={() => setShowDpMenu(false)} />
                )}

                {/* Context menu popup */}
                {showDpMenu && (
                  <div className="absolute bottom-full mb-2 left-0 bg-[#1a1a2e] border border-white/10 rounded-2xl overflow-hidden shadow-2xl z-40 w-52">
                    <button
                      onClick={() => { dpInputRef.current?.click(); setShowDpMenu(false); }}
                      className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/5 text-white/70 hover:text-white transition text-sm text-left"
                    >
                      Change profile picture
                    </button>
                    {profile.dpUrl && (
                      <button
                        onClick={() => { deleteDp(); setShowDpMenu(false); }}
                        className="flex items-center gap-3 w-full px-4 py-3 hover:bg-rose-500/10 text-rose-400/70 hover:text-rose-400 transition text-sm text-left"
                      >
                        Remove profile picture
                      </button>
                    )}
                    <button
                      onClick={() => setShowDpMenu(false)}
                      className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/5 text-white/30 hover:text-white/60 transition text-sm text-left border-t border-white/5"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Avatar button */}
                <button
                  onClick={() => setShowDpMenu((p) => !p)}
                  title="Your profile picture"
                  className="w-8 h-8 rounded-full overflow-hidden bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center shadow-md relative"
                >
                  {profile.dpUrl ? (
                    <img src={profile.dpUrl} alt={userName} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-white font-bold text-xs select-none">{userName[0]?.toUpperCase() ?? "?"}</span>
                  )}
                </button>

                {/* Upload progress ring */}
                {dpUploading && (
                  <div className="absolute inset-0 rounded-full border-2 border-pink-500 border-t-transparent animate-spin pointer-events-none" />
                )}
              </div>

            <div className={cn(
              "flex-1 flex items-end gap-2 border rounded-2xl p-2 relative transition-colors duration-200",
              editingMsg ? "bg-violet-500/5 border-violet-500/20"
                : ghostMode ? "bg-violet-900/20 border-violet-500/40 shadow-[0_0_16px_rgba(139,92,246,0.15)]"
                : "bg-white/5 border-white/8"
            )}>
              <input ref={fileInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={(e) => handleFileSelect(e)} />
              <input ref={audioFileRef} type="file" accept="audio/*" className="hidden" onChange={(e) => handleFileSelect(e, true)} />

              {!editingMsg && (
                <div className="relative flex-shrink-0">
                  <button
                    onClick={() => setShowAttachMenu((p) => !p)}
                    className={cn("p-2 rounded-xl transition text-white/40 hover:text-white", showAttachMenu ? "bg-pink-500/20 text-pink-400" : "hover:bg-white/10")}
                    data-testid="button-attach-media"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                  {showAttachMenu && (
                    <div className="absolute bottom-11 left-0 bg-[#1a1a2e] border border-white/10 rounded-2xl overflow-hidden shadow-2xl z-20 w-44">
                      {settings.imageUploadEnabled && (
                        <button onClick={() => { fileInputRef.current?.click(); setShowAttachMenu(false); }} className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/5 text-white/70 hover:text-white transition text-sm">
                          <ImageIcon className="w-4 h-4 text-pink-400" /> Photo / Video
                        </button>
                      )}
                      {settings.videoUploadEnabled && settings.viewOnceEnabled && (
                        <button onClick={() => { setViewOnceNext(true); fileInputRef.current?.click(); setShowAttachMenu(false); }} className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/5 text-white/70 hover:text-white transition text-sm">
                          <ImageIcon className="w-4 h-4 text-violet-400" /> View Once
                        </button>
                      )}
                      {settings.videoNoteEnabled && (
                        <button onClick={() => { if (!settings.videoNoteEnabled) return; setInputMode("videonote"); setShowAttachMenu(false); }} className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/5 text-white/70 hover:text-white transition text-sm">
                          <VideoIcon className="w-4 h-4 text-blue-400" /> Video Note
                        </button>
                      )}
                      <button onClick={() => { audioFileRef.current?.click(); setShowAttachMenu(false); }} className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/5 text-white/70 hover:text-white transition text-sm">
                        <Paperclip className="w-4 h-4 text-emerald-400" /> Audio file
                      </button>
                    </div>
                  )}
                </div>
              )}

              <textarea
                className={cn(
                  "flex-1 bg-transparent placeholder-white/20 resize-none text-sm leading-relaxed focus:outline-none max-h-36 py-2",
                  ghostMode ? "text-violet-200 placeholder-violet-300/30" : "text-white"
                )}
                placeholder={
                  editingMsg ? "Edit your message…"
                    : ghostMode ? "👻 Ghost mode — only you can see this…"
                    : settings.messagingEnabled ? "Write something beautiful…"
                    : "Messaging is disabled"
                }
                rows={1}
                value={activeValue}
                onChange={handleTextChange}
                onKeyDown={handleKeyDown}
                disabled={!settings.messagingEnabled && !editingMsg}
                data-testid="input-message"
                style={{ fieldSizing: "content" } as React.CSSProperties}
              />

              <div className="flex items-center gap-1 flex-shrink-0">
                {settings.voiceMessagesEnabled && !text.trim() && !editingMsg && (
                  <button onClick={() => setInputMode("voice")} className="p-2 rounded-xl hover:bg-white/10 text-white/40 hover:text-white transition" data-testid="button-voice-message">
                    <Mic className="w-5 h-5" />
                  </button>
                )}
                {editingMsg ? (
                  <button onClick={handleEditSubmit} className="p-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-violet-600 text-white hover:opacity-90 active:scale-95 transition-all shadow-lg shadow-violet-500/20">
                    <Check className="w-4 h-4" />
                  </button>
                ) : text.trim() && settings.messagingEnabled ? (
                  <button
                    onClick={handleSendText}
                    className={cn(
                      "p-2.5 rounded-xl text-white hover:opacity-90 active:scale-95 transition-all shadow-lg",
                      ghostMode ? "bg-gradient-to-r from-violet-600 to-violet-800 shadow-violet-500/20" : "bg-gradient-to-r from-pink-500 to-violet-600 shadow-pink-500/20"
                    )}
                    data-testid="button-send"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                ) : null}
              </div>
            </div>
            </div>
          )}
        </div>
      </div>

      {/* Side panels */}
      {panel === "search" && (
        <div className={cn("flex-shrink-0", isMobileDevice ? "fixed inset-y-0 right-0 w-full max-w-sm z-40 shadow-2xl" : "w-72 sm:w-80")}>
          <SearchPanel messages={messages.filter((m) => !m.ghost || m.senderId === userId)} onScrollTo={(id) => { scrollToMessage(id); setPanel("none"); }} onClose={() => setPanel("none")} currentUserId={userId} otherName={otherName} />
        </div>
      )}
      {panel === "gallery" && (
        <div className={cn("flex-shrink-0", isMobileDevice ? "fixed inset-y-0 right-0 w-full max-w-sm z-40 shadow-2xl" : "w-72 sm:w-80")}>
          <GalleryPanel mediaMessages={mediaMessages} loading={loading} onClose={() => setPanel("none")} />
        </div>
      )}

      {/* Remote audio — always in the DOM so it is never unmounted mid-call.
           srcObject is assigned by useWebRTC's effect and the ontrack direct fallback. */}
      <audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
        style={{ display: "none" }}
      />

      <CallOverlay
        callStatus={callStatus} callType={callType} isMuted={isMuted} isCameraOff={isCameraOff}
        callDuration={callDuration} isMinimized={isMinimized} setIsMinimized={setIsMinimized}
        localVideoRef={localVideoRef} remoteVideoRef={remoteVideoRef} remoteAudioRef={remoteAudioRef}
        connectionError={connectionError}
        onDismissConnectionError={dismissConnectionError}
        onRetry={() => {
          if (callType === "video" && !settings.videoCallEnabled) return;
          if (callType === "audio" && !settings.voiceCallsEnabled) return;
          safeStartCall(callType);
        }}
        onEnd={endCall} onToggleMute={toggleMute} onToggleCamera={toggleCamera} onSwitchCamera={switchCamera}
        onAnswer={() => incomingCallId && answerCall(incomingCallId)}
        onReject={() => incomingCallId && rejectCall(incomingCallId)}
        otherName={otherName}
      />

      <style>{``}</style>
    </div>
  );
}

function HeaderBtn({ children, onClick, active, testId }: { children: React.ReactNode; onClick: () => void; active?: boolean; testId?: string }) {
  return (
    <button onClick={onClick} data-testid={testId} className={cn("p-2 rounded-xl transition-all", active ? "bg-pink-500/20 text-pink-400" : "hover:bg-white/5 text-white/40 hover:text-white")}>
      {children}
    </button>
  );
}
