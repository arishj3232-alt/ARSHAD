import { ref, get } from "firebase/database";
import { rtdb } from "@/lib/firebase";

const ENV_ROOM_CODE = (import.meta.env.VITE_ROOM_CODE as string) ?? "ArshLovesTanvi";

/** Join / entry door code (admin can rotate). */
export async function getAdminRoomCode(): Promise<string> {
  try {
    const snap = await get(ref(rtdb, "admin/settings/roomCode"));
    const code = snap.val() as string | null;
    return code?.trim() || ENV_ROOM_CODE;
  } catch {
    return ENV_ROOM_CODE;
  }
}

/**
 * Single RTDB read for routing.
 * Firestore room id follows the latest door code automatically.
 */
export async function getRoomRouting(): Promise<{ doorCode: string; firestoreRoomId: string }> {
  try {
    const snap = await get(ref(rtdb, "admin/settings"));
    const data = snap.val() as { roomCode?: string } | null;
    const door =
      typeof data?.roomCode === "string" && data.roomCode.trim() ? data.roomCode.trim() : ENV_ROOM_CODE;
    return { doorCode: door, firestoreRoomId: door };
  } catch {
    return { doorCode: ENV_ROOM_CODE, firestoreRoomId: ENV_ROOM_CODE };
  }
}
