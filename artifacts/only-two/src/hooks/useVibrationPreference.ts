import { useState, useCallback, useEffect } from "react";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  getVibrationPreference,
  setVibrationPreference as persistVibration,
  type VibrationPref,
} from "@/lib/vibrationPreference";

export function useVibrationPreference(userId: string | null) {
  const [vibration, setVibration] = useState<VibrationPref>(() => getVibrationPreference());

  useEffect(() => {
    setVibration(getVibrationPreference());
  }, [userId]);

  const toggleVibration = useCallback(() => {
    setVibration((prev) => {
      const next: VibrationPref = prev === "on" ? "off" : "on";
      persistVibration(next);
      if (userId) {
        void setDoc(
          doc(db, "users", userId),
          {
            notificationVibration: next === "on",
            notificationVibrationUpdatedAt: serverTimestamp(),
          },
          { merge: true }
        ).catch(() => {});
      }
      return next;
    });
  }, [userId]);

  return { vibration, toggleVibration };
}
