import {
  useState,
  useRef,
  useEffect,
  useCallback,
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
  Circle,
} from "lucide-react";
import { cn, formatDate, formatLastSeen } from "@/lib/utils";
import { useMessages } from "@/hooks/useMessages";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useMediaUpload } from "@/hooks/useMediaUpload";
import { useTypingIndicator, usePresence } from "@/hooks/useSession";
import { useCursorPresence } from "@/hooks/useCursorPresence";
import { useGallery } from "@/hooks/useGallery";
import ChatMessage from "@/components/ChatMessage";
import VoiceRecorder from "@/components/VoiceRecorder";
import CallOverlay from "@/components/CallOverlay";
import SearchPanel from "@/components/SearchPanel";
import GalleryPanel from "@/components/GalleryPanel";
import CursorPresence from "@/components/CursorPresence";
import type { Message } from "@/hooks/useMessages";

const ROOM_ID = "main";

type Props = {
  userId: string;
  userName: string;
  otherId: string | null;
};

export default function ChatPage({ userId, userName, otherId }: Props) {
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [showVoice, setShowVoice] = useState(false);
  const [panel, setPanel] = useState<"none" | "search" | "gallery">("none");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [highlightTimeout, setHighlightTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

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

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
    });
  }, []);

  useEffect(() => { scrollToBottom(false); }, [loading]);
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last && last.senderId === userId) scrollToBottom();
    else if (last && last.senderId !== userId) scrollToBottom();
  }, [messages.length]);

  useEffect(() => {
    const unseenFromOther = messages.filter(
      (m) => m.senderId !== userId && !m.seen && !m.deleted
    );
    unseenFromOther.forEach((m) => markSeen(m.id));
  }, [messages, userId, markSeen]);

  const handleScroll = useCallback(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    if (el.scrollTop < 100 && hasMore && !loadingMore) {
      const prev = el.scrollHeight;
      loadMore().then(() => {
        el.scrollTop = el.scrollHeight - prev;
      });
    }
  }, [hasMore, loadingMore, loadMore]);

  const handleSendText = useCallback(async () => {
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
  }, [text, replyTo, sendMessage, setTyping]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendText();
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    setTyping(e.target.value.length > 0);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const { url, type } = await uploadMedia(file);
    await sendMessage({
      type,
      mediaUrl: url,
      replyToId: replyTo?.id,
      replyToText: replyTo?.text?.slice(0, 80),
    });
    setReplyTo(null);
  };

  const handleVoiceSend = async (blob: Blob) => {
    const file = new File([blob], `voice_${Date.now()}.webm`, {
      type: "audio/webm",
    });
    const { url } = await uploadMedia(file);
    await sendMessage({ type: "audio", mediaUrl: url });
    setShowVoice(false);
  };

  const scrollToMessage = useCallback((id: string) => {
    const el = messageRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      if (highlightTimeout) clearTimeout(highlightTimeout);
      setHighlightId(id);
      const t = setTimeout(() => setHighlightId(null), 1500);
      setHighlightTimeout(t);
    }
  }, [highlightTimeout]);

  const groupedMessages = () => {
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
  };

  return (
    <div className="flex h-screen bg-[#0a0a0f] overflow-hidden select-none">
      <CursorPresence cursors={otherCursors} />

      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/5 bg-[#0d0d14] flex-shrink-0">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center shadow-lg shadow-pink-500/20">
              <span className="text-white font-bold text-sm">
                {otherName[0]?.toUpperCase() ?? "?"}
              </span>
            </div>
            <div
              className={cn(
                "absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[#0d0d14]",
                otherUser?.online ? "bg-emerald-400" : "bg-white/20"
              )}
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm leading-tight">{otherName}</p>
            <p className="text-white/40 text-xs">
              {isOtherTyping
                ? "typing..."
                : otherUser?.online
                ? "online"
                : `last seen ${formatLastSeen(otherUser?.lastSeen ?? null)}`}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPanel(panel === "search" ? "none" : "search")}
              className={cn(
                "p-2.5 rounded-xl transition-all",
                panel === "search"
                  ? "bg-pink-500/20 text-pink-400"
                  : "hover:bg-white/5 text-white/50 hover:text-white"
              )}
              data-testid="button-search"
            >
              <Search className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPanel(panel === "gallery" ? "none" : "gallery")}
              className={cn(
                "p-2.5 rounded-xl transition-all",
                panel === "gallery"
                  ? "bg-pink-500/20 text-pink-400"
                  : "hover:bg-white/5 text-white/50 hover:text-white"
              )}
              data-testid="button-gallery"
            >
              <Images className="w-4 h-4" />
            </button>
            <button
              onClick={() => startCall("audio")}
              className="p-2.5 rounded-xl hover:bg-white/5 text-white/50 hover:text-white transition-all"
              data-testid="button-voice-call"
            >
              <Phone className="w-4 h-4" />
            </button>
            <button
              onClick={() => startCall("video")}
              className="p-2.5 rounded-xl hover:bg-white/5 text-white/50 hover:text-white transition-all"
              data-testid="button-video-call"
            >
              <Video className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div
          ref={scrollAreaRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-4 py-4 space-y-1 scroll-smooth"
          style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.1) transparent" }}
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
            groupedMessages().map(({ date, msgs }) => (
              <div key={date}>
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-white/5" />
                  <span className="text-white/25 text-xs">{date}</span>
                  <div className="flex-1 h-px bg-white/5" />
                </div>
                <div className="space-y-1">
                  {msgs.map((msg) => (
                    <div
                      key={msg.id}
                      ref={(el) => {
                        if (el) messageRefs.current[msg.id] = el;
                      }}
                      className="py-0.5"
                    >
                      <ChatMessage
                        message={msg}
                        isOwn={msg.senderId === userId}
                        onDelete={deleteMessage}
                        onReply={setReplyTo}
                        onScrollTo={scrollToMessage}
                        highlighted={highlightId === msg.id}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}

          {isOtherTyping && (
            <div className="flex items-center gap-2 px-2">
              <div className="bg-white/8 backdrop-blur-sm border border-white/10 rounded-2xl rounded-bl-sm px-4 py-3">
                <div className="flex gap-1 items-center h-4">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="w-1.5 h-1.5 rounded-full bg-white/50 animate-bounce"
                      style={{ animationDelay: `${i * 150}ms` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="px-4 pb-4 flex-shrink-0">
          {replyTo && (
            <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 mb-2">
              <div className="w-0.5 h-full bg-pink-500 rounded-full self-stretch" />
              <div className="flex-1 min-w-0">
                <p className="text-pink-400 text-xs mb-0.5">Replying to</p>
                <p className="text-white/50 text-sm truncate">
                  {replyTo.text ?? "[media]"}
                </p>
              </div>
              <button
                onClick={() => setReplyTo(null)}
                className="text-white/30 hover:text-white/60 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {uploading && (
            <div className="mb-2 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 flex items-center gap-3">
              <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-pink-500 to-violet-600 rounded-full transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-white/40 text-xs">{Math.round(progress)}%</span>
            </div>
          )}

          {showVoice ? (
            <VoiceRecorder
              onSend={handleVoiceSend}
              onCancel={() => setShowVoice(false)}
            />
          ) : (
            <div className="flex items-end gap-2 bg-white/5 border border-white/10 rounded-2xl p-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={handleFileSelect}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="p-2 rounded-xl hover:bg-white/10 text-white/40 hover:text-white transition flex-shrink-0"
                data-testid="button-attach-media"
              >
                <ImageIcon className="w-5 h-5" />
              </button>

              <textarea
                className="flex-1 bg-transparent text-white placeholder-white/20 resize-none text-sm leading-relaxed focus:outline-none max-h-40 py-2"
                placeholder="Write something beautiful..."
                rows={1}
                value={text}
                onChange={handleTextChange}
                onKeyDown={handleKeyDown}
                data-testid="input-message"
                style={{ fieldSizing: "content" } as React.CSSProperties}
              />

              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => setShowVoice(true)}
                  className="p-2 rounded-xl hover:bg-white/10 text-white/40 hover:text-white transition"
                  data-testid="button-voice-message"
                >
                  <Mic className="w-5 h-5" />
                </button>
                <button
                  onClick={handleSendText}
                  disabled={!text.trim()}
                  className="p-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-violet-600 text-white disabled:opacity-30 hover:opacity-90 active:scale-95 transition-all shadow-lg shadow-pink-500/20"
                  data-testid="button-send"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {panel === "search" && (
        <div className="w-80 flex-shrink-0">
          <SearchPanel
            onSearch={searchMessages}
            onScrollTo={(id) => {
              scrollToMessage(id);
              setPanel("none");
            }}
            onClose={() => setPanel("none")}
            currentUserId={userId}
            otherName={otherName}
          />
        </div>
      )}
      {panel === "gallery" && (
        <div className="w-80 flex-shrink-0">
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
