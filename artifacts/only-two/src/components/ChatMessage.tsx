import { useState, useRef } from "react";
import { Trash2, Reply, CheckCheck, Check, Play, Pause, Eye, EyeOff } from "lucide-react";
import { cn, formatTime } from "@/lib/utils";
import type { Message } from "@/hooks/useMessages";
import TextWithLinks from "@/components/LinkPreview";

const REACTION_EMOJIS = ["❤️", "😂", "👍", "😮"];

type Props = {
  message: Message;
  isOwn: boolean;
  currentUserId: string;
  onDelete: (id: string) => void;
  onReply: (msg: Message) => void;
  onReact: (id: string, emoji: string) => void;
  onScrollTo?: (id: string) => void;
  onViewOnce?: (id: string) => void;
  highlighted?: boolean;
  reactionsEnabled?: boolean;
  repliesEnabled?: boolean;
};

function AudioPlayer({ url }: { url: string }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) audioRef.current.pause();
    else audioRef.current.play();
    setPlaying(!playing);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audioRef.current.currentTime = ratio * duration;
  };

  return (
    <div className="flex items-center gap-3 min-w-[200px]">
      <audio
        ref={audioRef}
        src={url}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          setProgress(el.duration ? (el.currentTime / el.duration) * 100 : 0);
        }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={() => { setPlaying(false); setProgress(0); }}
      />
      <button
        onClick={toggle}
        className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors flex-shrink-0 active:scale-95"
      >
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>
      <div className="flex-1">
        <div
          className="relative h-1.5 bg-white/20 rounded-full cursor-pointer"
          onClick={handleSeek}
        >
          <div
            className="absolute left-0 top-0 h-full bg-white/70 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="text-[10px] text-white/40 mt-1 flex justify-between">
          <span>{playing ? `${Math.floor((progress / 100) * duration)}s` : "Voice"}</span>
          {duration ? <span>{Math.floor(duration)}s</span> : null}
        </div>
      </div>
    </div>
  );
}

