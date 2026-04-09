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
};

export function useAdmin() {
  const [settings, setSettings] = useState<AdminSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    try {
      const settingsRef = ref(rtdb, "admin/settings");
      const unsub = onValue(
        settingsRef,
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
    } catch {
      // RTDB unavailable
    }
  }, []);

  const updateSetting = useCallback(
    async <K extends keyof AdminSettings>(key: K, value: AdminSettings[K]) => {
      const next = { ...settings, [key]: value };
      setSettings(next);
      try {
        await set(ref(rtdb, "admin/settings"), next);
      } catch {
        // RTDB unavailable
      }
    },
    [settings]
  );

  return { settings, updateSetting };
}
