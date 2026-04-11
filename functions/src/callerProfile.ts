import { getDatabase } from "firebase-admin/database";

/** Display picture URL from RTDB `profiles/{userId}.dpUrl` (same as OnlyTwo client). */
export async function getCallerAvatarUrl(callerId: string): Promise<string> {
  try {
    const snap = await getDatabase().ref(`profiles/${callerId}`).once("value");
    const v = snap.val() as { dpUrl?: string } | null;
    const url = v?.dpUrl;
    return typeof url === "string" && url.length > 0 ? url : "";
  } catch {
    return "";
  }
}
