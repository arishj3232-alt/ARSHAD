import { useState, useEffect, useCallback } from "react";
import { ref, onValue, set } from "firebase/database";
import { rtdb } from "@/lib/firebase";

export type ReplyMode = "tap" | "swipe" | "both";

export type AdminSettings = {
  messagingEnabled: boolean;
  repliesEnabled: boolean;
  reactionsEnabled: boolean;
  imageUploadEnabled: boolean;
  videoUploadEnabled: boolean;
  viewOnceEnabled: boolean;
  videoNotesEnabled: boolean;
  voiceMessagesEnabled: boolean;
  voiceCallsEnabled: boolean;
  videoCallsEnabled: boolean;
  typingIndicatorEnabled: boolean;
  lastSeenEnabled: boolean;
  cursorPresenceEnabled: boolean;
  notificationsEnabled: boolean;
  reactionEmojis: string[];
  fastReactionEmoji: string;
  replyMode: ReplyMode;
  deletedText: string;
  viewOnceLimitText: string;
  adminKeyword: string;
  roomCode: string;
};

export const DEFAULT_SETTINGS: AdminSettings = {
  messagingEnabled: true,
  repliesEnabled: true,
  reactionsEnabled: true,
  imageUploadEnabled: true,
  videoUploadEnabled: true,
  viewOnceEnabled: true,
  videoNotesEnabled: true,
  voiceMessagesEnabled: true,
  voiceCallsEnabled: true,
  videoCallsEnabled: true,
  typingIndicatorEnabled: true,
  lastSeenEnabled: true,
  cursorPresenceEnabled: true,
  notificationsEnabled: true,
  reactionEmojis: ["❤️", "😂", "👍", "😮", "🔥"],
  fastReactionEmoji: "❤️",
  replyMode: "both",
  deletedText: "This message was deleted",
  viewOnceLimitText: "This image has reached its limit",
  adminKeyword: "laura",
  roomCode: (import.meta.env.VITE_ROOM_CODE as string) ?? "ArshLovesTanvi",
};

export function useAdmin() {
  const [settings, setSettings] = useState<AdminSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    try {
      const unsub = onValue(
        ref(rtdb, "admin/settings"),
        (snap) => {
          const data = snap.val();
          if (data) {
            setSettings({
              ...DEFAULT_SETTINGS,
              ...data,
              reactionEmojis: Array.isArray(data.reactionEmojis)
                ? data.reactionEmojis
                : DEFAULT_SETTINGS.reactionEmojis,
            });
          }
        },
        () => {}
      );
      return () => unsub();
    } catch {}
  }, []);

  const updateSetting = useCallback(
    async <K extends keyof AdminSettings>(key: K, value: AdminSettings[K]) => {
      const next = { ...settings, [key]: value };
      setSettings(next);
      try {
        await set(ref(rtdb, "admin/settings"), next);
      } catch {}
    },
    [settings]
  );

  return { settings, updateSetting };
}
