import { useState, useRef, useEffect, useCallback, memo } from "react";
import {
  Trash2,
  Reply,
  Play,
  Pause,
  Eye,
  EyeOff,
  X,
  Pencil,
  Lock,
  Phone,
  Video,
} from "lucide-react";
import { cn, formatTime, formatCallDuration } from "@/lib/utils";
import type { Message, MessageType } from "@/hooks/useMessages";
import TextWithLinks from "@/components/LinkPreview";
import { SafeImage, SafeVideo } from "@/components/SafeMedia";

type Props = {
  message: Message;
  isOwn: boolean;
  currentUserId: string;
  onDelete: (id: string) => void;
  onDeleteForMe: (id: string) => void;
  onDeleteForEveryone: (id: string) => void;
  onEdit: (msg: Message) => void;
  onReply: (msg: Message) => void;
  onReact: (id: string, emoji: string) => void;
  onScrollTo?: (id: string) => void;
  onViewOnce?: (id: string) => void;
  highlighted?: boolean;
  reactionsEnabled?: boolean;
  repliesEnabled?: boolean;
  reactionEmojis?: string[];
  fastReactionEmoji?: string;
  replyMode?: "tap" | "swipe" | "both";
  deletedForEveryoneText?: string;
  viewOnceLimitText?: string;
  dpUrl?: string | null;
  /** Admin + reveal keyword: show original deleted text/media. */
  revealDeletedContent?: boolean;
  maskReadReceiptInUi?: boolean;
  viewOnceEnabled?: boolean;
  viewOnceTimerMs?: number;
  imageDownloadProtection?: boolean;
  onCallAgain?: (type: "audio" | "video") => void;
  onDpPreview?: (url: string) => void;
  /** Opens peer profile modal (name + photo + bio). */
  onPeerProfileClick?: () => void;
  /** Firestore presence: other user online (pulse on avatar). */
  peerOnline?: boolean;
  /** Consecutive same-sender grouping (hide duplicate avatars). */
  hidePeerAvatar?: boolean;
  compactInGroup?: boolean;
};

const WAVEFORM = [4, 7, 12, 18, 22, 28, 24, 16, 10, 20, 30, 26, 14, 8, 22, 18, 12, 6, 16, 24];

function viewOnceRevealMediaType(message: Message): "image" | "video" {
  const o = message.originalMediaType;
  if (o === "image" || o === "video") return o;
  return message.type === "video" ? "video" : "image";
}

function coalesceMediaUrl(msg: Message): string | undefined {
  const u = msg.originalMediaUrl || msg.mediaUrl;
  return typeof u === "string" && u.trim() ? u.trim() : undefined;
}

function coalesceMediaType(msg: Message): MessageType {
  const o = msg.originalMediaType;
  if (o === "image" || o === "video" || o === "audio") return o;
  return msg.type;
}

/** Admin reveal: originals || live fields so legacy / partial docs never blank the UI. */
function getVisibleContent(
  msg: Message,
  canReveal: boolean
): { text?: string; mediaUrl?: string; mediaType: MessageType } {
  if (msg.deleted || msg.deletedForEveryone) {
    if (canReveal) {
      const t = (msg.originalText || msg.text || "").trim() || undefined;
      return {
        text: t,
        mediaUrl: coalesceMediaUrl(msg),
        mediaType: coalesceMediaType(msg),
      };
    }
    return { mediaType: "text" };
  }

  if (canReveal) {
    const t = (msg.text || msg.originalText || "").trim() || undefined;
    return {
      text: t,
      mediaUrl: coalesceMediaUrl(msg),
      mediaType: coalesceMediaType(msg),
    };
  }

  return {
    text: msg.text?.trim() ? msg.text : undefined,
    mediaUrl: typeof msg.mediaUrl === "string" && msg.mediaUrl.trim() ? msg.mediaUrl.trim() : undefined,
    mediaType: msg.type,
  };
}

// ─── Audio player ────────────────────────────────────────────────────────────
function AudioPlayer({ url }: { url: string }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [mediaError, setMediaError] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { audioRef.current.play(); setPlaying(true); }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = ratio * duration;
  };

  if (mediaError) {
    return <div className="text-xs text-white/45 px-2 py-3 rounded-lg bg-white/5 border border-white/10">Audio unavailable</div>;
  }

  return (
    <div className="flex items-center gap-3 min-w-[200px]">
      <audio
        ref={audioRef}
        src={url}
        onError={() => setMediaError(true)}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          setProgress(el.duration ? (el.currentTime / el.duration) * 100 : 0);
        }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={() => { setPlaying(false); setProgress(0); }}
      />
      <button
        onClick={toggle}
        className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition flex-shrink-0 active:scale-95"
      >
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>
      <div className="flex-1">
        <div className="relative h-8 flex items-end gap-0.5 cursor-pointer" onClick={handleSeek}>
          {WAVEFORM.map((h, i) => {
            const pct = ((i + 1) / WAVEFORM.length) * 100;
            return (
              <div
                key={i}
                className="flex-1 rounded-full transition-all duration-75"
                style={{
                  height: `${h}px`,
                  background: pct <= progress ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.2)",
                }}
              />
            );
          })}
        </div>
        <div className="text-[10px] text-white/40 mt-0.5">
          {duration ? `${Math.floor(duration)}s` : "Voice message"}
        </div>
      </div>
    </div>
  );
}

