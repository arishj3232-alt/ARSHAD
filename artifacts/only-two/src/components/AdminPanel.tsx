import { X, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdminSettings } from "@/hooks/useAdmin";

type Props = {
  settings: AdminSettings;
  onUpdate: (key: keyof AdminSettings, value: boolean) => void;
  onClose: () => void;
};

type ToggleRow = {
  key: keyof AdminSettings;
  label: string;
};

const groups: { title: string; rows: ToggleRow[] }[] = [
  {
    title: "Chat",
    rows: [
      { key: "messagingEnabled", label: "Messaging" },
      { key: "repliesEnabled", label: "Replies" },
      { key: "reactionsEnabled", label: "Reactions" },
    ],
  },
  {
    title: "Media",
    rows: [
      { key: "imageUploadEnabled", label: "Image upload" },
      { key: "videoUploadEnabled", label: "Video upload" },
      { key: "viewOnceEnabled", label: "View-once photos/videos" },
      { key: "videoNotesEnabled", label: "Video notes" },
    ],
  },
  {
    title: "Voice",
    rows: [{ key: "voiceMessagesEnabled", label: "Voice messages" }],
  },
  {
    title: "Calls",
    rows: [
      { key: "voiceCallsEnabled", label: "Voice calls" },
      { key: "videoCallsEnabled", label: "Video calls" },
    ],
  },
  {
    title: "Presence",
    rows: [
      { key: "typingIndicatorEnabled", label: "Typing indicator" },
      { key: "lastSeenEnabled", label: "Last seen" },
      { key: "cursorPresenceEnabled", label: "Cursor presence (desktop)" },
    ],
  },
  {
    title: "Notifications",
    rows: [{ key: "notificationsEnabled", label: "Push notifications" }],
  },
];

function Toggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "relative w-11 h-6 rounded-full transition-all duration-300 focus:outline-none flex-shrink-0",
        enabled
          ? "bg-gradient-to-r from-pink-500 to-violet-600"
          : "bg-white/10"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all duration-300",
          enabled ? "left-[22px]" : "left-0.5"
        )}
      />
    </button>
  );
}

export default function AdminPanel({ settings, onUpdate, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-sm sm:max-w-md bg-[#0f0f1a] border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[85vh] flex flex-col animate-slide-up">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5 flex-shrink-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center">
            <Shield className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1">
            <h2 className="text-white font-bold text-sm">Admin Panel</h2>
            <p className="text-white/30 text-xs">Feature controls</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-white/10 text-white/40 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
          {groups.map((group) => (
            <div key={group.title}>
              <p className="text-white/30 text-[10px] uppercase tracking-widest mb-2 px-1">
                {group.title}
              </p>
              <div className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden divide-y divide-white/5">
                {group.rows.map((row) => (
                  <div
                    key={row.key}
                    className="flex items-center gap-4 px-4 py-3"
                  >
                    <span className="flex-1 text-white/70 text-sm">
                      {row.label}
                    </span>
                    <Toggle
                      enabled={settings[row.key]}
                      onToggle={() => onUpdate(row.key, !settings[row.key])}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="h-2" />
        </div>
      </div>

      <style>{`
        @keyframes slide-up {
          from { transform: translateY(40px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .animate-slide-up { animation: slide-up 0.25s ease-out; }
      `}</style>
    </div>
  );
}