function ViewOnceMedia({
  message,
  isOwn,
  onViewOnce,
}: {
  message: Message;
  isOwn: boolean;
  onViewOnce: (id: string) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  const handleView = () => {
    if (isOwn) return;
    setRevealed(true);
    let c = 5;
    setCountdown(c);
    const t = setInterval(() => {
      c--;
      setCountdown(c);
      if (c <= 0) {
        clearInterval(t);
        onViewOnce(message.id);
      }
    }, 1000);
  };

  if (!revealed) {
    return (
      <button
        onClick={handleView}
        className={cn(
          "flex items-center justify-center gap-2 rounded-xl px-4 py-6 w-full min-w-[180px]",
          isOwn
            ? "bg-white/10 text-white/70"
            : "bg-white/5 border border-white/10 text-white/60"
        )}
      >
        <div className="text-center">
          {isOwn ? (
            <>
              <EyeOff className="w-6 h-6 mx-auto mb-1 opacity-60" />
              <p className="text-xs">View once</p>
              <p className="text-[10px] opacity-50 mt-0.5">Sent</p>
            </>
          ) : (
            <>
              <Eye className="w-7 h-7 mx-auto mb-2" />
              <p className="text-sm font-medium">Tap to view</p>
              <p className="text-[10px] opacity-50 mt-0.5">
                {message.type === "video" ? "Video" : "Photo"} · View once
              </p>
            </>
          )}
        </div>
      </button>
    );
  }

  return (
    <div className="relative">
      {message.type === "image" && message.mediaUrl ? (
        <img
          src={message.mediaUrl}
          alt="View once"
          className="max-w-[260px] max-h-[300px] rounded-xl object-cover"
        />
      ) : message.type === "video" && message.mediaUrl ? (
        <video
          src={message.mediaUrl}
          autoPlay
          className="max-w-[260px] max-h-[300px] rounded-xl"
        />
      ) : null}
      {countdown !== null && (
        <div className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 flex items-center justify-center">
          <span className="text-white text-sm font-bold">{countdown}</span>
        </div>
      )}
    </div>
  );
}

export default function ChatMessage({
  message,
  isOwn,
  currentUserId,
  onDelete,
  onReply,
  onReact,
  onScrollTo,
  onViewOnce,
  highlighted,
  reactionsEnabled = true,
  repliesEnabled = true,
}: Props) {
  const [showActions, setShowActions] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const swipedRef = useRef(false);

  const myReaction = message.reactions?.[currentUserId];
  const allReactions = Object.values(message.reactions ?? {});
  const reactionCounts = allReactions.reduce<Record<string, number>>((acc, e) => {
    acc[e] = (acc[e] ?? 0) + 1;
    return acc;
  }, {});

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    swipedRef.current = false;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!repliesEnabled) return;
    if (message.deleted) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = Math.abs(e.changedTouches[0].clientY - touchStartY.current);
    if (dx > 55 && dy < 40 && !swipedRef.current) {
      swipedRef.current = true;
      onReply(message);
    }
  };

  const handleReact = (emoji: string) => {
    if (emoji === myReaction) {
      onReact(message.id, "");
    } else {
      onReact(message.id, emoji);
    }
    setShowPicker(false);
    setShowActions(false);
  };

  if (message.deleted) {
    return (
      <div className={cn("flex", isOwn ? "justify-end" : "justify-start")}>
        <div className="px-4 py-2 rounded-2xl bg-white/5 border border-white/5 text-white/25 text-xs italic max-w-xs">
          This message was deleted
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex group relative transition-all duration-200",
        isOwn ? "justify-end" : "justify-start",
        highlighted && "bg-yellow-500/8 rounded-xl px-2"
      )}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => { setShowActions(false); setShowPicker(false); }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className={cn("flex items-end gap-2 max-w-[80%] sm:max-w-[75%]", isOwn && "flex-row-reverse")}>
        {showActions && (
          <div
            className={cn(
              "flex flex-col items-center gap-1 mb-1 transition-all duration-150",
              isOwn ? "mr-1" : "ml-1"
            )}
          >
            {reactionsEnabled && (
              <div className="relative">
                <button
                  onClick={() => setShowPicker((p) => !p)}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-white/50 hover:text-white/80 transition-all text-sm leading-none"
                  title="React"
                >
                  ❤️
                </button>
                {showPicker && (
                  <div
                    className={cn(
                      "absolute bottom-8 flex items-center gap-1 bg-[#1a1a2e] border border-white/10 rounded-2xl px-2 py-1.5 shadow-xl z-20",
                      isOwn ? "right-0" : "left-0"
                    )}
                  >
                    {REACTION_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => handleReact(emoji)}
                        className={cn(
                          "text-lg hover:scale-125 transition-transform active:scale-110 p-0.5 rounded-lg",
                          myReaction === emoji && "bg-white/10"
                        )}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {repliesEnabled && (
              <button
                onClick={() => onReply(message)}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 transition-all"
                title="Reply"
              >
                <Reply className="w-3.5 h-3.5" />
              </button>
            )}
            {isOwn && (
              <button
                onClick={() => onDelete(message.id)}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-rose-500/20 text-white/50 hover:text-rose-400 transition-all"
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1">
          <div
            className={cn(
              "relative rounded-2xl overflow-visible",
              isOwn
                ? "bg-gradient-to-br from-pink-500 to-violet-600 text-white rounded-br-sm shadow-lg shadow-pink-500/20"
                : "bg-white/8 backdrop-blur-sm border border-white/10 text-white rounded-bl-sm"
            )}
          >
            {message.replyToId && (
              <button
                onClick={() => onScrollTo?.(message.replyToId!)}
                className={cn(
                  "block w-full text-left px-3 pt-2 pb-1 border-l-2 text-xs opacity-70 rounded-t-2xl",
                  isOwn
                    ? "border-white/50 bg-black/10"
                    : "border-pink-500/60 bg-white/5"
                )}
              >
                <div className="truncate max-w-[200px]">
                  {message.replyToText ?? "Replied message"}
                </div>
              </button>
            )}

            <div className="px-4 py-2.5">
              {message.type === "text" && message.text && (
                <TextWithLinks text={message.text} isOwn={isOwn} />
              )}
              {(message.type === "image" || message.type === "video") &&
                message.viewOnce ? (
                <ViewOnceMedia
                  message={message}
                  isOwn={isOwn}
                  onViewOnce={onViewOnce ?? (() => {})}
                />
              ) : (
                <>
                  {message.type === "image" && message.mediaUrl && (
                    <a
                      href={message.mediaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      <img
                        src={message.mediaUrl}
                        alt="Image"
                        className="max-w-[260px] max-h-[300px] rounded-xl object-cover cursor-pointer hover:opacity-90 transition-opacity"
                        loading="lazy"
                      />
                    </a>
                  )}
                  {message.type === "video" && message.mediaUrl && (
                    <video
                      src={message.mediaUrl}
                      controls
                      className="max-w-[260px] max-h-[300px] rounded-xl"
                      playsInline
                    />
                  )}
                </>
              )}
              {message.type === "audio" && message.mediaUrl && (
                <AudioPlayer url={message.mediaUrl} />
              )}

              <div
                className={cn(
                  "flex items-center gap-1 mt-1",
                  isOwn ? "justify-end" : "justify-start"
                )}
              >
                <span className="text-[10px] opacity-40">
                  {formatTime(message.createdAt)}
                </span>
                {isOwn && (
                  <span className="opacity-50">
                    {message.seen ? (
                      <CheckCheck className="w-3 h-3 text-sky-300" />
                    ) : message.delivered ? (
                      <CheckCheck className="w-3 h-3" />
                    ) : (
                      <Check className="w-3 h-3" />
                    )}
                  </span>
                )}
              </div>
            </div>
          </div>

          {Object.keys(reactionCounts).length > 0 && (
            <div
              className={cn(
                "flex flex-wrap gap-1",
                isOwn ? "justify-end" : "justify-start"
              )}
            >
              {Object.entries(reactionCounts).map(([emoji, count]) => (
                <button
                  key={emoji}
                  onClick={() => reactionsEnabled && handleReact(emoji)}
                  className={cn(
                    "flex items-center gap-0.5 px-2 py-0.5 rounded-full text-sm border transition-all",
                    myReaction === emoji
                      ? "bg-pink-500/20 border-pink-500/40"
                      : "bg-white/5 border-white/10 hover:bg-white/10"
                  )}
                >
                  <span>{emoji}</span>
                  {count > 1 && (
                    <span className="text-[10px] text-white/50">{count}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