function CanvasImage({
  src,
  className,
  alt,
  onClick,
}: {
  src: string;
  className?: string;
  alt?: string;
  onClick?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    setLoadError(false);
    let cancelled = false;
    let localBlobUrl: string | null = null;

    const load = async () => {
      try {
        const res = await fetch(src);
        const blob = await res.blob();
        if (cancelled) return;
        localBlobUrl = URL.createObjectURL(blob);
        setBlobUrl(localBlobUrl);
      } catch {
        if (!cancelled) {
          setBlobUrl(null);
          setLoadError(true);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (localBlobUrl) URL.revokeObjectURL(localBlobUrl);
    };
  }, [src]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !blobUrl) return;
    const img = new Image();
    img.onerror = () => setLoadError(true);
    img.onload = () => {
      const maxW = 260;
      const maxH = 300;
      const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
    };
    img.src = blobUrl;
  }, [blobUrl]);

  if (loadError) {
    return (
      <div className={cn("text-xs text-white/45 px-2 py-3 rounded-lg bg-white/5 border border-white/10", className)}>
        Media unavailable
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-label={alt}
      onClick={onClick}
      draggable={false}
      onContextMenu={(e) => e.preventDefault()}
      style={{ userSelect: "none" }}
    />
  );
}

// ─── Fullscreen viewer ───────────────────────────────────────────────────────
function FullscreenViewer({
  url,
  type,
  onClose,
  imageDownloadProtection = true,
}: { url: string; type: "image" | "video"; onClose: () => void; imageDownloadProtection?: boolean }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", h);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  useEffect(() => {
    if (type !== "image") return undefined;
    let cancelled = false;
    let localBlobUrl: string | null = null;
    const run = async () => {
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        if (cancelled) return;
        localBlobUrl = URL.createObjectURL(blob);
        setBlobUrl(localBlobUrl);
      } catch {
        setBlobUrl(null);
      }
    };
    void run();
    return () => {
      cancelled = true;
      if (localBlobUrl) URL.revokeObjectURL(localBlobUrl);
    };
  }, [url, type]);

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-lg flex items-center justify-center"
      style={{ animation: "fadeIn 0.2s ease-out", userSelect: "none" }}
      onClick={onClose}
      onContextMenu={(e) => {
        if (imageDownloadProtection) e.preventDefault();
      }}
    >
      <button onClick={onClose} className="absolute top-4 right-4 z-10 p-2.5 rounded-full bg-white/10 hover:bg-white/20 transition text-white">
        <X className="w-5 h-5" />
      </button>
      {type === "image" ? (
        <div onClick={(e) => e.stopPropagation()} className="max-w-full max-h-full flex items-center justify-center">
          <SafeImage
            src={blobUrl ?? url}
            alt="Full view"
            className="max-w-full max-h-full object-contain rounded-xl"
            style={{ animation: "scaleIn 0.2s ease-out" }}
            draggable={imageDownloadProtection ? false : true}
            onContextMenu={(e) => {
              if (imageDownloadProtection) e.preventDefault();
            }}
          />
        </div>
      ) : (
        <div
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          className="max-w-full max-h-full flex items-center justify-center"
        >
          <SafeVideo
            src={url}
            autoPlay
            playsInline
            className="max-w-full max-h-full rounded-xl"
          />
        </div>
      )}
    </div>
  );
}

