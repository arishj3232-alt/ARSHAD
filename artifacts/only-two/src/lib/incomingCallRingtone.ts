/** One shared looped ringtone for incoming calls (Firestore + FCM foreground). */
let ringtoneEl: HTMLAudioElement | null = null;

export function stopIncomingCallRingtone() {
  if (ringtoneEl) {
    ringtoneEl.pause();
    ringtoneEl.currentTime = 0;
    ringtoneEl = null;
  }
}

export function startOrContinueIncomingCallRingtone() {
  if (!ringtoneEl) {
    ringtoneEl = new Audio("/ringtone.mp3");
    ringtoneEl.loop = true;
  }
  ringtoneEl.volume = 1;
  if (ringtoneEl.paused) {
    ringtoneEl.currentTime = 0;
    void ringtoneEl.play().catch(() => {});
  }
}
