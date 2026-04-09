import { useState } from "react";
import { X, ZoomIn } from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { Message } from "@/hooks/useMessages";

type Props = {
  mediaMessages: Message[];
  loading: boolean;
  onClose: () => void;
};

export default function GalleryPanel({ mediaMessages, loading, onClose }: Props) {
  const [fullscreen, setFullscreen] = useState<Message | null>(null);

  return (
    <div className="flex flex-col h-full bg-[#0d0d14] border-l border-white/5">
      <div className="p-4 border-b border-white/5 flex items-center gap-2">
        <h3 className="text-white font-semibold flex-1">Media Gallery</h3>
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
          <div className="text-center text-white/30 py-12 text-sm">
            No shared media yet
          </div>
        )}

        <div className="grid grid-cols-3 gap-1.5">
          {mediaMessages.map((msg) => (
            <button
              key={msg.id}
              onClick={() => setFullscreen(msg)}
              className="relative aspect-square rounded-xl overflow-hidden group"
            >
              {msg.type === "image" && msg.mediaUrl ? (
                <img
                  src={msg.mediaUrl}
                  alt=""
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
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
                  <p className="text-white text-[10px]">{formatDate(msg.createdAt)}</p>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {fullscreen && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
          onClick={() => setFullscreen(null)}
        >
          <button
            className="absolute top-4 right-4 p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition"
            onClick={() => setFullscreen(null)}
          >
            <X className="w-5 h-5" />
          </button>
          {fullscreen.type === "image" && fullscreen.mediaUrl ? (
            <img
              src={fullscreen.mediaUrl}
              alt=""
              className="max-w-full max-h-full object-contain rounded-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          ) : fullscreen.type === "video" && fullscreen.mediaUrl ? (
            <video
              src={fullscreen.mediaUrl}
              controls
              className="max-w-full max-h-full rounded-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
