import { useState, useEffect, useCallback, useRef } from "react";
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  startAfter,
  getDocs,
  where,
  DocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export type MessageType = "text" | "image" | "video" | "audio";

export type Message = {
  id: string;
  senderId: string;
  type: MessageType;
  text?: string;
  mediaUrl?: string;
  replyToId?: string;
  replyToText?: string;
  deleted: boolean;
  seen: boolean;
  delivered: boolean;
  createdAt: Date | null;
};

const PAGE_SIZE = 20;

export function useMessages(roomId: string, currentUserId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const oldestDocRef = useRef<DocumentSnapshot | null>(null);

  useEffect(() => {
    if (!roomId) return;
    const q = query(
      collection(db, "rooms", roomId, "messages"),
      orderBy("createdAt", "desc"),
      limit(PAGE_SIZE)
    );
    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs;
      if (docs.length > 0) {
        oldestDocRef.current = docs[docs.length - 1];
      }
      const msgs: Message[] = docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            senderId: data.senderId,
            type: data.type ?? "text",
            text: data.text,
            mediaUrl: data.mediaUrl,
            replyToId: data.replyToId,
            replyToText: data.replyToText,
            deleted: data.deleted ?? false,
            seen: data.seen ?? false,
            delivered: data.delivered ?? false,
            createdAt: data.createdAt?.toDate() ?? null,
          } as Message;
        })
        .reverse();
      setMessages(msgs);
      setLoading(false);
      setHasMore(docs.length === PAGE_SIZE);
    });
    return () => unsub();
  }, [roomId]);

  const loadMore = useCallback(async () => {
    if (!oldestDocRef.current || loadingMore || !hasMore) return;
    setLoadingMore(true);
    const q = query(
      collection(db, "rooms", roomId, "messages"),
      orderBy("createdAt", "desc"),
      startAfter(oldestDocRef.current),
      limit(PAGE_SIZE)
    );
    const snap = await getDocs(q);
    if (snap.docs.length > 0) {
      oldestDocRef.current = snap.docs[snap.docs.length - 1];
      const older: Message[] = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            senderId: data.senderId,
            type: data.type ?? "text",
            text: data.text,
            mediaUrl: data.mediaUrl,
            replyToId: data.replyToId,
            replyToText: data.replyToText,
            deleted: data.deleted ?? false,
            seen: data.seen ?? false,
            delivered: data.delivered ?? false,
            createdAt: data.createdAt?.toDate() ?? null,
          } as Message;
        })
        .reverse();
      setMessages((prev) => [...older, ...prev]);
      setHasMore(snap.docs.length === PAGE_SIZE);
    } else {
      setHasMore(false);
    }
    setLoadingMore(false);
  }, [roomId, loadingMore, hasMore]);

  const sendMessage = useCallback(
    async (payload: {
      type: MessageType;
      text?: string;
      mediaUrl?: string;
      replyToId?: string;
      replyToText?: string;
    }) => {
      if (!currentUserId) return;
      await addDoc(collection(db, "rooms", roomId, "messages"), {
        senderId: currentUserId,
        type: payload.type,
        text: payload.text ?? null,
        mediaUrl: payload.mediaUrl ?? null,
        replyToId: payload.replyToId ?? null,
        replyToText: payload.replyToText ?? null,
        deleted: false,
        seen: false,
        delivered: true,
        createdAt: serverTimestamp(),
      });
    },
    [roomId, currentUserId]
  );

  const deleteMessage = useCallback(
    async (messageId: string) => {
      const ref = doc(db, "rooms", roomId, "messages", messageId);
      await updateDoc(ref, { deleted: true });
    },
    [roomId]
  );

  const markSeen = useCallback(
    async (messageId: string) => {
      if (!currentUserId) return;
      const ref = doc(db, "rooms", roomId, "messages", messageId);
      await updateDoc(ref, { seen: true });
    },
    [roomId, currentUserId]
  );

  const searchMessages = useCallback(
    async (searchText: string): Promise<Message[]> => {
      if (!searchText.trim()) return [];
      const q = query(
        collection(db, "rooms", roomId, "messages"),
        where("deleted", "==", false),
        orderBy("createdAt", "desc"),
        limit(50)
      );
      const snap = await getDocs(q);
      const lower = searchText.toLowerCase();
      return snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            senderId: data.senderId,
            type: data.type ?? "text",
            text: data.text,
            mediaUrl: data.mediaUrl,
            deleted: data.deleted ?? false,
            seen: data.seen ?? false,
            delivered: data.delivered ?? false,
            createdAt: data.createdAt?.toDate() ?? null,
          } as Message;
        })
        .filter((m) => m.text?.toLowerCase().includes(lower))
        .reverse();
    },
    [roomId]
  );

  return {
    messages,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    sendMessage,
    deleteMessage,
    markSeen,
    searchMessages,
  };
}
