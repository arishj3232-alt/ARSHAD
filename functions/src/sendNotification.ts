import * as admin from "firebase-admin";

/** Chat: data-only so web `onMessage` always fires in foreground (no top-level `notification`). */
export async function sendChatNotification(
  userId: string,
  title: string,
  body: string
): Promise<void> {
  const userDoc = await admin.firestore().collection("users").doc(userId).get();
  const u = userDoc.data();
  const token = u?.fcmToken as string | undefined;
  if (!token) return;

  const vibrOn = u?.notificationVibration === true;
  const vibration = vibrOn ? "on" : "off";

  await admin.messaging().send({
    token,
    data: {
      title: String(title || "New Message"),
      body: String(body || ""),
      type: "chat",
      vibration,
    },
    android: {
      priority: "high",
    },
  });
}

/** Incoming call: `notification` + `data` (strings only in data). */
export async function sendCallNotification(
  userId: string,
  title: string,
  body: string,
  extra: Record<string, string> = {}
): Promise<void> {
  const userDoc = await admin.firestore().collection("users").doc(userId).get();
  const u = userDoc.data();
  const token = u?.fcmToken as string | undefined;
  if (!token) return;

  const vibrOn = u?.notificationVibration === true;
  const vibration = vibrOn ? "on" : "off";

  const callId = extra.callId ?? "";
  const callerId = extra.callerId ?? "";
  const roomId = extra.roomId ?? "";
  const callType = extra.callType ?? "audio";

  const safeTitle = title?.trim() ? title : "Incoming Call";
  const safeBody = body ?? "";

  const fcmData: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(extra).map(([k, v]) => [k, typeof v === "string" ? v : String(v ?? "")])
    ),
    title: String(safeTitle),
    body: String(safeBody),
    type: "call",
    action: "incoming_call",
    callId: String(callId),
    callerId: String(callerId),
    roomId: String(roomId),
    callType: String(callType),
    click_action: "OPEN_CALL",
    vibration,
  };

  await admin.messaging().send({
    token,
    notification: {
      title: safeTitle,
      body: safeBody,
    },
    data: fcmData,
    android: {
      priority: "high",
      notification: {
        clickAction: "OPEN_CALL",
      },
    },
    webpush: {
      notification: {
        title: safeTitle,
        body: safeBody,
        icon: "/favicon.svg",
      },
    },
  });
}

/** Missed call: `notification` + `data`. */
export async function sendMissedCallNotification(
  userId: string,
  title: string,
  body: string,
  extra: Record<string, string> = {}
): Promise<void> {
  const userDoc = await admin.firestore().collection("users").doc(userId).get();
  const u = userDoc.data();
  const token = u?.fcmToken as string | undefined;
  if (!token) return;

  const vibrOn = u?.notificationVibration === true;
  const vibration = vibrOn ? "on" : "off";

  const avatar = extra.callerAvatar ?? "";
  const useAvatarIcon = avatar.startsWith("http");

  const safeTitle = title?.trim() ? title : "Notification";
  const safeBody = body ?? "";

  const fcmData: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(extra).map(([k, v]) => [k, typeof v === "string" ? v : String(v ?? "")])
    ),
    title: String(safeTitle),
    body: String(safeBody),
    type: "missed_call",
    vibration,
  };

  const webpushNotification: admin.messaging.WebpushNotification = {
    title: safeTitle,
    body: safeBody,
    icon: useAvatarIcon ? avatar : "/favicon.svg",
  };
  if (useAvatarIcon) {
    webpushNotification.image = avatar;
  }

  await admin.messaging().send({
    token,
    notification: {
      title: safeTitle,
      body: safeBody,
    },
    data: fcmData,
    android: { priority: "high" },
    webpush: {
      notification: webpushNotification,
    },
  });
}