// ─── View-once media ─────────────────────────────────────────────────────────
function ViewOnceMedia({ message, isOwn, onViewOnce, limitText, revealDeletedContent, viewOnceTimerMs = 15_000, imageDownloadProtection = true }: {
  message: Message; isOwn: boolean; onViewOnce: (id: string) => void; limitText: string; revealDeletedContent: boolean; viewOnceTimerMs?: number; imageDownloadProtection?: boolean;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const [tick, setTick] = useState(0);
  const hasStar = limitText.includes("*️⃣");
  const viewLockRef = useRef(false);
  const closedByExpiryRef = useRef(false);
  const openedBy = message.openedBy ?? [];
  const opened = openedBy.length > 0;
  const openedAt = message.openedAt ?? null;
  const effectiveExpiresAt = openedAt ? openedAt + viewOnceTimerMs : null;
  const expiresAt = effectiveExpiresAt ?? message.expiresAt ?? null;
  const isExpired = !!expiresAt && Date.now() >= expiresAt;
  const canReceiverView = !isOwn && opened && !isExpired;

  useEffect(() => {
    // Reset one-shot local guard when message identity changes.
    viewLockRef.current = false;
    closedByExpiryRef.current = false;
  }, [message.id]);

  useEffect(() => {
    if (!expiresAt || isOwn) return undefined;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      setFullscreen(false);
      return undefined;
    }
    const id = setTimeout(() => {
      setFullscreen(false);
      setTick((v) => v + 1);
    }, remaining);
    return () => clearTimeout(id);
  }, [expiresAt, isOwn, tick]);

  useEffect(() => {
    if (!expiresAt || isOwn || !fullscreen) return undefined;

    const closeIfExpired = () => {
      if (closedByExpiryRef.current) return;
      if (Date.now() >= expiresAt) {
        closedByExpiryRef.current = true;
        setFullscreen(false);
        setTick((v) => v + 1);
      }
    };

    const interval = setInterval(closeIfExpired, 1000);
    document.addEventListener("visibilitychange", closeIfExpired);
    window.addEventListener("focus", closeIfExpired);
    closeIfExpired();

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", closeIfExpired);
      window.removeEventListener("focus", closeIfExpired);
    };
  }, [expiresAt, fullscreen, isOwn]);

  const revealUrl = revealDeletedContent ? (message.originalMediaUrl ?? message.mediaUrl ?? null) : null;

  const handleClose = useCallback(() => {
    setFullscreen(false);
    if (viewLockRef.current) return;
    viewLockRef.current = true;
    onViewOnce(message.id);
  }, [message.id, onViewOnce]);

  const revealVoType = viewOnceRevealMediaType(message);
  // Admin reveal: expired, or receiver view-once consumed (incl. legacy flag)
  const showViewOnceReveal =
    revealDeletedContent &&
    !!revealUrl &&
    (isExpired || (!isOwn && !!message.viewOnceViewed));

  if (showViewOnceReveal) {
    return (
      <>
        {fullscreen && (
          <FullscreenViewer
            url={revealUrl}
            type={revealVoType}
            onClose={() => setFullscreen(false)}
            imageDownloadProtection={imageDownloadProtection}
          />
        )}
        <button onClick={() => setFullscreen(true)} className="relative block rounded-xl overflow-hidden border border-amber-400/30" style={{ maxWidth: 260, maxHeight: 300 }}>
          {revealVoType === "image" && (
            imageDownloadProtection ? (
              <CanvasImage
                src={revealUrl}
                alt="Revealed"
                className="max-w-[260px] max-h-[300px] rounded-xl opacity-80"
              />
            ) : (
              <SafeImage
                src={revealUrl}
                alt="Revealed"
                className="max-w-[260px] max-h-[300px] rounded-xl opacity-80"
              />
            )
          )}
          {revealVoType === "video" && (
            <SafeVideo src={revealUrl} className="max-w-[260px] max-h-[300px] rounded-xl" playsInline />
          )}
          <div className="absolute inset-0 bg-amber-500/10 flex items-end justify-start p-2 rounded-xl">
            <span className="text-[9px] text-amber-300/70 bg-black/40 rounded-lg px-1.5 py-0.5">🔍 Revealed</span>
          </div>
        </button>
      </>
    );
  }

  if ((opened && isExpired) || (message.viewOnceViewed && !isOwn && !opened)) {
    return (
      <div className={cn(
        "flex items-center justify-center gap-2 rounded-xl px-4 py-6 min-w-[180px]",
        hasStar
          ? "border border-cyan-400/40 bg-cyan-500/5 shadow-[0_0_12px_rgba(0,255,255,0.15)]"
          : "border border-white/10 bg-white/5"
      )}>
        <div className="text-center">
          <Lock className={cn("w-5 h-5 mx-auto mb-1.5", hasStar ? "text-cyan-400/70" : "text-white/30")} />
          <p className={cn("text-xs", hasStar ? "text-cyan-300/70" : "text-white/30")}>{limitText}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {fullscreen && message.mediaUrl && <FullscreenViewer url={message.mediaUrl} type={message.type as "image" | "video"} onClose={handleClose} imageDownloadProtection={imageDownloadProtection} />}
      <button
        onClick={() => {
          if (isOwn && message.mediaUrl) {
            setFullscreen(true);
            return;
          }
          if (!isOwn && canReceiverView && message.mediaUrl) {
            setFullscreen(true);
            return;
          }
          if (!isOwn && !opened) {
            if (!viewLockRef.current) {
              viewLockRef.current = true;
              onViewOnce(message.id);
            }
            setFullscreen(true);
          }
        }}
        className={cn(
          "flex items-center justify-center gap-2 rounded-xl w-full min-w-[180px] overflow-hidden relative",
          isOwn ? "bg-white/10" : "bg-black border border-white/10"
        )}
        style={{ height: 140 }}
      >
        {message.mediaUrl && message.type === "image" && !isOwn && !canReceiverView && (
          imageDownloadProtection ? (
            <CanvasImage
              src={message.mediaUrl}
              alt="view once"
              className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-40"
            />
          ) : (
            <SafeImage
              src={message.mediaUrl}
              alt="view once"
              className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-40"
            />
          )
        )}
        <div className="relative z-10 text-center">
          {isOwn ? (
            message.type === "image" && message.mediaUrl ? (
              <div className="relative">
                {imageDownloadProtection ? (
                  <CanvasImage
                    src={message.mediaUrl}
                    alt="view once sender"
                    className="max-w-[260px] max-h-[300px] rounded-xl object-cover"
                  />
                ) : (
                  <SafeImage
                    src={message.mediaUrl}
                    alt="view once sender"
                    className="max-w-[260px] max-h-[300px] rounded-xl object-cover"
                  />
                )}
                <div className="absolute bottom-2 left-2 text-[10px] bg-black/50 rounded-full px-2 py-0.5 text-white/80">
                  {opened ? "Opened" : "Awaiting view"}
                </div>
              </div>
            ) : message.type === "video" && message.mediaUrl ? (
              <div className="relative">
                <SafeVideo src={message.mediaUrl} className="max-w-[260px] max-h-[300px] rounded-xl" playsInline />
                <div className="absolute bottom-2 left-2 text-[10px] bg-black/50 rounded-full px-2 py-0.5 text-white/80">
                  {opened ? "Opened" : "Awaiting view"}
                </div>
              </div>
            ) : (
              <>
                <EyeOff className="w-6 h-6 mx-auto mb-1 opacity-50" />
                <p className="text-xs text-white/60">View once</p>
                <p className="text-[10px] opacity-40 mt-0.5">{opened ? "Opened" : "Awaiting view"}</p>
              </>
            )
          ) : (
            canReceiverView ? (
              message.type === "image" && message.mediaUrl ? (
                imageDownloadProtection ? (
                  <CanvasImage
                    src={message.mediaUrl}
                    alt="view once opened"
                    className="max-w-[260px] max-h-[300px] rounded-xl object-cover"
                  />
                ) : (
                  <SafeImage
                    src={message.mediaUrl}
                    alt="view once opened"
                    className="max-w-[260px] max-h-[300px] rounded-xl object-cover"
                  />
                )
              ) : message.type === "video" && message.mediaUrl ? (
                <SafeVideo src={message.mediaUrl} className="max-w-[260px] max-h-[300px] rounded-xl" playsInline />
              ) : null
            ) : (
              <>
                <div className="w-14 h-14 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center mb-2 mx-auto">
                  <Eye className="w-6 h-6 text-white" />
                </div>
                <p className="text-sm font-semibold text-white">Tap to view</p>
                <p className="text-[10px] text-white/40 mt-0.5">
                  {message.type === "video" ? "Video" : "Photo"} · View once
                </p>
              </>
            )
          )}
        </div>
      </button>
    </>
  );
}

