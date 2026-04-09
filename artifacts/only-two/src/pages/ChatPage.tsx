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
} from "lucide-react";
import { ref, set } from "firebase/database";
import { rtdb } from "@/lib/firebase";
import { cn, formatDate, formatLastSeen } from "@/lib/utils";
import { useMessages } from "@/hooks/useMessages";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useMediaUpload } from "@/hooks/useMediaUpload";
import { useTypingIndicator, usePresence } from "@/hooks/useSession";
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
};

type InputMode = "text" | "voice" | "videonote";

const STATUS_DOT: Record<string, { color: string; label: string }> = {
  online: { color: "bg-emerald-400", label: "Online" },
  recording: { color: "bg-blue-400", label: "Recording voice" },
  viewingMedia: { color: "bg-yellow-400", label: "Viewing media" },
  browsing: { color: "bg-white/60", label: "Browsing" },
  offline: { color: "bg-white/20", label: "" },
};

export default function ChatPage({ userId, userName, otherId }: Props) {
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
  const { notify, toasts, dismissToast } = useNotifications(settings.notificationsEnabled, userId);
  const presence = usePresence(userId);
  const otherUser = otherId ? presence[otherId] : null;
  const otherName = otherUser?.name ?? "Them";

  const { profile, uploading: dpUploading, toast: dpToast, uploadDp, getDpUrl } = useProfile(userId);
  const otherDpUrl = otherId ? getDpUrl(otherId) : null;

  const { setStatus: setMyStatus } = useUserStatus(userId);
  const otherStatus = useOtherUserStatus(otherId);

  // Update activity status
  useEffect(() => {
    if (inputMode === "voice") setMyStatus("recording");
    else if (panel === "gallery") setMyStatus("viewingMedia");
    else if (panel === "search") setMyStatus("browsing");
    else setMyStatus("online");
  }, [inputMode, panel, setMyStatus]);

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
    isMinimized, setIsMinimized, localVideoRef, remoteVideoRef,
    startCall, answerCall, endCall, rejectCall, toggleMute, toggleCamera,
    switchCamera, incomingCallId,
  } = useWebRTC(ROOM_ID, userId);

  // Notifications — foreground toast + background push
  useEffect(() => {
    const prev = prevMessageCountRef.current;
    const curr = messages.length;
    if (curr > prev && prev > 0) {
      const newest = messages[messages.length - 1];
      if (newest && newest.senderId !== userId && !newest.deleted) {
        const type = newest.type as "text" | "image" | "video" | "audio";
        const body =
          type === "text" ? (newest.text?.slice(0, 80) ?? "") :
          type === "image" ? "📸 Photo" :
          type === "video" ? "🎥 Video" :
          type === "audio" ? "🎤 Voice message" : `Sent a ${type}`;
        notify(otherName, body, type);
        if (otherId && document.hidden) {
          sendPushNotification({ toUserId: userId, title: otherName, body });
        }
      }
    }
    prevMessageCountRef.current = curr;
  }, [messages, userId, otherName, otherId, notify]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "S") {
        e.preventDefault();
        setShowAdmin((p) => !p);
      }
      if (e.key === "Escape") {
        setShowAttachMenu(false);
        setShowAdmin(false);
        setEditingMsg(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => { scrollToBottom(false); }, [loading]);
  useEffect(() => { if (messages.length > 0) scrollToBottom(); }, [messages.length]);

  useEffect(() => {
    const unseenFromOther = messages.filter((m) => m.senderId !== userId && !m.seen && !m.deleted);
    unseenFromOther.forEach((m) => markSeen(m.id));
  }, [messages, userId, markSeen]);

  const handleScroll = useCallback(() => {
    const el = scrollAreaRef.current;
    if (!el || !hasMore || loadingMore) return;
    if (el.scrollTop < 100) {
      const prev = el.scrollHeight;
      loadMore().then(() => { el.scrollTop = el.scrollHeight - prev; });
    }
  }, [hasMore, loadingMore, loadMore]);

  const handleSendText = useCallback(async () => {
    if (!settings.messagingEnabled) return;
    const t = text.trim();
    if (!t) return;
    setText("");
    setReplyTo(null);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    setTyping(false);
    await sendMessage({
      type: "text",
      text: t,
      replyToId: replyTo?.id,
      replyToText: replyTo?.text?.slice(0, 80),
    });
  }, [text, replyTo, sendMessage, setTyping, settings.messagingEnabled]);

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
    if (e.key === "Escape" && editingMsg) {
      setEditingMsg(null);
      setEditText("");
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    if (editingMsg) { setEditText(val); return; }
    if (val.trim().toLowerCase() === settings.adminKeyword) {
      setText("");
      setShowAdmin(true);
      return;
    }
    setText(val);
    if (settings.typingIndicatorEnabled) {
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
    });
    setReplyTo(null);
    setViewOnceNext(false);
  };

  const handleVoiceSend = async (blob: Blob) => {
    const file = new File([blob], `voice_${Date.now()}.webm`, { type: "audio/webm" });
    const { url } = await uploadMedia(file);
    await sendMessage({ type: "audio", mediaUrl: url });
    setInputMode("text");
  };

  const handleVideoNoteSend = async (blob: Blob) => {
    const file = new File([blob], `vidnote_${Date.now()}.webm`, { type: "video/webm" });
    const { url } = await uploadMedia(file);
    await sendMessage({ type: "video", mediaUrl: url });
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
      const d = msg.createdAt ? formatDate(msg.createdAt) : "Today";
      if (d !== currentDate) { groups.push({ date: d, msgs: [] }); currentDate = d; }
      groups[groups.length - 1].msgs.push(msg);
    });
    return groups;
  }, [messages]);

  const showCursors = settings.cursorPresenceEnabled && !isMobileDevice;
  const statusDot = STATUS_DOT[otherStatus] ?? STATUS_DOT.offline;
  const activeValue = editingMsg ? editText : text;

  return (
    <div
      className="flex bg-[#080810] overflow-hidden"
      style={{ height: "100dvh", userSelect: "none" }}
    >
      {showCursors && <CursorPresence cursors={otherCursors} />}

      {showAdmin && (
        <AdminPanel settings={settings} onUpdate={updateSetting} onClose={() => setShowAdmin(false)} />
      )}

      {/* In-app toast notifications */}
      <div className="fixed top-4 right-4 z-[400] flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-start gap-3 bg-[#1a1a2e]/95 border border-white/10 rounded-2xl px-4 py-3 shadow-2xl max-w-xs backdrop-blur-xl"
            style={{ animation: "toastIn 0.25s ease-out" }}
          >
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center flex-shrink-0">
              <span className="text-sm">
                {toast.type === "image" ? "📸" :
                 toast.type === "video" ? "🎥" :
                 toast.type === "audio" ? "🎤" :
                 toast.type === "call" ? "📞" : "💬"}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm leading-tight">{toast.title}</p>
              <p className="text-white/50 text-xs mt-0.5 truncate">{toast.body}</p>
            </div>
            <button
              onClick={() => dismissToast(toast.id)}
              className="text-white/30 hover:text-white/60 transition flex-shrink-0 mt-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* DP toast */}
      {dpToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[300] px-4 py-2.5 bg-[#1a1a2e] border border-white/10 rounded-2xl text-white/80 text-sm shadow-xl" style={{ animation: "toastIn 0.2s ease-out" }}>
          {dpToast}
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
            <div
              className={cn("absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#0c0c16]", statusDot.color)}
              title={statusDot.label}
            />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm leading-tight">{otherName}</p>
            <p className="text-white/35 text-xs truncate">
              {isOtherTyping && settings.typingIndicatorEnabled ? (
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

          {/* Own DP with upload */}
          <div className="relative mr-1">
            <input
              ref={dpInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDp(f); e.target.value = ""; }}
            />
            <button
              onClick={() => dpInputRef.current?.click()}
              className="w-7 h-7 rounded-full overflow-hidden bg-gradient-to-br from-violet-500 to-pink-600 flex items-center justify-center shadow relative group"
              title="Tap to change profile picture"
            >
              {profile.dpUrl ? (
                <img src={profile.dpUrl} alt="You" className="w-full h-full object-cover" />
              ) : (
                <span className="text-white font-bold text-xs">{userName[0]?.toUpperCase() ?? "Y"}</span>
              )}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center rounded-full">
                <Camera className="w-3 h-3 text-white" />
              </div>
            </button>
            {dpUploading && (
              <div className="absolute inset-0 rounded-full border-2 border-pink-500 border-t-transparent animate-spin" />
            )}
          </div>

          <div className="flex items-center gap-0.5">
            <HeaderBtn onClick={() => setPanel(panel === "search" ? "none" : "search")} active={panel === "search"} testId="button-search">
              <Search className="w-4 h-4" />
            </HeaderBtn>
            <HeaderBtn onClick={() => setPanel(panel === "gallery" ? "none" : "gallery")} active={panel === "gallery"} testId="button-gallery">
              <Images className="w-4 h-4" />
            </HeaderBtn>
            {settings.voiceCallsEnabled && (
              <HeaderBtn onClick={() => startCall("audio")} testId="button-voice-call">
                <Phone className="w-4 h-4" />
              </HeaderBtn>
            )}
            {settings.videoCallsEnabled && (
              <HeaderBtn onClick={() => startCall("video")} testId="button-video-call">
                <Video className="w-4 h-4" />
              </HeaderBtn>
            )}
          </div>
        </div>

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
                    <div
                      key={msg.id}
                      ref={(el) => { if (el) messageRefs.current[msg.id] = el; }}
                      className="py-0.5"
                    >
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
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}

          {isOtherTyping && settings.typingIndicatorEnabled && (
            <div className="flex items-center gap-2 px-2 py-1">
              <div className="bg-white/7 backdrop-blur-sm border border-white/8 rounded-2xl rounded-bl-sm px-4 py-3">
                <div className="flex gap-1 items-center h-4">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="w-1.5 h-1.5 rounded-full bg-white/40 animate-bounce"
                      style={{ animationDelay: `${i * 150}ms` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div
          className="px-3 sm:px-4 flex-shrink-0"
          style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        >
          {/* Edit mode indicator */}
          {editingMsg && (
            <div className="flex items-center gap-3 bg-violet-500/10 border border-violet-500/20 rounded-xl px-4 py-2.5 mb-2">
              <div className="w-0.5 self-stretch bg-violet-400 rounded-full" />
              <div className="flex-1 min-w-0">
                <p className="text-violet-400 text-xs mb-0.5 font-medium">Editing message</p>
                <p className="text-white/40 text-sm truncate">{editingMsg.text}</p>
              </div>
              <button onClick={() => { setEditingMsg(null); setEditText(""); }} className="text-white/30 hover:text-white/60 transition p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Reply bar */}
          {replyTo && !editingMsg && settings.repliesEnabled && (
            <div className="flex items-center gap-3 bg-white/5 border border-white/8 rounded-xl px-4 py-2.5 mb-2">
              <div className="w-0.5 self-stretch bg-pink-500 rounded-full" />
              <div className="flex-1 min-w-0">
                <p className="text-pink-400 text-xs mb-0.5">Replying to</p>
                <p className="text-white/45 text-sm truncate">{replyTo.text ?? "[media]"}</p>
              </div>
              <button onClick={() => setReplyTo(null)} className="text-white/30 hover:text-white/60 transition p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Upload progress */}
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
              editingMsg
                ? "bg-violet-500/5 border-violet-500/20"
                : "bg-white/5 border-white/8"
            )}>
              <input ref={fileInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={(e) => handleFileSelect(e)} />
              <input ref={audioFileRef} type="file" accept="audio/*" className="hidden" onChange={(e) => handleFileSelect(e, true)} />

              {!editingMsg && (
                <div className="relative flex-shrink-0">
                  <button
                    onClick={() => setShowAttachMenu((p) => !p)}
                    className={cn(
                      "p-2 rounded-xl transition text-white/40 hover:text-white",
                      showAttachMenu ? "bg-pink-500/20 text-pink-400" : "hover:bg-white/10"
                    )}
                    data-testid="button-attach-media"
                  >
                    <Plus className="w-5 h-5" />
                  </button>

                  {showAttachMenu && (
                    <div className="absolute bottom-11 left-0 bg-[#1a1a2e] border border-white/10 rounded-2xl overflow-hidden shadow-2xl z-20 w-44">
                      {settings.imageUploadEnabled && (
                        <button
                          onClick={() => { fileInputRef.current?.click(); setShowAttachMenu(false); }}
                          className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/5 text-white/70 hover:text-white transition text-sm"
                        >
                          <ImageIcon className="w-4 h-4 text-pink-400" /> Photo / Video
                        </button>
                      )}
                      {settings.videoUploadEnabled && settings.viewOnceEnabled && (
                        <button
                          onClick={() => { setViewOnceNext(true); fileInputRef.current?.click(); setShowAttachMenu(false); }}
                          className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/5 text-white/70 hover:text-white transition text-sm"
                        >
                          <ImageIcon className="w-4 h-4 text-violet-400" /> View Once
                        </button>
                      )}
                      {settings.videoNotesEnabled && (
                        <button
                          onClick={() => { setInputMode("videonote"); setShowAttachMenu(false); }}
                          className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/5 text-white/70 hover:text-white transition text-sm"
                        >
                          <VideoIcon className="w-4 h-4 text-blue-400" /> Video Note
                        </button>
                      )}
                      <button
                        onClick={() => { audioFileRef.current?.click(); setShowAttachMenu(false); }}
                        className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/5 text-white/70 hover:text-white transition text-sm"
                      >
                        <Paperclip className="w-4 h-4 text-emerald-400" /> Audio file
                      </button>
                    </div>
                  )}
                </div>
              )}

              <textarea
                className="flex-1 bg-transparent text-white placeholder-white/20 resize-none text-sm leading-relaxed focus:outline-none max-h-36 py-2"
                placeholder={
                  editingMsg
                    ? "Edit your message…"
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
                {settings.voiceMessagesEnabled && !text.trim() && !editingMsg && (
                  <button
                    onClick={() => setInputMode("voice")}
                    className="p-2 rounded-xl hover:bg-white/10 text-white/40 hover:text-white transition"
                    data-testid="button-voice-message"
                  >
                    <Mic className="w-5 h-5" />
                  </button>
                )}
                {editingMsg ? (
                  <button
                    onClick={handleEditSubmit}
                    className="p-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-violet-600 text-white hover:opacity-90 active:scale-95 transition-all shadow-lg shadow-violet-500/20"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                ) : text.trim() && settings.messagingEnabled ? (
                  <button
                    onClick={handleSendText}
                    className="p-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-violet-600 text-white hover:opacity-90 active:scale-95 transition-all shadow-lg shadow-pink-500/20"
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
          <SearchPanel messages={messages} onScrollTo={(id) => { scrollToMessage(id); setPanel("none"); }} onClose={() => setPanel("none")} currentUserId={userId} otherName={otherName} />
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
        localVideoRef={localVideoRef} remoteVideoRef={remoteVideoRef}
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

function HeaderBtn({
  children, onClick, active, testId,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "p-2 rounded-xl transition-all",
        active ? "bg-pink-500/20 text-pink-400" : "hover:bg-white/5 text-white/40 hover:text-white"
      )}
    >
      {children}
    </button>
  );
}
