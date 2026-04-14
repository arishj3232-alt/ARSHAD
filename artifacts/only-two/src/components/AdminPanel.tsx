import { useState, useEffect } from "react";
import { X, Shield, Smartphone, Lock, Key, LogOut } from "lucide-react";
import { ref, onValue, set } from "firebase/database";
import { rtdb } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import type { AdminSettings, ReplyMode } from "@/hooks/useAdmin";
import { offKeywordToken } from "@/lib/chatKeywords";

type Props = {
  settings: AdminSettings;
  onUpdate: <K extends keyof AdminSettings>(key: K, value: AdminSettings[K]) => void;
  onClose: () => void;
  currentUserId?: string;
  roomCode?: string;
};

type ToggleRow = { key: keyof AdminSettings; label: string };

const boolGroups: { title: string; rows: ToggleRow[] }[] = [
  {
    title: "Chat",
    rows: [
      { key: "messagingEnabled", label: "Messaging" },
      { key: "readReceiptsEnabled", label: "Read receipts (room)" },
      { key: "repliesEnabled", label: "Replies" },
      { key: "reactionsEnabled", label: "Reactions" },
      { key: "keepChatHistoryOnRoomCodeChange", label: "Keep chat history when room code changes" },
    ],
  },
  {
    title: "Media",
    rows: [
      { key: "imageUploadEnabled", label: "Image upload" },
      { key: "videoUploadEnabled", label: "Video upload" },
      { key: "viewOnceEnabled", label: "View-once" },
      { key: "videoNoteEnabled", label: "Video notes" },
      { key: "imageDownloadProtection", label: "Image download protection" },
    ],
  },
  { title: "Voice", rows: [{ key: "voiceMessagesEnabled", label: "Voice messages" }] },
  {
    title: "Calls",
    rows: [
      { key: "voiceCallsEnabled", label: "Voice calls" },
      { key: "videoCallEnabled", label: "Video calls" },
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
  { title: "Notifications", rows: [{ key: "notificationsEnabled", label: "Push notifications" }] },
  {
    title: "Secret Features Access",
    rows: [
      { key: "allowGhostMode", label: "Allow Ghost Mode (👻 keyword)" },
      { key: "allowReadReceiptToggle", label: "Allow Read Receipt Toggle" },
    ],
  },
];

function Toggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "relative w-11 h-6 rounded-full transition-all duration-300 focus:outline-none flex-shrink-0",
        enabled ? "bg-gradient-to-r from-pink-500 to-violet-600" : "bg-white/10"
      )}
    >
      <span className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all duration-300", enabled ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

const REPLY_MODES: { value: ReplyMode; label: string }[] = [
  { value: "tap", label: "Tap button only" },
  { value: "swipe", label: "Swipe only" },
  { value: "both", label: "Both" },
];

const PRESET_EMOJIS = ["❤️", "😂", "👍", "😮", "🔥", "😢", "😡", "🎉", "👀", "💯"];

type DeviceInfo = { browser: string; platform: string; lastActive: number; online: boolean; userId?: string };

