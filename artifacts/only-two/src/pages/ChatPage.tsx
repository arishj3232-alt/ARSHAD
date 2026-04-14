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
  MoreVertical,
  WifiOff,
  Vibrate,
} from "lucide-react";
import { ref, set, onValue, onDisconnect, serverTimestamp } from "firebase/database";
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
} from "firebase/firestore";
import { db, rtdb } from "@/lib/firebase";
import { cn, formatDate, formatLastSeen } from "@/lib/utils";
import { useMessages } from "@/hooks/useMessages";
import { useWebRTC, type CallStatus } from "@/hooks/useWebRTC";
import { useMediaUpload } from "@/hooks/useMediaUpload";
import { usePresence } from "@/hooks/usePresence";
import { useNetworkStatus } from "@/hooks/useSession";
import { useTypingIndicator } from "@/hooks/useTypingIndicator";
import { useRateLimit } from "@/hooks/useRateLimit";
import { useCursorPresence } from "@/hooks/useCursorPresence";
import { useAdmin } from "@/hooks/useAdmin";
import { useChatReceipts } from "@/hooks/useChatReceipts";
import { useNotifications } from "@/hooks/useNotifications";
import { handleKeywordNormalized, normalize, resolveKeywordLists } from "@/lib/chatKeywords";
import { useVibrationPreference } from "@/hooks/useVibrationPreference";
import { useProfile } from "@/hooks/useProfile";
import { useUserStatus, useOtherUserStatus } from "../hooks/useUserStatus";
import ChatMessage from "@/components/ChatMessage";
import VideoNoteRecorder from "@/components/VideoNoteRecorder";
import HoldSwipeRecordOverlay from "@/components/HoldSwipeRecordOverlay";
import { useHoldSwipeRecording } from "@/hooks/useHoldSwipeRecording";
import CallOverlay from "@/components/CallOverlay";
import SearchPanel from "@/components/SearchPanel";
import GalleryPanel from "@/components/GalleryPanel";
import CursorPresence from "@/components/CursorPresence";
import AdminPanel from "@/components/AdminPanel";
import type { Message } from "@/hooks/useMessages";
import { formatRecordingClock } from "@/lib/formatDuration";
import { vibrateShort } from "@/lib/haptics";
import {
  startOrContinueIncomingCallRingtone,
  stopIncomingCallRingtone,
} from "@/lib/incomingCallRingtone";

const TYPING_DEBOUNCE_MS = 1500;

function isSameGroup(prev: Message | undefined, curr: Message): boolean {
  if (!prev) return false;
  if (prev.senderId !== curr.senderId) return false;
  const a = prev.createdAt?.getTime() ?? 0;
  const b = curr.createdAt?.getTime() ?? 0;
  return Math.abs(b - a) < 120_000;
}

function buildOptimisticTextMessage(args: {
  tempId: string;
  userId: string;
  text: string;
  replyTo: Message | null;
  ghost: boolean;
}): Message {
  const now = new Date();
  return {
    id: args.tempId,
    senderId: args.userId,
    type: "text",
    text: args.text,
    replyToId: args.replyTo?.id,
    replyToText: args.replyTo?.text?.slice(0, 80),
    deleted: false,
    deletedForEveryone: false,
    deletedFor: {},
    seen: false,
    delivered: false,
    viewOnce: false,
    viewOnceViewed: false,
    openedBy: [],
    openedAt: null,
    expiresAt: null,
    ghost: args.ghost,
    reactions: {},
    edited: false,
    createdAt: now,
    receiptStatus: "sent",
    localStatus: "sending",
  };
}

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

type InputMode = "text" | "videonote";