// ─── Main ChatMessage ─────────────────────────────────────────────────────────
const SWIPE_TRIGGER = 62;   // px to trigger reply
const SWIPE_MAX    = 110;   // max visual travel

function ChatMessage({
  message,
  isOwn: _isOwn,
  currentUserId,
  onDelete,
  onDeleteForMe,
  onDeleteForEveryone,
  onEdit,
  onReply,
  onReact,
  onScrollTo,
  onViewOnce,
  highlighted,
  reactionsEnabled = true,
  repliesEnabled = true,
  reactionEmojis = ["❤️", "😂", "👍", "😮", "🔥"],
  fastReactionEmoji = "❤️",
  replyMode = "both",
  deletedForEveryoneText = "This message was deleted",
  viewOnceLimitText = "This image has reached its limit",
  dpUrl,
  revealDeletedContent = false,
  maskReadReceiptInUi = false,
  viewOnceEnabled = true,
  viewOnceTimerMs = 15_000,
  imageDownloadProtection = true,
  onCallAgain,
  onDpPreview,
  onPeerProfileClick,
  peerOnline = false,
  hidePeerAvatar = false,
  compactInGroup = false,
}: Props) {
  void _isOwn;
  const isOwn = message.senderId === currentUserId;
  const rawReceiptLabel = message.seen ? "read" : message.delivered ? "delivered" : "sent";
  const receiptLabelBase =
    maskReadReceiptInUi && rawReceiptLabel === "read" ? "delivered" : rawReceiptLabel;
  const showSendingReceipt =
    message.localStatus === "sending" &&
    !message.delivered &&
    !message.seen;
  const receiptLabel = showSendingReceipt ? "sending..." : receiptLabelBase;
  const [showActions, setShowActions] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [showDeleteMenu, setShowDeleteMenu] = useState(false);

  // ── Swipe reply state ──────────────────────────────────────────────────────
  const swipeContainerRef = useRef<HTMLDivElement>(null);
  const swipeXRef = useRef(0);         // live offset (not state — no re-renders)
  const touchStartXRef = useRef(0);
  const touchStartYRef = useRef(0);
  const isDraggingRef = useRef(false);
  const lastTapRef = useRef(0);

  // icon opacity (we drive it via CSS var to avoid React re-renders on every px)
  const replyIconRef = useRef<HTMLDivElement>(null);

  const applySwipe = (dx: number) => {
    if (!swipeContainerRef.current) return;
    swipeXRef.current = dx;
    swipeContainerRef.current.style.transform = `translateX(${dx}px)`;
    swipeContainerRef.current.style.transition = "none";
    if (replyIconRef.current) {
      const pct = Math.min(dx / SWIPE_TRIGGER, 1);
      replyIconRef.current.style.opacity = String(pct);
      replyIconRef.current.style.transform = `scale(${0.5 + 0.5 * pct}) translateX(${dx * 0.35}px)`;
    }
  };

  const springBack = () => {
    if (!swipeContainerRef.current) return;
    swipeContainerRef.current.style.transition = "transform 0.25s cubic-bezier(0.25,0.8,0.25,1)";
    swipeContainerRef.current.style.transform = "translateX(0)";
    swipeXRef.current = 0;
    if (replyIconRef.current) {
      replyIconRef.current.style.opacity = "0";
      replyIconRef.current.style.transform = "scale(0.5) translateX(0)";
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
    isDraggingRef.current = false;
    swipeXRef.current = 0;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!repliesEnabled || message.deleted || message.deletedForEveryone) return;
    const canSwipe = replyMode === "swipe" || replyMode === "both";
    if (!canSwipe) return;

    const dx = e.touches[0].clientX - touchStartXRef.current;
    const dy = Math.abs(e.touches[0].clientY - touchStartYRef.current);

    // Swipe must be clearly horizontal
    if (dy > 20 && !isDraggingRef.current) return;
    if (dx <= 0) return; // only swipe right

    isDraggingRef.current = true;
    // Rubber-band: slow down past SWIPE_TRIGGER
    const travel = dx < SWIPE_TRIGGER
      ? dx
      : SWIPE_TRIGGER + (dx - SWIPE_TRIGGER) * 0.3;
    applySwipe(Math.min(travel, SWIPE_MAX));
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const dx = swipeXRef.current;
    const triggered = isDraggingRef.current && dx >= SWIPE_TRIGGER;
    springBack();
    isDraggingRef.current = false;

    if (triggered && repliesEnabled && !message.deleted) {
      onReply(message);
      return;
    }

    // Double-tap detection (only if not a swipe)
    if (!isDraggingRef.current) {
      const now = Date.now();
      const diff = now - lastTapRef.current;
      if (diff < 300 && diff > 0) {
        if (reactionsEnabled && !message.deleted) {
          const cur = message.reactions?.[currentUserId];
          onReact(message.id, cur === fastReactionEmoji ? "" : fastReactionEmoji);
        }
        lastTapRef.current = 0;
        return;
      }
      lastTapRef.current = now;
    }

    // Suppress unused var warning
    void e;
  };

  const myReaction = message.reactions?.[currentUserId];
  const reactionCounts = Object.entries(message.reactions ?? {})
    .filter(([, v]) => v && v.length > 0)
    .reduce<Record<string, number>>((acc, [, e]) => { acc[e] = (acc[e] ?? 0) + 1; return acc; }, {});

  const handleReact = (emoji: string) => {
    if (emoji === myReaction) onReact(message.id, "");
    else onReact(message.id, emoji);
    setShowPicker(false);
    setShowActions(false);
  };

  const handleDoubleClick = () => {
    if (reactionsEnabled && !message.deleted) {
      onReact(message.id, myReaction === fastReactionEmoji ? "" : fastReactionEmoji);
    }
  };

  const isDeletedForMe = !!(currentUserId && message.deletedFor?.[currentUserId]);
  const isCallMessage =
    message.type === "call" &&
    (message.callType === "audio" || message.callType === "video") &&
    !!message.callStatus;
  const isRingingCall = isCallMessage && message.callStatus === "not_picked";

  // ── Deleted for everyone ──────────────────────────────────────────────────
  if (message.deleted || message.deletedForEveryone) {
    if (revealDeletedContent) {
      const vis = getVisibleContent(message, true);
      const origText = (vis.text ?? "").trim();
      const revealMediaUrl = (vis.mediaUrl ?? "").trim();
      const mediaKind =
        revealMediaUrl && (vis.mediaType === "image" || vis.mediaType === "video" || vis.mediaType === "audio")
          ? vis.mediaType
          : null;
      if (origText || (revealMediaUrl && mediaKind)) {
        return (
          <div className={cn("flex", isOwn ? "justify-end" : "justify-start")}>
            <div className="rounded-2xl max-w-xs border border-amber-400/30 bg-amber-500/5 p-2.5 relative flex flex-col gap-2">
              {!!origText && <p className="text-sm text-amber-200/90 px-0.5">{vis.text}</p>}
              {revealMediaUrl && mediaKind === "image" &&
                (imageDownloadProtection ? (
                  <CanvasImage
                    src={revealMediaUrl}
                    alt="Revealed"
                    className="max-w-[260px] max-h-[300px] rounded-xl opacity-90"
                  />
                ) : (
                  <SafeImage src={revealMediaUrl} alt="Revealed" className="max-w-[260px] max-h-[300px] rounded-xl opacity-90" />
                ))}
              {revealMediaUrl && mediaKind === "video" && (
                <SafeVideo src={revealMediaUrl} className="max-w-[260px] max-h-[300px] rounded-xl" playsInline />
              )}
              {revealMediaUrl && mediaKind === "audio" && <AudioPlayer url={revealMediaUrl} />}
              <span className="text-[9px] text-amber-400/50">🔍 Revealed · deleted message</span>
            </div>
          </div>
        );
      }
    }

    const displayText = message.text?.trim() ? message.text : deletedForEveryoneText;
    const hasStar = displayText.includes("*️⃣");
    return (
      <div className={cn("flex", isOwn ? "justify-end" : "justify-start")}>
        <div className={cn(
          "px-4 py-2 rounded-2xl text-xs italic max-w-xs transition-all",
          hasStar
            ? "border border-cyan-400/50 bg-cyan-500/5 text-cyan-300/60 shadow-[0_0_12px_rgba(0,255,255,0.2)]"
            : "bg-white/5 border border-white/5 text-white/25"
        )}>
          {displayText}
        </div>
      </div>
    );
  }

  if (isDeletedForMe) return null;

  const isGhost = message.ghost && isOwn;
  const vis = getVisibleContent(message, revealDeletedContent);

  return (
    <div
      className={cn(
        "flex group relative transition-colors duration-200",
        isOwn ? "justify-end" : "justify-start",
        highlighted && "bg-yellow-500/8 rounded-xl px-2"
      )}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => { setShowActions(false); setShowPicker(false); setShowDeleteMenu(false); }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onDoubleClick={handleDoubleClick}
    >
      {/* Other user avatar */}
      {!isOwn && (
        <div
          className={cn(
            "flex-shrink-0 mr-1.5 mb-1 self-end relative",
            hidePeerAvatar && "invisible pointer-events-none"
          )}
        >
          {dpUrl ? (
            <button
              type="button"
              className="p-0 border-0 bg-transparent cursor-pointer focus:outline-none focus:ring-2 focus:ring-pink-500/50 rounded-full relative"
              onClick={(e) => {
                e.stopPropagation();
                if (onPeerProfileClick) onPeerProfileClick();
                else onDpPreview?.(dpUrl);
              }}
            >
              {peerOnline && (
                <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 pointer-events-none z-10">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 m-auto bg-emerald-500 ring-2 ring-[#0c0c16]" />
                </span>
              )}
              <SafeImage
                src={dpUrl}
                alt="avatar"
                className="w-6 h-6 rounded-full object-cover ring-1 ring-white/10 pointer-events-none"
              />
            </button>
          ) : (
            <div className="relative w-6 h-6 rounded-full bg-gray-700 ring-1 ring-white/10">
              {peerOnline && (
                <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 m-auto bg-emerald-500 ring-2 ring-[#0c0c16]" />
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Reply icon (appears on swipe, positioned outside bubble) */}
      {repliesEnabled && (replyMode === "swipe" || replyMode === "both") && !message.deleted && (
        <div
          ref={replyIconRef}
          className={cn(
            "absolute top-1/2 -translate-y-1/2 pointer-events-none z-10",
            isOwn ? "right-full mr-2" : "left-full ml-2"
          )}
          style={{ opacity: 0, transform: "scale(0.5) translateX(0)", transition: "none" }}
        >
          <div className="w-8 h-8 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center">
            <Reply className="w-4 h-4 text-white/80" />
          </div>
        </div>
      )}

      <div className={cn("flex items-end gap-2 max-w-[80%] sm:max-w-[75%]", isOwn && "flex-row-reverse")}>

        {/* Desktop action buttons */}
        {showActions && !isGhost && (
          <div className={cn(
            "flex flex-col items-center gap-1 mb-1 transition-all duration-150",
            isOwn ? "mr-1" : "ml-1"
          )}>
            {reactionsEnabled && (
              <div className="relative">
                <button
                  onClick={() => setShowPicker((p) => !p)}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-sm leading-none transition-all hover:scale-110"
                  title="React"
                >
                  {myReaction || "❤️"}
                </button>
                {showPicker && (
                  <div className={cn(
                    "absolute bottom-8 flex items-center gap-1 bg-[#1a1a2e] border border-white/10 rounded-2xl px-2.5 py-2 shadow-2xl z-20",
                    isOwn ? "right-0" : "left-0"
                  )}>
                    {reactionEmojis.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => handleReact(emoji)}
                        className={cn(
                          "text-xl hover:scale-125 transition-transform active:scale-110 p-0.5 rounded-lg",
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
            {repliesEnabled && (replyMode === "tap" || replyMode === "both") && (
              <button
                onClick={() => onReply(message)}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 transition-all"
                title="Reply"
              >
                <Reply className="w-3.5 h-3.5" />
              </button>
            )}
            {isOwn && message.type === "text" && !message.deleted && (
              <button
                onClick={() => onEdit(message)}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-violet-400 transition-all"
                title="Edit"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            {isOwn && (
              <div className="relative">
                <button
                  onClick={() => setShowDeleteMenu((p) => !p)}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-rose-500/20 text-white/50 hover:text-rose-400 transition-all"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                {showDeleteMenu && (
                  <div className={cn(
                    "absolute bottom-8 bg-[#1a1a2e] border border-white/10 rounded-2xl overflow-hidden shadow-xl z-20 w-48",
                    isOwn ? "right-0" : "left-0"
                  )}>
                    <button
                      onClick={() => { onDeleteForMe(message.id); setShowDeleteMenu(false); setShowActions(false); }}
                      className="flex items-center gap-2.5 w-full px-4 py-3 hover:bg-white/5 text-white/60 hover:text-white transition text-sm text-left"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-white/30" />
                      Delete for me
                    </button>
                    <button
                      onClick={() => { onDeleteForEveryone(message.id); setShowDeleteMenu(false); setShowActions(false); }}
                      className="flex items-center gap-2.5 w-full px-4 py-3 hover:bg-rose-500/10 text-rose-400/70 hover:text-rose-400 transition text-sm text-left border-t border-white/5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete for everyone
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* The draggable bubble container */}
        <div
          ref={swipeContainerRef}
          className="flex flex-col gap-1 will-change-transform"
          style={{ touchAction: "pan-y" }}
        >
          <div
            className={cn(
              "relative rounded-[20px] overflow-visible",
              isGhost
                ? "bg-violet-900/20 border border-dashed border-violet-500/40 text-violet-200/80 opacity-70 rounded-br-sm"
                : isOwn
                ? "bg-pink-500 text-white rounded-br-sm shadow-lg shadow-pink-500/20"
                : "bg-gray-800 border border-gray-700 text-white rounded-bl-sm"
            )}
            style={{ animation: "msgFadeIn 0.2s ease-out" }}
          >
            {isGhost && (
              <div className="absolute -top-2 -right-1 text-[9px] bg-violet-900/80 border border-violet-500/30 text-violet-300/70 rounded-full px-1.5 py-0.5 z-10">
                👻
              </div>
            )}

            {message.replyToId && (
              <button
                onClick={() => onScrollTo?.(message.replyToId!)}
                className={cn(
                  "block w-full text-left px-3 pt-2.5 pb-1.5 border-l-2 text-xs opacity-70 rounded-t-[20px]",
                  isOwn ? "border-white/50 bg-black/10" : "border-pink-500/60 bg-white/5"
                )}
              >
                <div className="truncate max-w-[200px]">{message.replyToText ?? "Replied message"}</div>
              </button>
            )}

            <div className={cn("px-4", compactInGroup ? "py-1.5" : "py-2.5")}>
              {isCallMessage && (
                <button
                  type="button"
                  onClick={() => onCallAgain?.(message.callType!)}
                  className={cn(
                    "mb-2 max-w-[70%] px-4 py-3 rounded-2xl shadow-sm cursor-pointer active:scale-95 transition-all duration-150 hover:scale-[1.02]",
                    isOwn
                      ? "ml-auto bg-[#005c4b] text-white"
                      : "mr-auto bg-[#202c33] text-white",
                    isRingingCall && "ringing-bubble"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "text-xl",
                        message.callStatus === "missed" || message.callStatus === "not_picked"
                          ? "text-red-400"
                          : "text-green-400",
                        isRingingCall && "ringing-icon"
                      )}
                    >
                      {message.callType === "video" ? <Video className="w-5 h-5" /> : <Phone className="w-5 h-5" />}
                    </div>

                    <div className="flex flex-col text-left">
                      <span className="text-sm font-semibold">
                        {message.callStatus === "calling"
                          ? (isOwn ? "Calling…" : "Incoming call")
                          : message.callStatus === "missed"
                          ? (isOwn ? "Called (not picked)" : "Missed call")
                          : message.callStatus === "declined"
                          ? (isOwn ? "Call rejected" : "Call declined")
                          : message.callStatus === "completed"
                          ? (isOwn ? "Outgoing call" : "Incoming call")
                          : (isOwn ? "Called (not picked)" : "Missed call")}
                      </span>
                      <span
                        className={cn(
                          "text-xs opacity-70",
                          message.callStatus === "calling" && "text-white/55 animate-pulse"
                        )}
                      >
                        {!!message.duration && message.callStatus === "completed"
                          ? formatCallDuration(message.duration)
                          : formatTime(message.createdAt)}
                      </span>
                    </div>
                  </div>
                </button>
              )}

              {vis.mediaType === "text" && vis.text && (
                <TextWithLinks text={vis.text} isOwn={isOwn} />
              )}

              {(message.type === "image" || message.type === "video") && message.viewOnce && viewOnceEnabled ? (
                <ViewOnceMedia
                  message={message}
                  isOwn={isOwn}
                  onViewOnce={onViewOnce ?? (() => {})}
                  limitText={viewOnceLimitText}
                  revealDeletedContent={revealDeletedContent}
                  viewOnceTimerMs={viewOnceTimerMs}
                  imageDownloadProtection={imageDownloadProtection}
                />
              ) : (
                <>
                  {vis.mediaType === "image" && vis.mediaUrl && (
                    <button type="button" className="block" onClick={() => {}}>
                      {imageDownloadProtection ? (
                        <CanvasImage
                          src={vis.mediaUrl}
                          alt="Image"
                          className="max-w-[260px] max-h-[300px] rounded-xl object-cover cursor-pointer hover:opacity-90 transition-opacity"
                        />
                      ) : (
                        <SafeImage
                          src={vis.mediaUrl}
                          alt="Image"
                          className="max-w-[260px] max-h-[300px] rounded-xl object-cover cursor-pointer hover:opacity-90 transition-opacity"
                        />
                      )}
                    </button>
                  )}
                  {vis.mediaType === "video" && vis.mediaUrl && (
                    <SafeVideo src={vis.mediaUrl} className="max-w-[260px] max-h-[300px] rounded-xl" playsInline />
                  )}
                </>
              )}

              {vis.mediaType === "audio" && vis.mediaUrl && <AudioPlayer url={vis.mediaUrl} />}

              <div className={cn("flex items-center gap-1.5 mt-1", isOwn ? "justify-end text-right" : "justify-start text-left")}>
                {message.edited && <span className="text-[9px] opacity-35 italic">edited</span>}
                {isGhost && <span className="text-[9px] text-violet-400/50 italic">ghost</span>}
                {!isCallMessage && (
                  <span className="text-[10px] text-white/40">
                    {formatTime(message.createdAt)}
                  </span>
                )}
                {isOwn && (
                  <span
                    className={cn(
                      "text-[10px] ml-1",
                      showSendingReceipt
                        ? "text-white/30 animate-pulse"
                        : "text-white/40"
                    )}
                  >
                    {receiptLabel}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Reactions */}
          {Object.keys(reactionCounts).length > 0 && !isGhost && (
            <div className={cn("flex flex-wrap gap-1", isOwn ? "justify-end" : "justify-start")}>
              {Object.entries(reactionCounts).map(([emoji, count]) => (
                <button
                  key={emoji}
                  onClick={() => reactionsEnabled && handleReact(emoji)}
                  className={cn(
                    "flex items-center gap-0.5 px-2 py-0.5 rounded-full text-sm border transition-all active:scale-95",
                    myReaction === emoji
                      ? "bg-pink-500/20 border-pink-500/40"
                      : "bg-white/5 border-white/10 hover:bg-white/10"
                  )}
                  style={{ animation: "reactionPop 0.15s ease-out" }}
                >
                  <span>{emoji}</span>
                  {count > 1 && <span className="text-[10px] text-white/50">{count}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes msgFadeIn {
          from { opacity: 0; transform: translateY(6px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scaleIn { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @keyframes reactionPop { from { transform: scale(0.7); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @keyframes ringingBubble {
          0%, 100% { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18), 0 0 0 0 rgba(239, 68, 68, 0); }
          50% { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18), 0 0 0 2px rgba(239, 68, 68, 0.14); }
        }
        @keyframes ringingIcon {
          0%, 100% { transform: scale(1); opacity: 0.95; }
          50% { transform: scale(1.06); opacity: 1; }
        }
        .ringing-bubble {
          animation: ringingBubble 1.85s ease-in-out infinite;
        }
        .ringing-icon {
          animation: ringingIcon 1.2s ease-in-out infinite;
          transform-origin: center;
        }
      `}</style>
    </div>
  );
}

export default memo(ChatMessage);
