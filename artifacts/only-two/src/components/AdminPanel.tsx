import { useState, useEffect } from "react";
import { X, Shield, Smartphone, Lock, Key } from "lucide-react";
import { ref, onValue } from "firebase/database";
import { rtdb } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import type { AdminSettings, ReplyMode } from "@/hooks/useAdmin";

type Props = {
  settings: AdminSettings;
  onUpdate: <K extends keyof AdminSettings>(key: K, value: AdminSettings[K]) => void;
  onClose: () => void;
};

type ToggleRow = { key: keyof AdminSettings; label: string };

const boolGroups: { title: string; rows: ToggleRow[] }[] = [
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
      { key: "viewOnceEnabled", label: "View-once" },
      { key: "videoNotesEnabled", label: "Video notes" },
    ],
  },
  { title: "Voice", rows: [{ key: "voiceMessagesEnabled", label: "Voice messages" }] },
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
      <span
        className={cn(
          "absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all duration-300",
          enabled ? "left-[22px]" : "left-0.5"
        )}
      />
    </button>
  );
}

const REPLY_MODES: { value: ReplyMode; label: string }[] = [
  { value: "tap", label: "Tap button only" },
  { value: "swipe", label: "Swipe only" },
  { value: "both", label: "Both" },
];

const PRESET_EMOJIS = ["❤️", "😂", "👍", "😮", "🔥", "😢", "😡", "🎉", "👀", "💯"];

type DeviceInfo = { browser: string; platform: string; lastActive: number; online: boolean };

