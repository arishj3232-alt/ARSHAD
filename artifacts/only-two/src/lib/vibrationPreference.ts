export type VibrationPref = "on" | "off";

const KEY = "vibration";

export function getVibrationPreference(): VibrationPref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "on" || v === "off") return v;
  } catch {
    /* */
  }
  return "on";
}

export function setVibrationPreference(v: VibrationPref): void {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* */
  }
}
