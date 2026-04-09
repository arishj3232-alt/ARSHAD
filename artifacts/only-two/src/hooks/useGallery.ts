import { useState, useEffect } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Message } from "./useMessages";

export function useGallery(roomId: string) {
  const [mediaMessages, setMediaMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, "rooms", roomId, "messages"),
      where("deleted", "==", false),
      where("type", "in", ["image", "video"]),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      const msgs: Message[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          senderId: data.senderId,
          type: data.type,
          mediaUrl: data.mediaUrl,
          deleted: false,
          seen: data.seen ?? false,
          delivered: data.delivered ?? true,
          createdAt: data.createdAt?.toDate() ?? null,
        } as Message;
      });
      setMediaMessages(msgs);
      setLoading(false);
    });
    return () => unsub();
  }, [roomId]);

  return { mediaMessages, loading };
}
