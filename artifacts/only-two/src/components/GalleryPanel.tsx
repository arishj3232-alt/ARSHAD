import { useState, useRef } from "react";
import { X, ZoomIn, ChevronLeft, ChevronRight } from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { Message } from "@/hooks/useMessages";

type Props = {
  mediaMessages: Message[];
  loading: boolean;
  onClose: () => void;
};

export default function GalleryPanel({ mediaMessages, loading, onClose }: Props) {
  const [fullscreenIdx, setFullscreenIdx] = useState<number | null>(null);
  const touchStartX = useRef(0);

  const fullscreen = fullscreenIdx !== null ? mediaMessages[fullscreenIdx] : null;

  const prev = () => {
    if (fullscreenIdx === null) return;
    setFullscreenIdx((i) => (i !== null && i > 0 ? i - 1 : mediaMessages.length - 1));
  };
  const next = () => {
    if (fullscreenIdx === null) return;
    setFullscreenIdx((i) =>
      i !== null ? (i < mediaMessages.length - 1 ? i + 1 : 0) : 0
    );
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 50) {
      dx < 0 ? next() : prev();
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0d0d14] border-l border-white/5">
      <div className="p-4 border-b border-white/5 flex items-center gap-2 flex-shrink-0">
        <h3 className="text-white font-semibold flex-1 text-sm">
          Media Gallery
        </h3>
        <span className="text-white/30 text-xs">
          {mediaMessages.length} items
        </span>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-5 h-5 border-2 border-pink-500/30 border-t-pink-500 rounded-full animate-spin" />
          </div>
        )}
        {!loading && mediaMessages.length === 0 && (
          <div className="text-center text-white/25 py-12 text-sm">
            No shared media yet
          </div>
        )}
        <div className="grid grid-cols-3 gap-1.5">
          {mediaMessages.map((msg, idx) => (
            <button
              key={msg.id}
              onClick={() => setFullscreenIdx(idx)}
              className="relative aspect-square rounded-xl overflow-hidden group"
            >
              {msg.type === "image" && msg.mediaUrl ? (
                <img
                  src={msg.mediaUrl}
                  alt=""
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
              ) : msg.type === "video" && msg.mediaUrl ? (
                <video
                  src={msg.mediaUrl}
                  className="w-full h-full object-cover"
                  muted
                />
              ) : null}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                <ZoomIn className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              {msg.createdAt && (
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <p className="text-white text-[9px]">
                    {formatDate(msg.createdAt)}
                  </p>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {fullscreen && fullscreenIdx !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/97 flex items-center justify-center"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <button
            className="absolute top-4 right-4 p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition z-10"
            onClick={() => setFullscreenIdx(null)}
          >
            <X className="w-5 h-5" />
          </button>

          {mediaMessages.length > 1 && (
            <>
              <button
                onClick={prev}
                className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition z-10"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={next}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition z-10"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}

          <div
            className="max-w-full max-h-full p-4 flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {fullscreen.type === "image" && fullscreen.mediaUrl ? (
              <img
                src={fullscreen.mediaUrl}
                alt=""
                className="max-w-full max-h-[80vh] object-contain rounded-2xl"
              />
            ) : fullscreen.type === "video" && fullscreen.mediaUrl ? (
              <video
                src={fullscreen.mediaUrl}
                controls
                autoPlay
                playsInline
                className="max-w-full max-h-[80vh] rounded-2xl"
              />
            ) : null}
          </div>

          {mediaMessages.length > 1 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-1.5">
              {mediaMessages.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setFullscreenIdx(i)}
                  className={`w-1.5 h-1.5 rounded-full transition-all ${
                    i === fullscreenIdx
                      ? "bg-white w-4"
                      : "bg-white/30"
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
