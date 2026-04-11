import * as admin from "firebase-admin";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { getCallerAvatarUrl } from "./callerProfile";
import { sendCallNotification, sendChatNotification, sendMissedCallNotification } from "./sendNotification";

if (!admin.apps.length) {
  admin.initializeApp();
}

function previewChatBody(data: Record<string, unknown>): string {
  const t = (data.type as string) || "text";
  if (t === "image") return "Photo";
  if (t === "video") return "Video";
  if (t === "audio") return "Voice message";
  const text = (data.text as string | undefined)?.trim();
  if (text) {
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  }
  return "New message";
}

/** New chat message → data-only FCM so the web client always receives `onMessage` in the foreground. */
export const onChatMessageCreatedNotifyRecipient = onDocumentCreated(
  "rooms/{roomId}/messages/{messageId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() as Record<string, unknown>;

    if (data.ghost === true) return;
    if (data.deleted === true) return;
    const msgType = (data.type as string) || "text";
    if (msgType === "call") return;

    const senderId = data.senderId as string | undefined;
    if (!senderId) return;

    const roomId = event.params.roomId;
    const presenceSnap = await admin.firestore().collection("rooms").doc(roomId).collection("presence").get();
    const recipientId = presenceSnap.docs.find((d) => d.id !== senderId)?.id;
    if (!recipientId) {
      logger.warn("No recipient in presence for chat push", { roomId, senderId });
      return;
    }

    const senderDoc = presenceSnap.docs.find((d) => d.id === senderId);
    const senderName = (senderDoc?.data()?.name as string)?.trim() || "Someone";
    const title = `New message from ${senderName}`;
    const body = previewChatBody(data);

    try {
      await sendChatNotification(recipientId, title, body);
    } catch (e) {
      logger.error("sendChatNotification failed", e);
    }
  }
);

/**
 * When a caller creates a Firestore call doc, notify the other member of the room
 * (derived from `rooms/{roomId}/presence` — same ids the client uses for WebRTC).
 */
export const onCallCreatedNotifyCallee = onDocumentCreated(
  "rooms/{roomId}/calls/{callId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const data = snap.data();
    if (data.status !== "calling") return;

    const callerId = data.callerId as string | undefined;
    if (!callerId) {
      logger.warn("Call doc missing callerId", { callId: event.params.callId });
      return;
    }

    const roomId = event.params.roomId;
    const presenceSnap = await admin.firestore().collection("rooms").doc(roomId).collection("presence").get();

    const calleeId = presenceSnap.docs.find((d) => d.id !== callerId)?.id;
    if (!calleeId) {
      logger.warn("No callee in presence for incoming call push", { roomId, callerId });
      return;
    }

    const callType = (data.type as string) || "audio";

    const callerDoc = presenceSnap.docs.find((d) => d.id === callerId);
    const callerName = (callerDoc?.data()?.name as string)?.trim() || "Someone";
    const pushTitle = callType === "video" ? "Incoming video call" : "Incoming Call";
    const pushBody = `${callerName} is calling`;

    try {
      await sendCallNotification(calleeId, pushTitle, pushBody, {
        roomId,
        callId: event.params.callId,
        callerId,
        callType,
      });
    } catch (e) {
      logger.error("sendCallNotification failed", e);
    }
  }
);

/**
 * Caller marks the call `missed` (ring timeout or hang-up before answer) → notify callee once.
 * `missedPushSent` prevents duplicate sends if the function retries.
 */
export const onCallMissedNotifyCallee = onDocumentUpdated(
  "rooms/{roomId}/calls/{callId}",
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after) return;
    if (after.status !== "missed") return;
    // No transition → missed (e.g. duplicate writes): do not send again.
    if (after.status === "missed" && before?.status === "missed") return;

    if (after.missedPushSent === true) return;

    const callerId = after.callerId as string | undefined;
    if (!callerId) return;

    const roomId = event.params.roomId;
    const callId = event.params.callId;

    const presenceSnap = await admin.firestore().collection("rooms").doc(roomId).collection("presence").get();
    const calleeId = presenceSnap.docs.find((d) => d.id !== callerId)?.id;
    if (!calleeId) {
      logger.warn("No callee for missed-call push", { roomId, callerId });
      return;
    }

    const callerDoc = presenceSnap.docs.find((d) => d.id === callerId);
    const callerName = (callerDoc?.data()?.name as string)?.trim() || "Someone";
    const callerAvatar = await getCallerAvatarUrl(callerId);
    const title = "Missed Call";
    const body = `Missed call from ${callerName}`;
    const time = String(Date.now());

    const db = admin.firestore();
    try {
      await sendMissedCallNotification(calleeId, title, body, {
        roomId,
        callId,
        callerId,
        callerName,
        callerAvatar,
        time,
      });
    } catch (e) {
      logger.error("sendMissedCallNotification failed", e);
    }

    try {
      await db
        .collection("callLogs")
        .doc(callId)
        .set(
          {
            callerId,
            receiverId: calleeId,
            roomId,
            callId,
            mediaType: (after.type as string) || "audio",
            type: "missed",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
    } catch (logErr) {
      logger.warn("callLogs write failed", logErr);
    }

    try {
      await event.data!.after.ref.update({ missedPushSent: true });
    } catch {
      /* doc may already be deleted */
    }
  }
);