function DevicesPanel() {
  const [devices, setDevices] = useState<Record<string, Record<string, DeviceInfo>>>({});

  useEffect(() => {
    try {
      const unsub = onValue(ref(rtdb, "devices"), (snap) => {
        setDevices((snap.val() as typeof devices) ?? {});
      }, () => {});
      return () => unsub();
    } catch {}
  }, []);

  const allDevices = Object.entries(devices).flatMap(([userId, devs]) =>
    Object.entries(devs ?? {}).map(([devId, info]) => ({ userId, devId, ...info }))
  );

  return (
    <div>
      <p className="text-white/30 text-[10px] uppercase tracking-widest mb-2 px-1">Logged-in Devices</p>
      {allDevices.length === 0 ? (
        <div className="bg-white/3 border border-white/8 rounded-2xl px-4 py-8 text-center">
          <Smartphone className="w-6 h-6 text-white/20 mx-auto mb-2" />
          <p className="text-white/30 text-sm">No device data yet</p>
        </div>
      ) : (
        <div className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden divide-y divide-white/5">
          {allDevices.map((d) => (
            <div key={d.devId} className="px-4 py-3">
              <div className="flex items-center gap-2 mb-0.5">
                <div className={cn("w-2 h-2 rounded-full", d.online ? "bg-emerald-400" : "bg-white/20")} />
                <span className="text-white/70 text-sm font-medium">{d.browser}</span>
              </div>
              <p className="text-white/30 text-xs">{d.platform}</p>
              <p className="text-white/20 text-[10px] mt-0.5">
                Last active: {new Date(d.lastActive).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type KeywordField = {
  key: keyof AdminSettings;
  label: string;
  hint: string;
};

const KEYWORD_FIELDS: KeywordField[] = [
  { key: "adminKeyword", label: "Admin Panel", hint: "Opens the admin panel" },
  { key: "revealKeyword", label: "Reveal Mode", hint: "Reveals deleted & view-once content for 8s" },
  { key: "ghostKeyword", label: "Ghost Mode", hint: "Toggles stealth mode (invisible messages)" },
  { key: "readReceiptKeyword", label: "Read Receipts", hint: "Toggles blue ticks on/off" },
];

export default function AdminPanel({ settings, onUpdate, onClose }: Props) {
  const [tab, setTab] = useState<"features" | "keywords" | "reactions" | "texts" | "devices">("features");
  const [emojiInput, setEmojiInput] = useState(settings.reactionEmojis.join(" "));

  const applyEmojis = () => {
    const emojis = emojiInput.trim().split(/\s+/).filter(Boolean);
    if (emojis.length > 0) onUpdate("reactionEmojis", emojis);
  };

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
              {/* Room Code */}
              <div>
                <p className="text-white/30 text-[10px] uppercase tracking-widest mb-2 px-1">Room Code</p>
                <div className="bg-white/3 border border-white/8 rounded-2xl px-4 py-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Lock className="w-3.5 h-3.5 text-white/30" />
                    <p className="text-white/40 text-xs">New users must enter this code. Existing sessions stay active.</p>
                  </div>
                  <input
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-pink-500/50 transition tracking-wider"
                    defaultValue={settings.roomCode}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v) onUpdate("roomCode", v);
                    }}
                  />
                </div>
              </div>

              {boolGroups.map((group) => (
                <div key={group.title}>
                  <p className="text-white/30 text-[10px] uppercase tracking-widest mb-2 px-1">{group.title}</p>
                  <div className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden divide-y divide-white/5">
                    {group.rows.map((row) => (
                      <div key={row.key} className="flex items-center gap-4 px-4 py-3">
                        <span className="flex-1 text-white/70 text-sm">{row.label}</span>
                        <Toggle
                          enabled={settings[row.key] as boolean}
                          onToggle={() => onUpdate(row.key, !(settings[row.key] as boolean))}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <div>
                <p className="text-white/30 text-[10px] uppercase tracking-widest mb-2 px-1">Reply Mode</p>
                <div className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden divide-y divide-white/5">
                  {REPLY_MODES.map((m) => (
                    <button key={m.value} onClick={() => onUpdate("replyMode", m.value)} className="flex items-center gap-4 px-4 py-3 w-full">
                      <span className="flex-1 text-white/70 text-sm text-left">{m.label}</span>
                      <div className={cn(
                        "w-4 h-4 rounded-full border-2 transition-all",
                        settings.replyMode === m.value ? "border-pink-500 bg-pink-500" : "border-white/20"
                      )} />
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
                Type a keyword exactly in the message box — it triggers instantly without sending. Keywords are never shown to the other user.
              </p>

              <div className="space-y-3">
                {KEYWORD_FIELDS.map((field) => (
                  <div key={field.key} className="bg-white/3 border border-white/8 rounded-2xl px-4 py-3">
                    <p className="text-white/60 text-xs font-medium mb-0.5">{field.label}</p>
                    <p className="text-white/25 text-[10px] mb-2">{field.hint}</p>
                    <input
                      key={`${field.key}_${settings[field.key]}`}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-violet-500/50 transition tracking-wider"
                      defaultValue={settings[field.key] as string}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v) onUpdate(field.key, v);
                      }}
                      placeholder="Enter keyword…"
                    />
                  </div>
                ))}
              </div>

              <p className="text-white/15 text-[10px] px-1 mt-4 leading-relaxed">
                All keyword changes sync instantly to both users. Make sure both users know which keywords to use.
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
                      <button
                        key={e}
                        onClick={() => {
                          const next = settings.reactionEmojis.filter((x) => x !== e);
                          if (next.length > 0) { onUpdate("reactionEmojis", next); setEmojiInput(next.join(" ")); }
                        }}
                        className="text-2xl hover:scale-110 transition-transform relative group"
                        title="Click to remove"
                      >
                        {e}
                        <span className="absolute -top-1 -right-1 text-[9px] text-red-400 opacity-0 group-hover:opacity-100 font-bold">✕</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-white/30 text-xs mb-2">Add from presets:</p>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {PRESET_EMOJIS.filter((e) => !settings.reactionEmojis.includes(e)).map((e) => (
                      <button
                        key={e}
                        onClick={() => {
                          const next = [...settings.reactionEmojis, e];
                          onUpdate("reactionEmojis", next);
                          setEmojiInput(next.join(" "));
                        }}
                        className="text-xl hover:scale-110 transition-transform opacity-50 hover:opacity-100"
                      >{e}</button>
                    ))}
                  </div>
                  <p className="text-white/30 text-xs mb-1.5">Custom (space-separated):</p>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-pink-500/50 transition"
                      value={emojiInput}
                      onChange={(e) => setEmojiInput(e.target.value)}
                      placeholder="❤️ 😂 👍"
                    />
                    <button onClick={applyEmojis} className="px-3 py-2 bg-pink-500/20 border border-pink-500/30 text-pink-400 rounded-xl text-sm hover:bg-pink-500/30 transition">
                      Apply
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <p className="text-white/30 text-[10px] uppercase tracking-widest mb-2 px-1">Double-Tap Fast Reaction</p>
                <div className="bg-white/3 border border-white/8 rounded-2xl p-4">
                  <p className="text-white/40 text-xs mb-3">Double-tap or double-click a message to instantly react with:</p>
                  <div className="flex flex-wrap gap-2">
                    {settings.reactionEmojis.map((e) => (
                      <button
                        key={e}
                        onClick={() => onUpdate("fastReactionEmoji", e)}
                        className={cn(
                          "text-2xl rounded-xl p-1.5 transition-all",
                          settings.fastReactionEmoji === e
                            ? "bg-pink-500/20 ring-1 ring-pink-500/50 scale-110"
                            : "hover:scale-110 opacity-60 hover:opacity-100"
                        )}
                      >{e}</button>
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
                  <input
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-pink-500/50 transition"
                    defaultValue={settings.deletedText}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v) onUpdate("deletedText", v); }}
                  />
                </div>
                <div className="px-4 py-3">
                  <p className="text-white/50 text-xs mb-0.5">View-once limit reached text</p>
                  <p className="text-white/25 text-[10px] mb-1.5">Tip: include *️⃣ to apply cyan glow effect</p>
                  <input
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-pink-500/50 transition"
                    defaultValue={settings.viewOnceLimitText}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v) onUpdate("viewOnceLimitText", v); }}
                  />
                </div>
              </div>
              <p className="text-white/20 text-[10px] px-1 mt-3">
                The *️⃣ emoji in deleted/view-once text triggers the cyan premium glow effect on those messages.
              </p>
            </div>
          )}

          {tab === "devices" && <DevicesPanel />}

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
