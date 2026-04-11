import { useState, useEffect, useCallback } from "react";
import { ref, onValue, update } from "firebase/database";
import { rtdb } from "@/lib/firebase";

export type ReplyMode = "tap" | "swipe" | "both";

export type AdminSettings = {
  messagingEnabled: boolean;
  repliesEnabled: boolean;
  reactionsEnabled: boolean;
  imageUploadEnabled: boolean;
  videoUploadEnabled: boolean;
  viewOnceEnabled: boolean;
  viewOnceTimerSeconds: number;
  videoNotesEnabled: boolean;
  videoNoteEnabled: boolean;
  voiceMessagesEnabled: boolean;
  voiceCallsEnabled: boolean;
  videoCallsEnabled: boolean;
  videoCallEnabled: boolean;
  imageDownloadProtection: boolean;
  typingIndicatorEnabled: boolean;
  lastSeenEnabled: boolean;
  cursorPresenceEnabled: boolean;
  notificationsEnabled: boolean;
  allowGhostMode: boolean;
  allowReadReceiptToggle: boolean;
  reactionEmojis: string[];
  fastReactionEmoji: string;
  replyMode: ReplyMode;
  deletedText: string;
  viewOnceLimitText: string;
  adminKeyword: string;
  revealKeyword: string;
  ghostKeyword: string;
  readReceiptKeyword: string;
  roomCode: string;
};

export const DEFAULT_SETTINGS: AdminSettings = {
  messagingEnabled: true,
  repliesEnabled: true,
  reactionsEnabled: true,
  imageUploadEnabled: true,
  videoUploadEnabled: true,
  viewOnceEnabled: true,
  viewOnceTimerSeconds: 15,
  videoNotesEnabled: true,
  videoNoteEnabled: true,
  voiceMessagesEnabled: true,
  voiceCallsEnabled: true,
  videoCallsEnabled: true,
  videoCallEnabled: true,
  imageDownloadProtection: true,
  typingIndicatorEnabled: true,
  lastSeenEnabled: true,
  cursorPresenceEnabled: true,
  notificationsEnabled: true,
  allowGhostMode: true,
  allowReadReceiptToggle: true,
  reactionEmojis: ["❤️", "😂", "👍", "😮", "🔥"],
  fastReactionEmoji: "❤️",
  replyMode: "both",
  deletedText: "This message was deleted",
  viewOnceLimitText: "This image has reached its limit",
  adminKeyword: "laura",
  revealKeyword: "BEN10",
  ghostKeyword: "bhoot",
  readReceiptKeyword: "ONOFF",
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
          if (!data) {
            setSettings(DEFAULT_SETTINGS);
            return;
          }
          const resolvedVideoCallEnabled =
            typeof data.videoCallEnabled === "boolean"
              ? data.videoCallEnabled
              : ((data.videoCallsEnabled as boolean | undefined) ?? DEFAULT_SETTINGS.videoCallEnabled);
          const resolvedVideoNoteEnabled =
            typeof data.videoNoteEnabled === "boolean"
              ? data.videoNoteEnabled
              : ((data.videoNotesEnabled as boolean | undefined) ?? DEFAULT_SETTINGS.videoNoteEnabled);
          const rawTimer = Number(data.viewOnceTimerSeconds);
          const resolvedTimer =
            Number.isFinite(rawTimer) && rawTimer >= 1 && rawTimer <= 300
              ? rawTimer
              : DEFAULT_SETTINGS.viewOnceTimerSeconds;
          setSettings({
            ...DEFAULT_SETTINGS,
            ...data,
            viewOnceTimerSeconds: resolvedTimer,
            videoCallEnabled: resolvedVideoCallEnabled,
            videoCallsEnabled: resolvedVideoCallEnabled,
            videoNoteEnabled: resolvedVideoNoteEnabled,
            videoNotesEnabled: resolvedVideoNoteEnabled,
            reactionEmojis: Array.isArray(data.reactionEmojis)
              ? data.reactionEmojis
              : DEFAULT_SETTINGS.reactionEmojis,
          });
        },
        () => {}
      );
      return () => unsub();
    } catch {
      return undefined;
    }
  }, []);

  const updateSetting = useCallback(
    async <K extends keyof AdminSettings>(key: K, value: AdminSettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
      try {
        if (key === "videoCallEnabled") {
          await update(ref(rtdb, "admin/settings"), { videoCallEnabled: value, videoCallsEnabled: value });
          return;
        }
        if (key === "videoNoteEnabled") {
          await update(ref(rtdb, "admin/settings"), { videoNoteEnabled: value, videoNotesEnabled: value });
          return;
        }
        await update(ref(rtdb, "admin/settings"), { [key]: value });
      } catch {}
    },
    []
  );

  return { settings, updateSetting };
}
