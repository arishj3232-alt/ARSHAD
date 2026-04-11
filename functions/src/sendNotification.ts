import * as admin from "firebase-admin";

/**
 * Sends a web push via FCM using the token stored at `users/{userId}.fcmToken`.
 * Payload includes `data` for the service worker (actions, deep link) and Android click metadata.
 *
 * All `extra` values must be strings (FCM requirement).
 */
export async function sendCallNotification(
  userId: string,
  title: string,
  body: string,
  extra: Record<string, string> = {}
): Promise<void> {
  const userDoc = await admin.firestore().collection("users").doc(userId).get();
  const token = userDoc.data()?.fcmToken as string | undefined;
  if (!token) return;

  const callId = extra.callId ?? "";
  const callerId = extra.callerId ?? "";
  const roomId = extra.roomId ?? "";
  const callType = extra.callType ?? "audio";

  const fcmData: Record<string, string> = {
    ...extra,
    type: "call",
    action: "incoming_call",
    callId,
    callerId,
    roomId,
    callType,
    click_action: "OPEN_CALL",
  };

  const webpush: admin.messaging.WebpushConfig = {
    notification: {
      title,
      body,
      icon: "/favicon.svg",
    },
  };

  await admin.messaging().send({
    token,
    notification: { title, body },
    data: fcmData,
    android: {
      notification: {
        clickAction: "OPEN_CALL",
      },
    },
    webpush,
  });
}

/** FCM when callee did not answer (timeout or caller hung up while ringing). */
export async function sendMissedCallNotification(
  userId: string,
  title: string,
  body: string,
  extra: Record<string, string> = {}
): Promise<void> {
  const userDoc = await admin.firestore().collection("users").doc(userId).get();
  const token = userDoc.data()?.fcmToken as string | undefined;
  if (!token) return;

  const avatar = extra.callerAvatar ?? "";
  const useAvatarIcon = avatar.startsWith("http");

  const fcmData: Record<string, string> = {
    ...extra,
    type: "missed_call",
  };

  const webpushNotification: admin.messaging.WebpushNotification = {
    title,
    body,
    icon: useAvatarIcon ? avatar : "/favicon.svg",
  };
  if (useAvatarIcon) {
    webpushNotification.image = avatar;
  }

  await admin.messaging().send({
    token,
    notification: { title, body },
    data: fcmData,
    webpush: {
      notification: webpushNotification,
    },
  });
}
