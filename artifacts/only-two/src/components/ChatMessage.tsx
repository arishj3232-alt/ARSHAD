import { useState, useRef } from "react";
import { Trash2, Reply, CheckCheck, Check, Play, Pause } from "lucide-react";
import { cn, formatTime } from "@/lib/utils";
import type { Message } from "@/hooks/useMessages";

type Props = {
  message: Message;
  isOwn: boolean;
  onDelete: (id: string) => void;
  onReply: (msg: Message) => void;
  onScrollTo?: (id: string) => void;
  highlighted?: boolean;
};

function AudioPlayer({ url }: { url: string }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setPlaying(!playing);
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
        className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors flex-shrink-0"
      >
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      <div className="flex-1">
        <div className="relative h-1.5 bg-white/20 rounded-full">
          <div
            className="absolute left-0 top-0 h-full bg-white/70 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="text-[10px] text-white/40 mt-1">
          {duration ? `${Math.floor(duration)}s` : "Voice message"}
        </div>
      </div>
    </div>
  );
}

export default function ChatMessage({
  message,
  isOwn,
  onDelete,
  onReply,
  onScrollTo,
  highlighted,
}: Props) {
  const [showActions, setShowActions] = useState(false);

  if (message.deleted) {
    return (
      <div className={cn("flex", isOwn ? "justify-end" : "justify-start")}>
        <div className="px-4 py-2 rounded-2xl bg-white/5 border border-white/10 text-white/30 text-sm italic max-w-xs">
          This message was deleted
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex group",
        isOwn ? "justify-end" : "justify-start",
        highlighted && "bg-yellow-500/10 rounded-xl px-2"
      )}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className={cn("flex items-end gap-2 max-w-[75%]", isOwn && "flex-row-reverse")}>
        {showActions && (
          <div className={cn(
            "flex items-center gap-1 mb-1 opacity-0 group-hover:opacity-100 transition-opacity",
            isOwn ? "mr-1" : "ml-1"
          )}>
            <button
              onClick={() => onReply(message)}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 transition-all"
              title="Reply"
            >
              <Reply className="w-3.5 h-3.5" />
            </button>
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

        <div
          className={cn(
            "relative rounded-2xl overflow-hidden",
            isOwn
              ? "bg-gradient-to-br from-pink-500 to-violet-600 text-white rounded-br-sm"
              : "bg-white/8 backdrop-blur-sm border border-white/10 text-white rounded-bl-sm"
          )}
        >
          {message.replyToId && (
            <button
              onClick={() => onScrollTo?.(message.replyToId!)}
              className={cn(
                "block w-full text-left px-3 pt-2 pb-1 border-l-2 text-xs opacity-70",
                isOwn ? "border-white/50 bg-black/10" : "border-pink-500/50 bg-white/5"
              )}
            >
              <div className="truncate">{message.replyToText ?? "Replied message"}</div>
            </button>
          )}

          <div className="px-4 py-2.5">
            {message.type === "text" && (
              <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">
                {message.text}
              </p>
            )}
            {message.type === "image" && message.mediaUrl && (
              <a href={message.mediaUrl} target="_blank" rel="noopener noreferrer">
                <img
                  src={message.mediaUrl}
                  alt="Image"
                  className="max-w-[260px] max-h-[300px] rounded-xl object-cover cursor-pointer hover:opacity-90 transition-opacity"
                />
              </a>
            )}
            {message.type === "video" && message.mediaUrl && (
              <video
                src={message.mediaUrl}
                controls
                className="max-w-[260px] max-h-[300px] rounded-xl"
              />
            )}
            {message.type === "audio" && message.mediaUrl && (
              <AudioPlayer url={message.mediaUrl} />
            )}

            <div className={cn(
              "flex items-center gap-1 mt-1",
              isOwn ? "justify-end" : "justify-start"
            )}>
              <span className="text-[10px] opacity-50">
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
      </div>
    </div>
  );
}