const STATUS_DOT: Record<string, { color: string; label: string }> = {
  online: { color: "bg-emerald-400", label: "Online" },
  recording: { color: "bg-blue-400", label: "Recording voice" },
  viewingMedia: { color: "bg-yellow-400", label: "Viewing media" },
  browsing: { color: "bg-white/60", label: "Browsing" },
  offline: { color: "bg-white/20", label: "" },
};

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
  const [adminStealthRead, setAdminStealthRead] = useState(false);
  const [profileModal, setProfileModal] = useState<{
    name: string;
    dpUrl: string | null;
    bio: string | null;
  } | null>(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showDpMenu, setShowDpMenu] = useState(false);
  const [viewOnceNext, setViewOnceNext] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [missedCallBanner, setMissedCallBanner] = useState(false);
  const [dpPreviewUrl, setDpPreviewUrl] = useState<string | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([]);
  const optimisticPendingRef = useRef<{ tempId: string; docId: string } | null>(null);

  // --- Command-driven states ---
  const [hasAdminAccess, setHasAdminAccess] = useState(() => {
    try {
      return sessionStorage.getItem("onlytwo-admin-access") === "1";
    } catch {
      return false;
    }
  });

  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioFileRef = useRef<HTMLInputElement>(null);
  const dpInputRef = useRef<HTMLInputElement>(null);
  const nearBottomRef = useRef(true);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const otherNameForNotifRef = useRef("");
  const lastSoundAtRef = useRef(0);
  const prevCallStatusForRingtoneRef = useRef<CallStatus | null>(null);

  const { settings, updateSetting } = useAdmin();

  useEffect(() => {
    setAdminStealthRead(showAdmin);
  }, [showAdmin]);
  useNotifications(settings.notificationsEnabled, userId);
  const { vibration, toggleVibration } = useVibrationPreference(userId);
  const vibrationRef = useRef(vibration);
  vibrationRef.current = vibration;
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

  const expectedPeerName = useMemo(() => {
    const roleFromSession = (() => {
      try {
        const raw = sessionStorage.getItem("onlytwo-role");
        return raw === "shelly" || raw === "arshad" ? raw : null;
      } catch {
        return null;
      }
    })();
    if (roleFromSession === "shelly") return "Arshad";
    if (roleFromSession === "arshad") return "Shelly";
    return userName === "Shelly" ? "Arshad" : "Shelly";
  }, [userName]);

  // Derive peer from live presence, preferring the opposite role/name.
  const otherUser = useMemo(() => {
    const others = Object.values(presence).filter((u) => u.id !== userId);
    const preferred = others.find(
      (u) => u.name.trim().toLowerCase() === expectedPeerName.toLowerCase()
    );
    return preferred ?? others[0] ?? null;
  }, [presence, userId, expectedPeerName]);
  const resolvedOtherId = otherUser?.id ?? otherId ?? null;
  const otherName = otherUser?.name
    ?? (Object.keys(presence).length === 0 ? "Connecting…" : "Waiting…");
  otherNameForNotifRef.current = otherName;

  const { profile, uploading: dpUploading, uploadDp, deleteDp, getDpUrl, updateReadReceiptsEnabled } =
    useProfile(userId);
  const otherDpUrl = resolvedOtherId ? getDpUrl(resolvedOtherId) : null;

  const roomReadReceiptsEnabled = settings.readReceiptsEnabled !== false;
  const profileHidesReadReceipts = profile.readReceiptsEnabled === true;
  const ghostMode = settings.ghostMode === true;
  const setGhostMode = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const prev = settings.ghostMode === true;
      const resolved = typeof next === "function" ? next(prev) : next;
      void updateSetting("ghostMode", resolved);
    },
    [updateSetting, settings.ghostMode]
  );
  const showDeleted = settings.showDeleted === true;
  const setShowDeleted = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const prev = settings.showDeleted === true;
      const resolved = typeof next === "function" ? next(prev) : next;
      void updateSetting("showDeleted", resolved);
    },
    [updateSetting, settings.showDeleted]
  );
  const grantAdminAccess = useCallback(() => {
    try {
      sessionStorage.setItem("onlytwo-admin-access", "1");
    } catch {
      /* */
    }
    setHasAdminAccess(true);
  }, []);
  const openAdminFromKeyword = useCallback(
    (open: boolean) => {
      setShowAdmin(open);
      if (open) grantAdminAccess();
    },
    [grantAdminAccess]
  );
  const { setStatus: setMyStatus } = useUserStatus(roomCode, userId);
  const { otherStatus, otherRecordingKind, otherTs } = useOtherUserStatus(roomCode, resolvedOtherId);

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
    markDelivered,
    markSeen,
    addReaction,
    removeReaction,
    markViewOnceViewed,
  } = useMessages(ROOM_ID, userId, viewOnceTimerMs);

  useChatReceipts(messages, userId, markDelivered, markSeen, {
    roomReadReceiptsEnabled,
    adminStealthRead,
    ghostMode,
  });

  const revealDeletedContent = showDeleted === true;

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
  const peerTypingLine =
    (isOtherTyping || !!otherUser?.typing) && settings.typingIndicatorEnabled && !ghostMode;
  const headerPeerOnline = otherStatus === "online";
  const { uploading, progress, uploadMedia } = useMediaUpload();
  const { otherCursors } = useCursorPresence(roomCode, userId, userName);
  const mediaMessages = useMemo(
    () => messages.filter((m) => !m.deleted && (m.type === "image" || m.type === "video")),
    [messages]
  );

  const displayMessages = useMemo(() => {
    const base = messages.filter((m) => !(m.ghost && m.senderId !== userId));
    const merged = [...base, ...optimisticMessages];
    merged.sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
    return merged;
  }, [messages, optimisticMessages, userId]);

  useEffect(() => {
    const pending = optimisticPendingRef.current;
    if (!pending) return;
    if (messages.some((m) => m.id === pending.docId)) {
      setOptimisticMessages((prev) => prev.filter((m) => m.id !== pending.tempId));
      optimisticPendingRef.current = null;
    }
  }, [messages]);

  const {
    callStatus, callType, isMuted, isCameraOff, callDuration,
    isMinimized, setIsMinimized, localVideoRef, remoteVideoRef, remoteAudioRef,
    startCall, answerCall, endCall, rejectCall, toggleMute, toggleCamera,
    switchCamera, incomingCallId, mediaError, dismissMediaError,
    connectionError, dismissConnectionError,
  } = useWebRTC(ROOM_ID, userId, sendCallEvent, () => setMissedCallBanner(true));

  useEffect(() => {
    const prev = prevCallStatusForRingtoneRef.current;
    prevCallStatusForRingtoneRef.current = callStatus;
    if (prev === null) return;
    const wasRinging = prev === "incoming" || prev === "calling";
    const isRinging = callStatus === "incoming" || callStatus === "calling";
    if (wasRinging && !isRinging) {
      stopIncomingCallRingtone();
    }
  }, [callStatus]);

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

  const keywordLists = useMemo(() => resolveKeywordLists(settings), [settings]);

  const runKeywordCommand = useCallback(
    (messageText: string) => {
      if (!messageText || !messageText.trim()) return false;
      const normalized = normalize(messageText);
      if (!normalized) return false;

      const result = handleKeywordNormalized(normalized, {
        settings,
        isAdmin: hasAdminAccess,
        lists: keywordLists,
        setRevealMode: setShowDeleted,
        setGhostMode,
        setShowAdmin: openAdminFromKeyword,
      });

      return result.handled;
    },
    [keywordLists, settings, hasAdminAccess, setShowDeleted, setGhostMode, openAdminFromKeyword]
  );

  /** Foreground-only chat alerts via Firestore (no FCM). */
  useEffect(() => {
    if (!ROOM_ID || !userId) return undefined;
    if (!settings.notificationsEnabled) return undefined;

    const lastSeenRef = new Set<string>();
    let primed = false;

    const q = query(
      collection(db, "rooms", ROOM_ID, "messages"),
      orderBy("createdAt", "desc"),
      limit(40)
    );

    const previewBody = (data: Record<string, unknown>): string => {
      const type = (data.type as string) || "text";
      const text = typeof data.text === "string" ? data.text.trim() : "";
      if (type === "text" && text) return text.length > 120 ? `${text.slice(0, 117)}…` : text;
      if (type === "image") return "📸 Photo";
      if (type === "video") return "🎥 Video";
      if (type === "audio") return "🎤 Voice message";
      if (type === "call") {
        const ct = data.callType === "video" ? "🎥" : "📞";
        const st = data.callStatus as string | undefined;
        const label =
          st === "completed" ? "Call" :
          st === "missed" || st === "not_picked" ? "Missed call" :
          st === "declined" ? "Declined call" :
          "Call";
        return `${ct} ${label}`;
      }
      return "Sent you a message";
    };

    const unsub = onSnapshot(q, (snapshot) => {
      if (!primed) {
        snapshot.docs.forEach((d) => lastSeenRef.add(d.id));
        primed = true;
        return;
      }

      snapshot.docChanges().forEach((change) => {
        if (change.type !== "added") return;
        const docSnap = change.doc;
        if (lastSeenRef.has(docSnap.id)) return;
        lastSeenRef.add(docSnap.id);

        const data = docSnap.data() as Record<string, unknown>;
        if (data.senderId === userId) return;
        if (data.deleted === true) return;
        if (data.ghost === true) return;

        const senderName =
          typeof data.senderName === "string" && data.senderName.trim()
            ? data.senderName.trim()
            : otherNameForNotifRef.current || "New Message";
        const title = senderName || "New Message";
        const body = previewBody(data);

        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          try {
            const n = new Notification(title, {
              body: body || "Sent you a message",
              icon: "/favicon.svg",
              tag: docSnap.id,
            });
            n.onclick = () => {
              n.close();
              window.focus();
            };
          } catch {
            /* */
          }
        }

        const isIncomingCallRing =
          (data.type as string) === "call" && (data.callStatus as string) === "calling";
        if (isIncomingCallRing) {
          try {
            startOrContinueIncomingCallRingtone();
          } catch {
            /* */
          }
        } else {
          const now = Date.now();
          if (now - lastSoundAtRef.current > 450) {
            lastSoundAtRef.current = now;
            try {
              const audio = new Audio("/notification.mp3");
              audio.volume = 1;
              void audio.play().catch(() => {});
            } catch {
              /* */
            }
          }
        }

        if (vibrationRef.current === "on" && typeof navigator !== "undefined" && "vibrate" in navigator) {
          try {
            navigator.vibrate([200, 100, 200]);
          } catch {
            /* */
          }
        }
      });
    });

    return () => {
      unsub();
      stopIncomingCallRingtone();
    };
  }, [ROOM_ID, userId, settings.notificationsEnabled]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "S") {
        e.preventDefault();
        setShowAdmin((p) => {
          const next = !p;
          if (next) {
            try {
              sessionStorage.setItem("onlytwo-admin-access", "1");
            } catch {
              /* */
            }
            setHasAdminAccess(true);
          }
          return next;
        });
      }
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
    const t = text.trim();
    if (!t) return;

    // Keywords (reveal, admin, ghost, etc.) must work even when Messaging is disabled in admin.
    const handled = runKeywordCommand(t);
    if (handled) {
      setText("");
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      setTyping(false);
      return;
    }

    if (!settings.messagingEnabled) return;

    // Rate limit: max 5 messages per 10 seconds
    if (!checkMsgRateLimit()) {
      return;
    }

    const tempId = `temp_${Date.now()}`;
    const replySnapshot = replyTo;
    const optimistic = buildOptimisticTextMessage({
      tempId,
      userId,
      text: t,
      replyTo: replySnapshot,
      ghost: ghostMode,
    });
    setOptimisticMessages((prev) => [...prev, optimistic]);
    lastMessageIdRef.current = tempId;
    scrollToBottom(true);

    setText("");
    setReplyTo(null);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    setTyping(false);

    try {
      const docId = await sendMessage({
        type: "text",
        text: t,
        replyToId: replySnapshot?.id,
        replyToText: replySnapshot?.text?.slice(0, 80),
        ghost: ghostMode,
      });
      if (docId) optimisticPendingRef.current = { tempId, docId };
      else setOptimisticMessages((prev) => prev.filter((m) => m.id !== tempId));
      vibrateShort(35);
    } catch {
      setOptimisticMessages((prev) => prev.filter((m) => m.id !== tempId));
      optimisticPendingRef.current = null;
    }
  }, [
    text,
    replyTo,
    sendMessage,
    setTyping,
    settings.messagingEnabled,
    runKeywordCommand,
    ghostMode,
    checkMsgRateLimit,
    userId,
    scrollToBottom,
  ]);

  const handleEditSubmit = useCallback(async () => {
    if (!editingMsg) return;
    const t = editText.trim();
    if (!t) return;
    if (runKeywordCommand(t)) {
      setEditingMsg(null);
      setEditText("");
      return;
    }
    await editMessage(editingMsg.id, t);
    setEditingMsg(null);
    setEditText("");
  }, [editingMsg, editText, editMessage, runKeywordCommand]);

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

  const handleVideoNoteSend = async (blob: Blob) => {
    if (!settings.videoNoteEnabled) return;
    const file = new File([blob], `vidnote_${Date.now()}.webm`, { type: "video/webm" });
    const { url } = await uploadMedia(file);
    await sendMessage({ type: "video", mediaUrl: url, ghost: ghostMode });
    setInputMode("text");
  };

  const holdSwipe = useHoldSwipeRecording({
    onSend: useCallback(
      async (blob, mode) => {
        if (mode === "audio") {
          const file = new File([blob], `voice_${Date.now()}.webm`, { type: "audio/webm" });
          const { url } = await uploadMedia(file);
          await sendMessage({ type: "audio", mediaUrl: url, ghost: ghostMode });
        } else {
          if (!settings.videoNoteEnabled) return;
          const file = new File([blob], `vidnote_${Date.now()}.webm`, { type: "video/webm" });
          const { url } = await uploadMedia(file);
          await sendMessage({ type: "video", mediaUrl: url, ghost: ghostMode });
        }
        setInputMode("text");
      },
      [uploadMedia, sendMessage, ghostMode, settings.videoNoteEnabled]
    ),
  });

  // Single RTDB activity writer: tab visibility → call state → hold-to-record → panels → online
  useEffect(() => {
    if (!userId || ghostMode) return undefined;
    const applyMyStatus = () => {
      if (document.hidden) {
        setMyStatus("browsing");
        return;
      }
      if (callStatus === "connected" && callType === "video") {
        setMyStatus("viewingMedia");
        return;
      }
      if (callStatus === "connected" && callType === "audio") {
        setMyStatus("recording", { recordingKind: "audio" });
        return;
      }
      if (callStatus === "connecting" || callStatus === "calling") {
        setMyStatus("browsing");
        return;
      }
      if (holdSwipe.open) {
        setMyStatus("recording", {
          recordingKind: holdSwipe.mode === "video" ? "video" : "audio",
        });
        return;
      }
      if (panel === "gallery") {
        setMyStatus("viewingMedia");
        return;
      }
      if (panel === "search") {
        setMyStatus("browsing");
        return;
      }
      setMyStatus("online");
    };
    applyMyStatus();
    document.addEventListener("visibilitychange", applyMyStatus);
    return () => document.removeEventListener("visibilitychange", applyMyStatus);
  }, [
    userId,
    ghostMode,
    holdSwipe.open,
    holdSwipe.mode,
    panel,
    callStatus,
    callType,
    setMyStatus,
  ]);

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
    displayMessages.forEach((msg) => {
      if (msg.ghost && msg.senderId !== userId) return;
      const d = msg.createdAt ? formatDate(msg.createdAt) : "Unknown date";
      if (d !== currentDate) { groups.push({ date: d, msgs: [] }); currentDate = d; }
      groups[groups.length - 1].msgs.push(msg);
    });
    return groups;
  }, [displayMessages, userId]);

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
          {/* Other user's avatar + presence */}
          <div className="relative flex-shrink-0">
            {headerPeerOnline && (
              <span className="absolute -inset-0.5 rounded-full pointer-events-none z-0">
                <span className="absolute inset-0 rounded-full bg-emerald-500/25 animate-ping" style={{ animationDuration: "2.2s" }} />
              </span>
            )}
            <button
              type="button"
              className="relative z-[1] w-9 h-9 rounded-full overflow-hidden bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center shadow-lg shadow-pink-500/20 ring-0 focus:outline-none focus:ring-2 focus:ring-pink-500/50"
              onClick={() => {
                setProfileModal({ name: otherName, dpUrl: otherDpUrl, bio: null });
              }}
              title="View profile"
            >
              {otherDpUrl ? (
                <img src={otherDpUrl} alt={otherName} className="w-full h-full object-cover" loading="lazy" decoding="async" />
              ) : (
                <span className="text-white font-bold text-sm select-none">{otherName[0]?.toUpperCase() ?? "?"}</span>
              )}
            </button>
            <div
              className={cn(
                "absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#0c0c16] z-[2]",
                headerPeerOnline ? "bg-emerald-500" : statusDot.color
              )}
              title={headerPeerOnline ? "Online" : statusDot.label}
            />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm leading-tight">{otherName}</p>
            <p className="text-white/35 text-xs truncate">
              {peerTypingLine ? (
                <span className="text-pink-400/70 animate-pulse">typing…</span>
              ) : otherStatus === "recording" ? (
                <span className="text-blue-400/70 animate-pulse">
                  {otherRecordingKind === "video" ? "Recording video…" : "Recording audio…"}
                </span>
              ) : otherStatus === "viewingMedia" ? (
                <span className="text-yellow-400/70 animate-pulse">viewing media…</span>
              ) : otherStatus === "online" ? (
                "Online"
              ) : settings.lastSeenEnabled && otherTs > 0 ? (
                `Last seen ${formatLastSeen(new Date(otherTs))}`
              ) : (
                ""
              )}
            </p>
          </div>

          <div className="flex items-center gap-1 ml-2 flex-shrink-0" aria-live="polite">
            {ghostMode && (
              <span className="text-xs opacity-70" title="Ghost mode">
                👻
              </span>
            )}

            {showDeleted && (
              <span className="text-xs opacity-70" title="Reveal mode">
                👁
              </span>
            )}

            {profileHidesReadReceipts && (
              <span className="text-xs opacity-70" title="Read receipts hidden from others">
                🔕
              </span>
            )}
          </div>

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
                  {msgs.map((msg, mi) => {
                    const prevInDay = mi > 0 ? msgs[mi - 1] : undefined;
                    const inGroup = isSameGroup(prevInDay, msg);
                    return (
                    <div
                      key={msg.id}
                      ref={(el) => { if (el) messageRefs.current[msg.id] = el; }}
                      className={inGroup ? "py-0" : "py-0.5"}
                    >
                      <ChatMessage
                        message={msg}
                        isOwn={msg.senderId === userId}
                        hidePeerAvatar={inGroup && msg.senderId !== userId}
                        compactInGroup={inGroup}
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
                        revealDeletedContent={revealDeletedContent}
                        onPeerProfileClick={() =>
                          setProfileModal({ name: otherName, dpUrl: otherDpUrl, bio: null })
                        }
                        peerOnline={headerPeerOnline}
                        maskReadReceiptInUi={profileHidesReadReceipts}
                        viewOnceEnabled={settings.viewOnceEnabled}
                        viewOnceTimerMs={viewOnceTimerMs}
                        imageDownloadProtection={settings.imageDownloadProtection}
                        onCallAgain={safeStartCall}
                        onDpPreview={(url) => setDpPreviewUrl(url)}
                      />
                    </div>
                    );
                  })}
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

          {inputMode === "videonote" ? (
            <VideoNoteRecorder onSend={handleVideoNoteSend} onCancel={() => setInputMode("text")} disabled={!settings.videoNoteEnabled} />
          ) : (
            <div className="flex items-end gap-2">
              {/* YOUR profile picture + vibration — left of input */}
              <div className="flex items-end gap-1 flex-shrink-0 self-end pb-1">
                <div className="relative">
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
                        type="button"
                        onClick={() => { dpInputRef.current?.click(); setShowDpMenu(false); }}
                        className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/5 text-white/70 hover:text-white transition text-sm text-left"
                      >
                        Change profile picture
                      </button>
                      {profile.dpUrl && (
                        <button
                          type="button"
                          onClick={() => { deleteDp(); setShowDpMenu(false); }}
                          className="flex items-center gap-3 w-full px-4 py-3 hover:bg-rose-500/10 text-rose-400/70 hover:text-rose-400 transition text-sm text-left"
                        >
                          Remove profile picture
                        </button>
                      )}
                      {settings.allowReadReceiptToggle && (
                        <button
                          type="button"
                          onClick={() => {
                            void updateReadReceiptsEnabled(!profileHidesReadReceipts);
                            setShowDpMenu(false);
                          }}
                          className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/5 text-white/70 hover:text-white transition text-sm text-left border-t border-white/5"
                        >
                          {profileHidesReadReceipts
                            ? "Show read receipts to others"
                            : "Hide read receipts from others"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowDpMenu(false)}
                        className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/5 text-white/30 hover:text-white/60 transition text-sm text-left border-t border-white/5"
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  <div className="relative w-8 h-8">
                    <button
                      type="button"
                      title="Your profile picture"
                      className="w-8 h-8 rounded-full overflow-hidden bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center shadow-md relative"
                      onClick={() => {
                        if (profile.dpUrl) setDpPreviewUrl(profile.dpUrl);
                        else setShowDpMenu(true);
                      }}
                    >
                      {profile.dpUrl ? (
                        <img src={profile.dpUrl} alt={userName} className="w-full h-full object-cover pointer-events-none" />
                      ) : (
                        <span className="text-white font-bold text-xs select-none">{userName[0]?.toUpperCase() ?? "?"}</span>
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label="Profile options"
                      className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-[#14141f] border border-white/15 flex items-center justify-center text-white/80 hover:bg-white/10 z-10"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowDpMenu((p) => !p);
                      }}
                    >
                      <MoreVertical className="w-3 h-3" />
                    </button>
                  </div>

                  {dpUploading && (
                    <div className="absolute inset-0 rounded-full border-2 border-pink-500 border-t-transparent animate-spin pointer-events-none" />
                  )}
                </div>

                {settings.notificationsEnabled && (
                  <button
                    type="button"
                    onClick={toggleVibration}
                    className="p-1.5 rounded-lg text-white/45 hover:text-white/80 hover:bg-white/10 border border-white/10 flex-shrink-0 mb-0.5"
                    title={
                      vibration === "on"
                        ? "Vibration on for new message alerts"
                        : "Vibration off"
                    }
                    aria-pressed={vibration === "on"}
                  >
                    <Vibrate className={`w-4 h-4 ${vibration === "on" ? "text-pink-400/90" : "opacity-70"}`} />
                  </button>
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
                  "flex-1 bg-transparent placeholder-white/20 px-3 py-2 text-sm min-h-[40px] max-h-[80px] resize-none leading-tight focus:outline-none",
                  ghostMode ? "text-violet-200 placeholder-violet-300/30" : "text-white"
                )}
                placeholder={
                  editingMsg
                    ? "Edit your message…"
                    : ghostMode
                      ? "Ghost mode — only you can see this…"
                      : settings.messagingEnabled
                        ? "Write something beautiful…"
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
                {holdSwipe.open && !editingMsg && (
                  <span
                    className="text-[11px] font-mono tabular-nums text-white/55 animate-pulse mr-0.5 min-w-[2.25rem] text-right"
                    aria-live="polite"
                  >
                    {formatRecordingClock(holdSwipe.seconds)}
                  </span>
                )}
                {settings.voiceMessagesEnabled && !text.trim() && !editingMsg && (
                  <button
                    type="button"
                    className="p-2 rounded-xl hover:bg-white/10 text-white/40 hover:text-white transition touch-none select-none active:bg-white/15"
                    onPointerDown={(e) => holdSwipe.handleHoldPointerDown(e, "audio")}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    title="Hold to record"
                    data-testid="button-voice-message"
                  >
                    <Mic className="w-5 h-5" />
                  </button>
                )}
                {settings.videoNoteEnabled && !text.trim() && !editingMsg && (
                  <button
                    type="button"
                    className="p-2 rounded-xl hover:bg-white/10 text-white/40 hover:text-sky-300 transition touch-none select-none active:bg-white/15"
                    onPointerDown={(e) => holdSwipe.handleHoldPointerDown(e, "video")}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    title="Hold to record video note"
                    data-testid="button-video-note-hold"
                  >
                    <VideoIcon className="w-5 h-5" />
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

      <HoldSwipeRecordOverlay
        open={holdSwipe.open}
        mode={holdSwipe.mode}
        locked={holdSwipe.locked}
        seconds={holdSwipe.seconds}
        maxSeconds={holdSwipe.maxSeconds}
        bars={holdSwipe.bars}
        error={holdSwipe.error}
        videoRef={holdSwipe.videoRef}
        onLockedSend={holdSwipe.lockedSend}
        onLockedCancel={holdSwipe.lockedCancel}
      />

      {/* Remote audio — always in the DOM so it is never unmounted mid-call.
           srcObject is assigned by useWebRTC's effect and the ontrack direct fallback. */}
      <audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
        style={{ display: "none" }}
      />

      {dpPreviewUrl && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4"
          onClick={() => setDpPreviewUrl(null)}
          role="presentation"
        >
          <button
            type="button"
            className="absolute top-4 right-4 z-[101] rounded-full bg-white/10 hover:bg-white/20 text-white p-2"
            aria-label="Close"
            onClick={() => setDpPreviewUrl(null)}
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={dpPreviewUrl}
            alt=""
            className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
            loading="lazy"
            decoding="async"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {profileModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4"
          onClick={() => setProfileModal(null)}
          role="presentation"
        >
          <div
            className="relative bg-[#14141f] border border-white/10 rounded-2xl p-8 max-w-sm w-full shadow-2xl text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="absolute top-3 right-3 rounded-full bg-white/10 hover:bg-white/20 text-white p-2"
              aria-label="Close"
              onClick={() => setProfileModal(null)}
            >
              <X className="w-5 h-5" />
            </button>
            {profileModal.dpUrl ? (
              <img
                src={profileModal.dpUrl}
                alt=""
                className="w-40 h-40 rounded-full object-cover mx-auto mb-4 ring-2 ring-white/10"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <div className="w-40 h-40 rounded-full bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center mx-auto mb-4 text-white text-4xl font-bold">
                {profileModal.name[0]?.toUpperCase() ?? "?"}
              </div>
            )}
            <h2 className="text-white text-lg font-semibold mb-2">{profileModal.name}</h2>
            <p className="text-white/45 text-sm mb-6">{profileModal.bio?.trim() || "No bio"}</p>
            <button
              type="button"
              onClick={() => setProfileModal(null)}
              className="px-6 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm"
            >
              Close
            </button>
          </div>
        </div>
      )}

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