function DevicesPanel({ currentUserId, roomCode }: { currentUserId?: string; roomCode?: string }) {
  const [devices, setDevices] = useState<Record<string, Record<string, DeviceInfo>>>({});
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    if (!roomCode) return undefined;
    try {
      const unsub = onValue(ref(rtdb, `devices/${roomCode}`), (snap) => {
        setDevices((snap.val() as typeof devices) ?? {});
      }, () => {});
      return () => unsub();
    } catch {
      return undefined;
    }
  }, [roomCode]);

  const forceLogout = async (targetUserId: string) => {
    if (targetUserId === currentUserId) return; // can't kick yourself
    if (!roomCode) return;
    setRemoving(targetUserId);
    try {
      await set(ref(rtdb, `forceLogout/${roomCode}/${targetUserId}`), true);
      // Remove their device entries
      await set(ref(rtdb, `devices/${roomCode}/${targetUserId}`), null);
    } catch {}
    setTimeout(() => setRemoving(null), 1500);
  };

  const allUsers = Object.entries(devices);

  return (
    <div>
      <p className="text-white/30 text-[10px] uppercase tracking-widest mb-2 px-1">Logged-in Devices</p>
      {allUsers.length === 0 ? (
        <div className="bg-white/3 border border-white/8 rounded-2xl px-4 py-8 text-center">
          <Smartphone className="w-6 h-6 text-white/20 mx-auto mb-2" />
          <p className="text-white/30 text-sm">No device data yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {allUsers.map(([uid, devs]) => {
            const devList = Object.entries(devs ?? {});
            const isYou = uid === currentUserId;
            return (
              <div key={uid} className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center">
                      <span className="text-[9px] text-white font-bold">U</span>
                    </div>
                    <span className="text-white/50 text-xs font-mono">{uid.slice(0, 18)}…</span>
                    {isYou && <span className="text-[10px] text-pink-400/70 bg-pink-500/10 rounded-full px-1.5 py-0.5">you</span>}
                  </div>
                  {!isYou && (
                    <button
                      onClick={() => forceLogout(uid)}
                      disabled={removing === uid}
                      className="flex items-center gap-1.5 text-[11px] text-rose-400/70 hover:text-rose-400 transition px-2 py-1 rounded-lg hover:bg-rose-500/10 disabled:opacity-50"
                    >
                      <LogOut className="w-3 h-3" />
                      {removing === uid ? "Removing…" : "Remove"}
                    </button>
                  )}
                </div>
                <div className="divide-y divide-white/5">
                  {devList.map(([devId, info]) => (
                    <div key={devId} className="px-4 py-2.5">
                      <div className="flex items-center gap-2 mb-0.5">
                        <div className={cn("w-1.5 h-1.5 rounded-full", info.online ? "bg-emerald-400" : "bg-white/20")} />
                        <span className="text-white/60 text-sm">{info.browser}</span>
                      </div>
                      <p className="text-white/30 text-xs">{info.platform}</p>
                      <p className="text-white/20 text-[10px] mt-0.5">Last active: {new Date(info.lastActive).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type KeywordField = { key: keyof AdminSettings; label: string; hint: string; offPattern?: string };

export default function AdminPanel({ settings, onUpdate, onClose, currentUserId, roomCode }: Props) {
  const [tab, setTab] = useState<"features" | "keywords" | "reactions" | "texts" | "devices">("features");
  const [emojiInput, setEmojiInput] = useState(settings.reactionEmojis.join(" "));

  const applyEmojis = () => {
    const emojis = emojiInput.trim().split(/\s+/).filter(Boolean);
    if (emojis.length > 0) onUpdate("reactionEmojis", emojis);
  };

  const offHints = (keywords: string[]) =>
    keywords.length ? keywords.map((k) => offKeywordToken(k)).join(", ") : "—";

  const keywordFields: KeywordField[] = [
    {
      key: "adminKeywords",
      label: "Admin panel",
      hint: "Comma-separated · case-insensitive · never sent as chat",
    },
    {
      key: "revealKeywords",
      label: "Reveal mode (admin on)",
      hint: `Off tokens: ${offHints(settings.revealKeywords)}`,
    },
    {
      key: "ghostKeywords",
      label: "Ghost mode",
      hint: `Off tokens: ${offHints(settings.ghostKeywords)}`,
    },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm sm:max-w-md bg-[#0f0f1a] border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[90vh] flex flex-col animate-slide-up">

        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5 flex-shrink-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center">
            <Shield className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1">
            <h2 className="text-white font-bold text-sm">Admin Panel</h2>
            <p className="text-white/30 text-xs">Live sync · Both users affected instantly</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-white/10 text-white/40 hover:text-white transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex border-b border-white/5 flex-shrink-0 overflow-x-auto">
          {(["features", "keywords", "reactions", "texts", "devices"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "flex-1 py-2.5 text-[11px] font-medium capitalize transition whitespace-nowrap px-2",
                tab === t ? "text-pink-400 border-b-2 border-pink-500" : "text-white/30 hover:text-white/60"
              )}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">

          {tab === "features" && (
            <>
              <div>
                <p className="text-white/30 text-[10px] uppercase tracking-widest mb-2 px-1">Room Code</p>
                <div className="bg-white/3 border border-white/8 rounded-2xl px-4 py-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Lock className="w-3.5 h-3.5 text-white/30" />
                    <p className="text-white/40 text-xs">New users must enter this code.</p>
                  </div>
                  <input
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-pink-500/50 transition tracking-wider"
                    defaultValue={settings.roomCode}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v) onUpdate("roomCode", v); }}
                  />
                  <p className="text-white/35 text-[11px] mt-2 leading-relaxed">
                    Storage id currently
                    {settings.chatSpaceId?.trim() ? (
                      <span className="text-white/50 font-mono"> {settings.chatSpaceId.trim()}</span>
                    ) : (
                      <span className="text-white/50"> (same as this code until first save)</span>
                    )}
                    . Room-code changes follow the "Keep chat history" toggle below.
                  </p>
                </div>
              </div>

              {boolGroups.map((group) => (
                <div key={group.title}>
                  <p className="text-white/30 text-[10px] uppercase tracking-widest mb-2 px-1">{group.title}</p>
                  <div className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden divide-y divide-white/5">
                    {group.rows.map((row) => (
                      <div key={row.key} className="flex items-center gap-4 px-4 py-3">
                        <span className="flex-1 text-white/70 text-sm">{row.label}</span>
                        <Toggle enabled={settings[row.key] as boolean} onToggle={() => onUpdate(row.key, !(settings[row.key] as boolean))} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <div>
                <p className="text-white/30 text-[10px] uppercase tracking-widest mb-2 px-1">View-once Timer</p>
                <div className="bg-white/3 border border-white/8 rounded-2xl px-4 py-3">
                  <p className="text-white/40 text-xs mb-1.5">Seconds (1 - 300), applies live</p>
                  <input
                    type="number"
                    min={1}
                    max={300}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-pink-500/50 transition"
                    value={settings.viewOnceTimerSeconds}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isFinite(n)) return;
                      const clamped = Math.min(300, Math.max(1, Math.floor(n)));
                      onUpdate("viewOnceTimerSeconds", clamped);
                    }}
                  />
                </div>
              </div>

              <div>
                <p className="text-white/30 text-[10px] uppercase tracking-widest mb-2 px-1">Reply Mode</p>
                <div className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden divide-y divide-white/5">
                  {REPLY_MODES.map((m) => (
                    <button key={m.value} onClick={() => onUpdate("replyMode", m.value)} className="flex items-center gap-4 px-4 py-3 w-full">
                      <span className="flex-1 text-white/70 text-sm text-left">{m.label}</span>
                      <div className={cn("w-4 h-4 rounded-full border-2 transition-all", settings.replyMode === m.value ? "border-pink-500 bg-pink-500" : "border-white/20")} />
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === "keywords" && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Key className="w-4 h-4 text-violet-400" />
                <p className="text-white/60 text-sm font-medium">Secret Keywords</p>
              </div>
              <p className="text-white/25 text-xs mb-4 leading-relaxed px-1">
                Comma-separated keywords — case-insensitive, normalized at runtime. Off-keywords: &quot;off&quot; + first 2 letters of each primary (e.g. BEN10 → offbe).
              </p>
              <div className="space-y-3">
                {keywordFields.map((field) => {
                  const arr = settings[field.key] as string[];
                  const joined = Array.isArray(arr) ? arr.join(", ") : "";
                  return (
                    <div key={field.key} className="bg-white/3 border border-white/8 rounded-2xl px-4 py-3">
                      <p className="text-white/60 text-xs font-medium mb-0.5">{field.label}</p>
                      <p className="text-white/25 text-[10px] mb-2">{field.hint}</p>
                      <input
                        key={`${field.key}_${joined}`}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-violet-500/50 transition tracking-wider"
                        defaultValue={joined}
                        onBlur={(e) => {
                          const parts = e.target.value
                            .split(/[,\n]+/)
                            .map((s) => s.trim())
                            .filter(Boolean);
                          if (parts.length > 0) onUpdate(field.key, parts);
                        }}
                        placeholder="keyword1, keyword2…"
                      />
                    </div>
                  );
                })}
              </div>
              <p className="text-white/15 text-[10px] px-1 mt-4 leading-relaxed">
                Keywords are never shown in chat, never sent as messages. All changes sync instantly.
              </p>
            </div>
          )}

          {tab === "reactions" && (
            <>
              <div>
                <p className="text-white/30 text-[10px] uppercase tracking-widest mb-2 px-1">Active Reaction Emojis</p>
                <div className="bg-white/3 border border-white/8 rounded-2xl p-4">
                  <div className="flex flex-wrap gap-2 mb-3 min-h-[2.5rem]">
                    {settings.reactionEmojis.map((e) => (
                      <button key={e} onClick={() => { const next = settings.reactionEmojis.filter((x) => x !== e); if (next.length > 0) { onUpdate("reactionEmojis", next); setEmojiInput(next.join(" ")); } }} className="text-2xl hover:scale-110 transition-transform relative group" title="Click to remove">
                        {e}
                        <span className="absolute -top-1 -right-1 text-[9px] text-red-400 opacity-0 group-hover:opacity-100 font-bold">✕</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-white/30 text-xs mb-2">Add from presets:</p>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {PRESET_EMOJIS.filter((e) => !settings.reactionEmojis.includes(e)).map((e) => (
                      <button key={e} onClick={() => { const next = [...settings.reactionEmojis, e]; onUpdate("reactionEmojis", next); setEmojiInput(next.join(" ")); }} className="text-xl hover:scale-110 transition-transform opacity-50 hover:opacity-100">{e}</button>
                    ))}
                  </div>
                  <p className="text-white/30 text-xs mb-1.5">Custom (space-separated):</p>
                  <div className="flex gap-2">
                    <input className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-pink-500/50 transition" value={emojiInput} onChange={(e) => setEmojiInput(e.target.value)} placeholder="❤️ 😂 👍" />
                    <button onClick={applyEmojis} className="px-3 py-2 bg-pink-500/20 border border-pink-500/30 text-pink-400 rounded-xl text-sm hover:bg-pink-500/30 transition">Apply</button>
                  </div>
                </div>
              </div>
              <div>
                <p className="text-white/30 text-[10px] uppercase tracking-widest mb-2 px-1">Double-Tap Fast Reaction</p>
                <div className="bg-white/3 border border-white/8 rounded-2xl p-4">
                  <p className="text-white/40 text-xs mb-3">Double-tap or double-click a message to instantly react with:</p>
                  <div className="flex flex-wrap gap-2">
                    {settings.reactionEmojis.map((e) => (
                      <button key={e} onClick={() => onUpdate("fastReactionEmoji", e)} className={cn("text-2xl rounded-xl p-1.5 transition-all", settings.fastReactionEmoji === e ? "bg-pink-500/20 ring-1 ring-pink-500/50 scale-110" : "hover:scale-110 opacity-60 hover:opacity-100")}>{e}</button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {tab === "texts" && (
            <div>
              <p className="text-white/30 text-[10px] uppercase tracking-widest mb-2 px-1">Custom UI Text</p>
              <div className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden divide-y divide-white/5">
                <div className="px-4 py-3">
                  <p className="text-white/50 text-xs mb-0.5">Deleted for everyone text</p>
                  <p className="text-white/25 text-[10px] mb-1.5">Tip: include *️⃣ to apply cyan glow effect</p>
                  <input className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-pink-500/50 transition" defaultValue={settings.deletedText} onBlur={(e) => { const v = e.target.value.trim(); if (v) onUpdate("deletedText", v); }} />
                </div>
                <div className="px-4 py-3">
                  <p className="text-white/50 text-xs mb-0.5">View-once limit reached text</p>
                  <p className="text-white/25 text-[10px] mb-1.5">Tip: include *️⃣ to apply cyan glow effect</p>
                  <input className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-pink-500/50 transition" defaultValue={settings.viewOnceLimitText} onBlur={(e) => { const v = e.target.value.trim(); if (v) onUpdate("viewOnceLimitText", v); }} />
                </div>
              </div>
              <p className="text-white/20 text-[10px] px-1 mt-3">The *️⃣ emoji in deleted/view-once text triggers the cyan premium glow effect.</p>
            </div>
          )}

          {tab === "devices" && <DevicesPanel currentUserId={currentUserId} roomCode={roomCode} />}

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
