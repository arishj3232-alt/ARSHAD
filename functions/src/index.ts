import * as admin from "firebase-admin";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { getCallerAvatarUrl } from "./callerProfile";
import { sendCallNotification, sendMissedCallNotification } from "./sendNotification";

if (!admin.apps.length) {
  admin.initializeApp();
}

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

    try {
      const pushTitle = callType === "video" ? "Incoming video call" : "Incoming Call";
      await sendCallNotification(calleeId, pushTitle, "Tap to answer", {
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
