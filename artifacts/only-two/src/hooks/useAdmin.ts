import { useState, useEffect, useCallback } from "react";
import { ref, onValue, set } from "firebase/database";
import { rtdb } from "@/lib/firebase";

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
          if (data) setSettings({ ...DEFAULT_SETTINGS, ...data });
        },
        () => {}
      );
      return () => unsub();
    } catch {
      // RTDB unavailable — use defaults
    }
  }, []);

  const updateSetting = useCallback(
    async (key: keyof AdminSettings, value: boolean) => {
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
