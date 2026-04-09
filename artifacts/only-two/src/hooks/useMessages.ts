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
  viewOnce?: boolean;
  reactions?: Record<string, string>;
  createdAt: Date | null;
};

const PAGE_SIZE = 20;

function mapDoc(d: { id: string; data: () => Record<string, unknown> }): Message {
  const data = d.data();
  return {
    id: d.id,
    senderId: data.senderId as string,
    type: (data.type as MessageType) ?? "text",
    text: data.text as string | undefined,
    mediaUrl: data.mediaUrl as string | undefined,
    replyToId: data.replyToId as string | undefined,
    replyToText: data.replyToText as string | undefined,
    deleted: (data.deleted as boolean) ?? false,
    seen: (data.seen as boolean) ?? false,
    delivered: (data.delivered as boolean) ?? false,
    viewOnce: (data.viewOnce as boolean) ?? false,
    reactions: (data.reactions as Record<string, string>) ?? {},
    createdAt: (data.createdAt as { toDate: () => Date } | null)?.toDate() ?? null,
  };
}

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
      setMessages(docs.map(mapDoc).reverse());
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
      setMessages((prev) => [...snap.docs.map(mapDoc).reverse(), ...prev]);
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
      viewOnce?: boolean;
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
        viewOnce: payload.viewOnce ?? false,
        reactions: {},
        createdAt: serverTimestamp(),
      });
    },
    [roomId, currentUserId]
  );

  const deleteMessage = useCallback(
    async (messageId: string) => {
      const r = doc(db, "rooms", roomId, "messages", messageId);
      await updateDoc(r, { deleted: true });
    },
    [roomId]
  );

  const markSeen = useCallback(
    async (messageId: string) => {
      if (!currentUserId) return;
      const r = doc(db, "rooms", roomId, "messages", messageId);
      await updateDoc(r, { seen: true });
    },
    [roomId, currentUserId]
  );

  const addReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!currentUserId) return;
      const r = doc(db, "rooms", roomId, "messages", messageId);
      await updateDoc(r, { [`reactions.${currentUserId}`]: emoji });
    },
    [roomId, currentUserId]
  );

  const removeReaction = useCallback(
    async (messageId: string) => {
      if (!currentUserId) return;
      const r = doc(db, "rooms", roomId, "messages", messageId);
      await updateDoc(r, { [`reactions.${currentUserId}`]: null });
    },
    [roomId, currentUserId]
  );

  const markViewOnceViewed = useCallback(
    async (messageId: string) => {
      const r = doc(db, "rooms", roomId, "messages", messageId);
      await updateDoc(r, { deleted: true });
    },
    [roomId]
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
        .map(mapDoc)
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
    addReaction,
    removeReaction,
    markViewOnceViewed,
    searchMessages,
  };
}
