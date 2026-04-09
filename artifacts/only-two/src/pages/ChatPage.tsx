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
  Shield,
  Plus,
  Paperclip,
} from "lucide-react";
import { cn, formatDate, formatLastSeen } from "@/lib/utils";
import { useMessages } from "@/hooks/useMessages";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useMediaUpload } from "@/hooks/useMediaUpload";
import { useTypingIndicator, usePresence } from "@/hooks/useSession";
import { useCursorPresence } from "@/hooks/useCursorPresence";
import { useGallery } from "@/hooks/useGallery";
import { useAdmin } from "@/hooks/useAdmin";
import { useNotifications } from "@/hooks/useNotifications";
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

const isMobileDevice =
  typeof window !== "undefined" &&
  ("ontouchstart" in window || navigator.maxTouchPoints > 0);

type Props = {
  userId: string;
  userName: string;
  otherId: string | null;
};

type InputMode = "text" | "voice" | "videonote";

export default function ChatPage({ userId, userName, otherId }: Props) {
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
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
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);

  const { settings, updateSetting } = useAdmin();
  const { notify } = useNotifications(settings.notificationsEnabled);
  const presence = usePresence(userId);
  const otherUser = otherId ? presence[otherId] : null;
  const otherName = otherUser?.name ?? "Them";

  const {
    messages,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    sendMessage,
    deleteMessage,
    markSeen,
    addReaction,
    removeReaction,
    markViewOnceViewed,
    searchMessages,
  } = useMessages(ROOM_ID, userId);

  const { isOtherTyping, setTyping } = useTypingIndicator(ROOM_ID, userId);
  const { uploading, progress, uploadMedia } = useMediaUpload();
  const { otherCursors } = useCursorPresence(userId, userName);
  const { mediaMessages, loading: galleryLoading } = useGallery(ROOM_ID);

  const {
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
    incomingCallId,
  } = useWebRTC(ROOM_ID, userId);

  // Notifications for new messages from other user
  useEffect(() => {
    const prev = prevMessageCountRef.current;
    const curr = messages.length;
    if (curr > prev && prev > 0) {
      const newest = messages[messages.length - 1];
      if (newest && newest.senderId !== userId && !newest.deleted) {
        const preview =
          newest.type === "text"
            ? newest.text?.slice(0, 80) ?? ""
            : `Sent a ${newest.type}`;
        notify(otherName, preview);
      }
    }
    prevMessageCountRef.current = curr;
  }, [messages, userId, otherName, notify]);

  // CTRL+SHIFT+S to open admin panel, Escape to close menus
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "S") {
        e.preventDefault();
        setShowAdmin((p) => !p);
      }
      if (e.key === "Escape") {
        setShowAttachMenu(false);
        setShowAdmin(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
    });
  }, []);

  useEffect(() => { scrollToBottom(false); }, [loading]);

  useEffect(() => {
    if (messages.length === 0) return;
    scrollToBottom();
  }, [messages.length]);

  useEffect(() => {
    const unseenFromOther = messages.filter(
      (m) => m.senderId !== userId && !m.seen && !m.deleted
    );
    unseenFromOther.forEach((m) => markSeen(m.id));
  }, [messages, userId, markSeen]);

  const handleScroll = useCallback(() => {
    const el = scrollAreaRef.current;
    if (!el || !hasMore || loadingMore) return;
    if (el.scrollTop < 100) {
      const prev = el.scrollHeight;
      loadMore().then(() => {
        el.scrollTop = el.scrollHeight - prev;
      });
    }
  }, [hasMore, loadingMore, loadMore]);

  const handleSendText = useCallback(async () => {
    if (!settings.messagingEnabled) return;
    const t = text.trim();
    if (!t) return;
    setText("");
    setReplyTo(null);
    setTyping(false);
    await sendMessage({
      type: "text",
      text: t,
      replyToId: replyTo?.id,
      replyToText: replyTo?.text?.slice(0, 80),
    });
  }, [text, replyTo, sendMessage, setTyping, settings.messagingEnabled]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendText();
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    // Secret admin trigger
    if (val.trim().toLowerCase() === "laura") {
      setText("");
      setShowAdmin(true);
      return;
    }
    setText(val);
    if (settings.typingIndicatorEnabled) setTyping(val.length > 0);
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
      if (!emoji) {
        await removeReaction(messageId);
      } else {
        await addReaction(messageId, emoji);
      }
    },
    [addReaction, removeReaction, settings.reactionsEnabled]
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
      if (d !== currentDate) {
        groups.push({ date: d, msgs: [] });
        currentDate = d;
      }
      groups[groups.length - 1].msgs.push(msg);
    });
    return groups;
  }, [messages]);

  const showCursors =
    settings.cursorPresenceEnabled && !isMobileDevice;

  return (
    <div className="flex h-screen bg-[#080810] overflow-hidden" style={{ userSelect: "none" }}>
      {showCursors && <CursorPresence cursors={otherCursors} />}

      {showAdmin && (
        <AdminPanel
          settings={settings}
          onUpdate={updateSetting}
          onClose={() => setShowAdmin(false)}
        />
      )}

      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 bg-[#0c0c16]/80 backdrop-blur-xl flex-shrink-0">
          <div className="relative flex-shrink-0">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center shadow-lg shadow-pink-500/20">
              <span className="text-white font-bold text-sm">
                {otherName[0]?.toUpperCase() ?? "?"}
              </span>
            </div>
            <div
              className={cn(
                "absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#0c0c16]",
                otherUser?.online ? "bg-emerald-400" : "bg-white/20"
              )}
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm leading-tight">
              {otherName}
            </p>
            <p className="text-white/35 text-xs truncate">
              {isOtherTyping && settings.typingIndicatorEnabled ? (
                <span className="text-pink-400/70">typing…</span>
              ) : otherUser?.online ? (
                "online"
              ) : settings.lastSeenEnabled ? (
                `last seen ${formatLastSeen(otherUser?.lastSeen ?? null)}`
              ) : (
                ""
              )}
            </p>
          </div>
          <div className="flex items-center gap-0.5">
            <HeaderBtn
              onClick={() => setPanel(panel === "search" ? "none" : "search")}
              active={panel === "search"}
              testId="button-search"
            >
              <Search className="w-4 h-4" />
            </HeaderBtn>
            <HeaderBtn
              onClick={() => setPanel(panel === "gallery" ? "none" : "gallery")}
              active={panel === "gallery"}
              testId="button-gallery"
            >
              <Images className="w-4 h-4" />
            </HeaderBtn>
            {settings.voiceCallsEnabled && (
              <HeaderBtn
                onClick={() => startCall("audio")}
                testId="button-voice-call"
              >
                <Phone className="w-4 h-4" />
              </HeaderBtn>
            )}
            {settings.videoCallsEnabled && (
              <HeaderBtn
                onClick={() => startCall("video")}
                testId="button-video-call"
              >
                <Video className="w-4 h-4" />
              </HeaderBtn>
            )}
            <HeaderBtn onClick={() => setShowAdmin((p) => !p)}>
              <Shield className="w-4 h-4" />
            </HeaderBtn>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={scrollAreaRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 space-y-1"
          style={{
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(255,255,255,0.08) transparent",
          }}
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
                  <span className="text-white/20 text-[11px] px-2 bg-white/3 rounded-full py-0.5">
                    {date}
                  </span>
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
                        onDelete={deleteMessage}
                        onReply={settings.repliesEnabled ? setReplyTo : () => {}}
                        onReact={handleReact}
                        onScrollTo={scrollToMessage}
                        onViewOnce={markViewOnceViewed}
                        highlighted={highlightId === msg.id}
                        reactionsEnabled={settings.reactionsEnabled}
                        repliesEnabled={settings.repliesEnabled}
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

        {/* Input */}
        <div className="px-3 sm:px-4 pb-4 flex-shrink-0">
          {replyTo && settings.repliesEnabled && (
            <div className="flex items-center gap-3 bg-white/5 border border-white/8 rounded-xl px-4 py-2.5 mb-2">
              <div className="w-0.5 self-stretch bg-pink-500 rounded-full" />
              <div className="flex-1 min-w-0">
                <p className="text-pink-400 text-xs mb-0.5">Replying to</p>
                <p className="text-white/45 text-sm truncate">
                  {replyTo.text ?? "[media]"}
                </p>
              </div>
              <button
                onClick={() => setReplyTo(null)}
                className="text-white/30 hover:text-white/60 transition p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {uploading && (
            <div className="mb-2 bg-white/5 border border-white/8 rounded-xl px-4 py-2.5 flex items-center gap-3">
              <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-pink-500 to-violet-600 rounded-full transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-white/40 text-xs">{Math.round(progress)}%</span>
            </div>
          )}

          {inputMode === "voice" ? (
            <VoiceRecorder
              onSend={handleVoiceSend}
              onCancel={() => setInputMode("text")}
            />
          ) : inputMode === "videonote" ? (
            <VideoNoteRecorder
              onSend={handleVideoNoteSend}
              onCancel={() => setInputMode("text")}
            />
          ) : (
            <div className="flex items-end gap-2 bg-white/5 border border-white/8 rounded-2xl p-2 relative">
              {/* Hidden file inputs */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={(e) => handleFileSelect(e)}
              />
              <input
                ref={audioFileRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => handleFileSelect(e, true)}
              />

              {/* Attach button + menu */}
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
                        <ImageIcon className="w-4 h-4 text-pink-400" />
                        Photo / Video
                      </button>
                    )}
                    {settings.videoUploadEnabled && settings.viewOnceEnabled && (
                      <button
                        onClick={() => {
                          setViewOnceNext(true);
                          fileInputRef.current?.click();
                          setShowAttachMenu(false);
                        }}
                        className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/5 text-white/70 hover:text-white transition text-sm"
                      >
                        <ImageIcon className="w-4 h-4 text-violet-400" />
                        View Once
                      </button>
                    )}
                    {settings.videoNotesEnabled && (
                      <button
                        onClick={() => { setInputMode("videonote"); setShowAttachMenu(false); }}
                        className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/5 text-white/70 hover:text-white transition text-sm"
                      >
                        <VideoIcon className="w-4 h-4 text-blue-400" />
                        Video Note
                      </button>
                    )}
                    <button
                      onClick={() => { audioFileRef.current?.click(); setShowAttachMenu(false); }}
                      className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/5 text-white/70 hover:text-white transition text-sm"
                    >
                      <Paperclip className="w-4 h-4 text-emerald-400" />
                      Audio file
                    </button>
                  </div>
                )}
              </div>

              <textarea
                className="flex-1 bg-transparent text-white placeholder-white/20 resize-none text-sm leading-relaxed focus:outline-none max-h-36 py-2"
                placeholder={
                  settings.messagingEnabled
                    ? "Write something beautiful…"
                    : "Messaging is disabled"
                }
                rows={1}
                value={text}
                onChange={handleTextChange}
                onKeyDown={handleKeyDown}
                disabled={!settings.messagingEnabled}
                data-testid="input-message"
                style={{ fieldSizing: "content" } as React.CSSProperties}
              />

              <div className="flex items-center gap-1 flex-shrink-0">
                {settings.voiceMessagesEnabled && !text.trim() && (
                  <button
                    onClick={() => setInputMode("voice")}
                    className="p-2 rounded-xl hover:bg-white/10 text-white/40 hover:text-white transition"
                    data-testid="button-voice-message"
                  >
                    <Mic className="w-5 h-5" />
                  </button>
                )}
                {text.trim() && settings.messagingEnabled && (
                  <button
                    onClick={handleSendText}
                    className="p-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-violet-600 text-white hover:opacity-90 active:scale-95 transition-all shadow-lg shadow-pink-500/20"
                    data-testid="button-send"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Side panels — slide overlay on mobile */}
      {panel === "search" && (
        <div
          className={cn(
            "flex-shrink-0",
            isMobileDevice
              ? "fixed inset-y-0 right-0 w-full max-w-sm z-40 shadow-2xl"
              : "w-72 sm:w-80"
          )}
        >
          <SearchPanel
            onSearch={searchMessages}
            onScrollTo={(id) => { scrollToMessage(id); setPanel("none"); }}
            onClose={() => setPanel("none")}
            currentUserId={userId}
            otherName={otherName}
          />
        </div>
      )}
      {panel === "gallery" && (
        <div
          className={cn(
            "flex-shrink-0",
            isMobileDevice
              ? "fixed inset-y-0 right-0 w-full max-w-sm z-40 shadow-2xl"
              : "w-72 sm:w-80"
          )}
        >
          <GalleryPanel
            mediaMessages={mediaMessages}
            loading={galleryLoading}
            onClose={() => setPanel("none")}
          />
        </div>
      )}

      <CallOverlay
        callStatus={callStatus}
        callType={callType}
        isMuted={isMuted}
        isCameraOff={isCameraOff}
        callDuration={callDuration}
        isMinimized={isMinimized}
        setIsMinimized={setIsMinimized}
        localVideoRef={localVideoRef}
        remoteVideoRef={remoteVideoRef}
        onEnd={endCall}
        onToggleMute={toggleMute}
        onToggleCamera={toggleCamera}
        onSwitchCamera={switchCamera}
        onAnswer={() => incomingCallId && answerCall(incomingCallId)}
        onReject={() => incomingCallId && rejectCall(incomingCallId)}
        otherName={otherName}
      />
    </div>
  );
}

function HeaderBtn({
  children,
  onClick,
  active,
  testId,
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
        active
          ? "bg-pink-500/20 text-pink-400"
          : "hover:bg-white/5 text-white/40 hover:text-white"
      )}
    >
      {children}
    </button>
  );
}
