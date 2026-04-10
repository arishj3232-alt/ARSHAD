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
  Camera,
  Check,
  Ghost,
  Eye,
  EyeOff,
  WifiOff,
} from "lucide-react";
import { ref, set, onValue } from "firebase/database";
import { rtdb } from "@/lib/firebase";
import { cn, formatDate, formatLastSeen } from "@/lib/utils";
import { useMessages } from "@/hooks/useMessages";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useMediaUpload } from "@/hooks/useMediaUpload";
import { useTypingIndicator, usePresence, useNetworkStatus } from "@/hooks/useSession";
import { useRateLimit } from "@/hooks/useRateLimit";
import { useCursorPresence } from "@/hooks/useCursorPresence";
import { useAdmin } from "@/hooks/useAdmin";
import { useNotifications, sendPushNotification } from "@/hooks/useNotifications";
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

const ROOM_ID = "main";
const TYPING_DEBOUNCE_MS = 1500;

const isMobileDevice =
  typeof window !== "undefined" &&
  ("ontouchstart" in window || navigator.maxTouchPoints > 0);

type Props = {
  userId: string;
  userName: string;
  otherId: string | null;
  onForceLogout?: () => void;
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

export default function ChatPage({ userId, userName, otherId, onForceLogout }: Props) {
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingMsg, setEditingMsg] = useState<Message | null>(null);
  const [editText, setEditText] = useState("");
  const [inputMode, setInputMode] = useState<InputMode>("text");
  const [panel, setPanel] = useState<"none" | "search" | "gallery">("none");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [viewOnceNext, setViewOnceNext] = useState(false);

  // --- Command-driven states ---
  const [ghostMode, setGhostMode] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false); // persistent toggle
  const [readReceiptsEnabled, setReadReceiptsEnabled] = useState(true);

  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioFileRef = useRef<HTMLInputElement>(null);
  const dpInputRef = useRef<HTMLInputElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { settings, updateSetting } = useAdmin();
  const { notify, toasts, showToast, dismissToast } = useNotifications(settings.notificationsEnabled, userId);
  const presence = usePresence(userId);
  const { isConnected } = useNetworkStatus();
  const { check: checkMsgRateLimit } = useRateLimit(5, 10_000); // max 5 messages per 10 s

  // Derive the other user from live presence — do NOT rely on the null otherId prop
  const otherUser = Object.values(presence).find((u) => u.id !== userId) ?? null;
  const resolvedOtherId = otherUser?.id ?? otherId ?? null;
  const otherName = otherUser?.name
    ?? (Object.keys(presence).length === 0 ? "Connecting…" : "Waiting…");

  const { profile, uploading: dpUploading, toast: dpToast, uploadDp, getDpUrl } = useProfile(userId);
  const otherDpUrl = resolvedOtherId ? getDpUrl(resolvedOtherId) : null;

  const { setStatus: setMyStatus } = useUserStatus(userId);
  const otherStatus = useOtherUserStatus(resolvedOtherId);

  // Activity status (suppressed in ghost mode)
  useEffect(() => {
    if (ghostMode) return;
    if (inputMode === "voice") setMyStatus("recording");
    else if (panel === "gallery") setMyStatus("viewingMedia");
    else if (panel === "search") setMyStatus("browsing");
    else setMyStatus("online");
  }, [inputMode, panel, setMyStatus, ghostMode]);

  // Force-logout listener
  useEffect(() => {
    if (!userId) return;
    try {
      const unsub = onValue(
        ref(rtdb, `forceLogout/${userId}`),
        (snap) => {
          if (snap.val() === true) {
            set(ref(rtdb, `forceLogout/${userId}`), null).catch(() => {});
            localStorage.removeItem("onlytwo-user-id");
            localStorage.removeItem("onlytwo-user-name");
            if (onForceLogout) onForceLogout();
            else window.location.reload();
          }
        },
        () => {}
      );
      return () => unsub();
    } catch {}
  }, [userId, onForceLogout]);

  // Device registration
  useEffect(() => {
    if (!userId) return;
    const deviceId = `${Date.now() % 100000}_${Math.random().toString(36).slice(2, 5)}`;
    const browser = (() => {
      const ua = navigator.userAgent;
      if (ua.includes("Chrome")) return "Chrome";
      if (ua.includes("Safari")) return "Safari";
      if (ua.includes("Firefox")) return "Firefox";
      return "Browser";
    })();
    try {
      set(ref(rtdb, `devices/${userId}/${deviceId}`), {
        browser,
        platform: navigator.platform || "Unknown",
        lastActive: Date.now(),
        online: true,
        userId,
      }).catch(() => {});
    } catch {}
  }, [userId]);

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
  } = useMessages(ROOM_ID, userId);

  const { isOtherTyping, setTyping } = useTypingIndicator(ROOM_ID, userId);
  const { uploading, progress, uploadMedia } = useMediaUpload();
  const { otherCursors } = useCursorPresence(userId, userName);
  const mediaMessages = useMemo(
    () => messages.filter((m) => !m.deleted && (m.type === "image" || m.type === "video")),
    [messages]
  );

  const {
    callStatus, callType, isMuted, isCameraOff, callDuration,
    isMinimized, setIsMinimized, localVideoRef, remoteVideoRef, remoteAudioRef,
    startCall, answerCall, endCall, rejectCall, toggleMute, toggleCamera,
    switchCamera, incomingCallId, mediaError, dismissMediaError,
  } = useWebRTC(ROOM_ID, userId);

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
        showToast({ title: "🔍 Reveal Mode off", body: "Back to normal view", type: "text" });
        return true;
      }
      if (lower === offKeyword(settings.ghostKeyword) && settings.allowGhostMode) {
        setGhostMode(false);
        showToast({ title: "Ghost Mode off", body: "You're visible again", type: "text" });
        return true;
      }
      if (lower === offKeyword(settings.readReceiptKeyword) && settings.allowReadReceiptToggle) {
        setReadReceiptsEnabled(false);
        showToast({ title: "🙈 Read receipts disabled", body: "Blue ticks hidden", type: "text" });
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
          showToast({
            title: next ? "🔍 Reveal Mode on" : "🔍 Reveal Mode off",
            body: next ? "Deleted & hidden content is visible" : "Back to normal view",
            type: "text",
          });
          return next;
        });
        return true;
      }

      if (trimmed === settings.ghostKeyword && settings.allowGhostMode) {
        setGhostMode((prev) => {
          const next = !prev;
          showToast({
            title: next ? "👻 Ghost Mode on" : "Ghost Mode off",
            body: next ? "Your messages are invisible to them" : "You're visible again",
            type: "text",
          });
          return next;
        });
        return true;
      }

      if (trimmed === settings.readReceiptKeyword && settings.allowReadReceiptToggle) {
        setReadReceiptsEnabled((prev) => {
          const next = !prev;
          showToast({
            title: next ? "👁️ Read receipts on" : "🙈 Read receipts off",
            body: next ? "Blue ticks are visible" : "Blue ticks hidden",
            type: "text",
          });
          return next;
        });
        return true;
      }

      return false;
    },
    [settings, showToast]
  );

  // Incoming message notifications
  useEffect(() => {
    const prev = prevMessageCountRef.current;
    const curr = messages.length;
    if (curr > prev && prev > 0) {
      const newest = messages[messages.length - 1];
      if (newest && newest.senderId !== userId && !newest.deleted && !newest.ghost) {
        const type = newest.type as "text" | "image" | "video" | "audio";
        const body =
          type === "text" ? (newest.text?.slice(0, 80) ?? "") :
          type === "image" ? "📸 Photo" :
          type === "video" ? "🎥 Video" :
          type === "audio" ? "🎤 Voice message" : `Sent a ${type}`;
        notify(otherName, body, type);
        if (resolvedOtherId && document.hidden) {
          sendPushNotification({ toUserId: userId, title: otherName, body });
        }
      }
    }
    prevMessageCountRef.current = curr;
  }, [messages, userId, otherName, otherId, notify]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "S") { e.preventDefault(); setShowAdmin((p) => !p); }
      if (e.key === "Escape") { setShowAttachMenu(false); setShowAdmin(false); setEditingMsg(null); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => { scrollToBottom(false); }, [loading]);
  useEffect(() => { if (messages.length > 0) scrollToBottom(); }, [messages.length]);

  // Mark seen (skipped in ghost mode / when read receipts off)
  useEffect(() => {
    if (!readReceiptsEnabled || ghostMode) return;
    const unseenFromOther = messages.filter((m) => m.senderId !== userId && !m.seen && !m.deleted && !m.ghost);
    unseenFromOther.forEach((m) => markSeen(m.id));
  }, [messages, userId, markSeen, readReceiptsEnabled, ghostMode]);

  const handleScroll = useCallback(() => {
    const el = scrollAreaRef.current;
    if (!el || !hasMore || loadingMore) return;
    if (el.scrollTop < 100) {
      const prev = el.scrollHeight;
      loadMore().then(() => { el.scrollTop = el.scrollHeight - prev; });
    }
  }, [hasMore, loadingMore, loadMore]);

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
      showToast({ title: "Slow down", body: "Sending too fast — wait a moment", type: "text" });
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
  }, [text, replyTo, sendMessage, setTyping, settings.messagingEnabled, triggerKeyword, ghostMode, checkMsgRateLimit, showToast]);

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
    const file = new File([blob], `vidnote_${Date.now()}.webm`, { type: "video/webm" });
    const { url } = await uploadMedia(file);
    await sendMessage({ type: "video", mediaUrl: url, ghost: ghostMode });
    setInputMode("text");
  };

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
        <AdminPanel settings={settings} onUpdate={updateSetting} onClose={() => setShowAdmin(false)} currentUserId={userId} />
      )}

      {/* In-app toasts */}
      <div className="fixed top-4 right-4 z-[400] flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-start gap-3 bg-[#1a1a2e]/95 border border-white/10 rounded-2xl px-4 py-3 shadow-2xl max-w-xs backdrop-blur-xl"
            style={{ animation: "toastIn 0.25s ease-out" }}
          >
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center flex-shrink-0">
              <span className="text-sm">
                {toast.type === "image" ? "📸" : toast.type === "video" ? "🎥" : toast.type === "audio" ? "🎤" : toast.type === "call" ? "📞" : "💬"}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm leading-tight">{toast.title}</p>
              <p className="text-white/50 text-xs mt-0.5 truncate">{toast.body}</p>
            </div>
            <button onClick={() => dismissToast(toast.id)} className="text-white/30 hover:text-white/60 transition flex-shrink-0 mt-0.5">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Reveal mode indicator */}
      {showDeleted && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[300] flex items-center gap-2 px-4 py-2.5 bg-amber-500/15 border border-amber-500/30 rounded-2xl text-amber-300 text-sm shadow-xl backdrop-blur-xl" style={{ animation: "toastIn 0.2s ease-out" }}>
          <Eye className="w-4 h-4" />
          <span>Reveal Mode active</span>
        </div>
      )}

      {/* Ghost mode indicator */}
      {ghostMode && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[290] flex items-center gap-2 px-4 py-2.5 bg-violet-500/15 border border-violet-500/30 rounded-2xl text-violet-300 text-sm shadow-xl backdrop-blur-xl" style={{ marginTop: showDeleted ? "3.5rem" : "0", animation: "toastIn 0.2s ease-out" }}>
          <Ghost className="w-4 h-4" />
          <span>👻 Ghost Mode Active</span>
        </div>
      )}

      {/* DP toast */}
      {dpToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[300] px-4 py-2.5 bg-[#1a1a2e] border border-white/10 rounded-2xl text-white/80 text-sm shadow-xl" style={{ animation: "toastIn 0.2s ease-out" }}>
          {dpToast}
        </div>
      )}

      {/* Media permission error banner */}
      {mediaError && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-[350] flex items-start gap-3 px-4 py-3 bg-red-500/15 border border-red-500/30 rounded-2xl text-red-300 text-sm max-w-sm shadow-xl backdrop-blur-xl" style={{ animation: "toastIn 0.2s ease-out" }}>
          <span className="flex-1">{mediaError.message}</span>
          <button onClick={dismissMediaError} className="text-red-300/60 hover:text-red-300 transition flex-shrink-0 mt-0.5"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      <div className="flex flex-col flex-1 min-w-0 h-full">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 bg-[#0c0c16]/80 backdrop-blur-xl flex-shrink-0">
          <div className="relative flex-shrink-0">
            <div className="w-9 h-9 rounded-full overflow-hidden bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center shadow-lg shadow-pink-500/20">
              {otherDpUrl ? (
                <img src={otherDpUrl} alt={otherName} className="w-full h-full object-cover" />
              ) : (
                <span className="text-white font-bold text-sm">{otherName[0]?.toUpperCase() ?? "?"}</span>
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
              ) : otherUser?.online ? (
                "online"
              ) : settings.lastSeenEnabled ? (
                `last seen ${formatLastSeen(otherUser?.lastSeen ?? null)}`
              ) : ""}
            </p>
          </div>

          {!readReceiptsEnabled && (
            <div title="Read receipts off" className="text-white/20 flex-shrink-0">
              <EyeOff className="w-4 h-4" />
            </div>
          )}

          {/* Own DP */}
          <div className="relative mr-1">
            <input ref={dpInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDp(f); e.target.value = ""; }} />
            <button onClick={() => dpInputRef.current?.click()} className="w-7 h-7 rounded-full overflow-hidden bg-gradient-to-br from-violet-500 to-pink-600 flex items-center justify-center shadow relative group" title="Tap to change profile picture">
              {profile.dpUrl ? (
                <img src={profile.dpUrl} alt="You" className="w-full h-full object-cover" />
              ) : (
                <span className="text-white font-bold text-xs">{userName[0]?.toUpperCase() ?? "Y"}</span>
              )}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center rounded-full">
                <Camera className="w-3 h-3 text-white" />
              </div>
            </button>
            {dpUploading && <div className="absolute inset-0 rounded-full border-2 border-pink-500 border-t-transparent animate-spin" />}
          </div>

          <div className="flex items-center gap-0.5">
            <HeaderBtn onClick={() => setPanel(panel === "search" ? "none" : "search")} active={panel === "search"} testId="button-search"><Search className="w-4 h-4" /></HeaderBtn>
            <HeaderBtn onClick={() => setPanel(panel === "gallery" ? "none" : "gallery")} active={panel === "gallery"} testId="button-gallery"><Images className="w-4 h-4" /></HeaderBtn>
            {settings.voiceCallsEnabled && <HeaderBtn onClick={() => startCall("audio")} testId="button-voice-call"><Phone className="w-4 h-4" /></HeaderBtn>}
            {settings.videoCallsEnabled && <HeaderBtn onClick={() => startCall("video")} testId="button-video-call"><Video className="w-4 h-4" /></HeaderBtn>}
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
          ref={scrollAreaRef}
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
                        readReceiptsEnabled={readReceiptsEnabled}
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
            <VideoNoteRecorder onSend={handleVideoNoteSend} onCancel={() => setInputMode("text")} />
          ) : (
            <div className={cn(
              "flex items-end gap-2 border rounded-2xl p-2 relative transition-colors duration-200",
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
                      {settings.videoNotesEnabled && (
                        <button onClick={() => { setInputMode("videonote"); setShowAttachMenu(false); }} className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/5 text-white/70 hover:text-white transition text-sm">
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

      <CallOverlay
        callStatus={callStatus} callType={callType} isMuted={isMuted} isCameraOff={isCameraOff}
        callDuration={callDuration} isMinimized={isMinimized} setIsMinimized={setIsMinimized}
        localVideoRef={localVideoRef} remoteVideoRef={remoteVideoRef} remoteAudioRef={remoteAudioRef}
        onEnd={endCall} onToggleMute={toggleMute} onToggleCamera={toggleCamera} onSwitchCamera={switchCamera}
        onAnswer={() => incomingCallId && answerCall(incomingCallId)}
        onReject={() => incomingCallId && rejectCall(incomingCallId)}
        otherName={otherName}
      />

      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
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
