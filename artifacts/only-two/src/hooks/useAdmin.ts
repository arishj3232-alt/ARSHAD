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
  /** Room-wide: show send/read ticks and mark messages seen (synced via RTDB). */
  readReceiptsEnabled: boolean;
  allowReadReceiptToggle: boolean;
  reactionEmojis: string[];
  fastReactionEmoji: string;
  replyMode: ReplyMode;
  deletedText: string;
  viewOnceLimitText: string;
  /** Primary phrases (any casing); runtime uses normalized lists. */
  adminKeywords: string[];
  revealKeywords: string[];
  ghostKeywords: string[];
  readReceiptKeywords: string[];
  /** Synced to first entry for legacy RTDB readers. */
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
  readReceiptsEnabled: true,
  allowReadReceiptToggle: true,
  reactionEmojis: ["❤️", "😂", "👍", "😮", "🔥"],
  fastReactionEmoji: "❤️",
  replyMode: "both",
  deletedText: "This message was deleted",
  viewOnceLimitText: "This image has reached its limit",
  adminKeywords: ["laura"],
  revealKeywords: ["BEN10"],
  ghostKeywords: ["bhoot"],
  readReceiptKeywords: ["ONOFF"],
  adminKeyword: "laura",
  revealKeyword: "BEN10",
  ghostKeyword: "bhoot",
  readReceiptKeyword: "ONOFF",
  roomCode: (import.meta.env.VITE_ROOM_CODE as string) ?? "ArshLovesTanvi",
};

function parseKeywordArray(
  data: Record<string, unknown>,
  pluralKey: string,
  singularKey: string,
  fallbacks: string[]
): string[] {
  const raw = data[pluralKey];
  if (Array.isArray(raw) && raw.length > 0) {
    const next = [...new Set(raw.map(String).map((s) => s.trim()).filter(Boolean))];
    if (next.length > 0) return next;
  }
  const one = data[singularKey];
  if (typeof one === "string" && one.trim()) return [one.trim()];
  return [...fallbacks];
}

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
          const readReceipts =
            typeof data.readReceiptsEnabled === "boolean"
              ? data.readReceiptsEnabled
              : DEFAULT_SETTINGS.readReceiptsEnabled;
          const d = data as Record<string, unknown>;
          const adminKeywords = parseKeywordArray(d, "adminKeywords", "adminKeyword", DEFAULT_SETTINGS.adminKeywords);
          const revealKeywords = parseKeywordArray(d, "revealKeywords", "revealKeyword", DEFAULT_SETTINGS.revealKeywords);
          const ghostKeywords = parseKeywordArray(d, "ghostKeywords", "ghostKeyword", DEFAULT_SETTINGS.ghostKeywords);
          const readReceiptKeywords = parseKeywordArray(
            d,
            "readReceiptKeywords",
            "readReceiptKeyword",
            DEFAULT_SETTINGS.readReceiptKeywords
          );
          setSettings({
            ...DEFAULT_SETTINGS,
            ...data,
            readReceiptsEnabled: readReceipts,
            viewOnceTimerSeconds: resolvedTimer,
            videoCallEnabled: resolvedVideoCallEnabled,
            videoCallsEnabled: resolvedVideoCallEnabled,
            videoNoteEnabled: resolvedVideoNoteEnabled,
            videoNotesEnabled: resolvedVideoNoteEnabled,
            reactionEmojis: Array.isArray(data.reactionEmojis)
              ? data.reactionEmojis
              : DEFAULT_SETTINGS.reactionEmojis,
            adminKeywords,
            revealKeywords,
            ghostKeywords,
            readReceiptKeywords,
            adminKeyword: adminKeywords[0] ?? DEFAULT_SETTINGS.adminKeyword,
            revealKeyword: revealKeywords[0] ?? DEFAULT_SETTINGS.revealKeyword,
            ghostKeyword: ghostKeywords[0] ?? DEFAULT_SETTINGS.ghostKeyword,
            readReceiptKeyword: readReceiptKeywords[0] ?? DEFAULT_SETTINGS.readReceiptKeyword,
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
        if (key === "adminKeywords") {
          const arr = value as string[];
          await update(ref(rtdb, "admin/settings"), {
            adminKeywords: arr,
            adminKeyword: arr[0] ?? "",
          });
          return;
        }
        if (key === "revealKeywords") {
          const arr = value as string[];
          await update(ref(rtdb, "admin/settings"), {
            revealKeywords: arr,
            revealKeyword: arr[0] ?? "",
          });
          return;
        }
        if (key === "ghostKeywords") {
          const arr = value as string[];
          await update(ref(rtdb, "admin/settings"), {
            ghostKeywords: arr,
            ghostKeyword: arr[0] ?? "",
          });
          return;
        }
        if (key === "readReceiptKeywords") {
          const arr = value as string[];
          await update(ref(rtdb, "admin/settings"), {
            readReceiptKeywords: arr,
            readReceiptKeyword: arr[0] ?? "",
          });
          return;
        }
        await update(ref(rtdb, "admin/settings"), { [key]: value });
      } catch {}
    },
    []
  );

  return { settings, updateSetting };
}
