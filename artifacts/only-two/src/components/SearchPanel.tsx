import { useState, useMemo } from "react";
import { Search, X } from "lucide-react";
import { formatTime, formatDate } from "@/lib/utils";
import type { Message } from "@/hooks/useMessages";

type Props = {
  messages: Message[];
  onScrollTo: (id: string) => void;
  onClose: () => void;
  currentUserId: string;
  otherName: string;
};

function Highlighted({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-400/30 text-yellow-200 rounded px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export default function SearchPanel({
  messages,
  onScrollTo,
  onClose,
  currentUserId,
  otherName,
}: Props) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return messages.filter(
      (m) => !m.deleted && m.type === "text" && m.text?.toLowerCase().includes(q)
    );
  }, [query, messages]);

  return (
    <div className="flex flex-col h-full bg-[#0d0d14] border-l border-white/5">
      <div className="p-4 border-b border-white/5">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-white font-semibold flex-1">Search Messages</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input
            autoFocus
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-white placeholder-white/20 focus:outline-none focus:border-pink-500/50 text-sm transition"
            placeholder="Search messages…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="input-search"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {query.trim() && results.length === 0 && (
          <div className="text-center text-white/30 py-8 text-sm">No messages found</div>
        )}
        {results.map((msg) => (
          <button
            key={msg.id}
            onClick={() => { onScrollTo(msg.id); onClose(); }}
            className="w-full text-left px-4 py-3 hover:bg-white/5 transition-colors border-b border-white/5"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-white/40 font-medium">
                {msg.senderId === currentUserId ? "You" : otherName}
              </span>
              <span className="text-[10px] text-white/25">
                {msg.createdAt ? `${formatDate(msg.createdAt)} ${formatTime(msg.createdAt)}` : ""}
              </span>
            </div>
            <p className="text-sm text-white/70 line-clamp-2 leading-snug">
              <Highlighted text={msg.text ?? "[media]"} query={query.trim()} />
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
