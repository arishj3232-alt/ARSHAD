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
  deleteField,
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
  deletedForEveryone?: boolean;
  deletedFor?: Record<string, boolean>;
  seen: boolean;
  delivered: boolean;
  viewOnce?: boolean;
  viewOnceViewed?: boolean;
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
    deletedForEveryone: (data.deletedForEveryone as boolean) ?? false,
    deletedFor: (data.deletedFor as Record<string, boolean>) ?? {},
    seen: (data.seen as boolean) ?? false,
    delivered: (data.delivered as boolean) ?? false,
    viewOnce: (data.viewOnce as boolean) ?? false,
    viewOnceViewed: (data.viewOnceViewed as boolean) ?? false,
    reactions: Object.fromEntries(
      Object.entries((data.reactions as Record<string, string>) ?? {}).filter(
        ([, v]) => v && typeof v === "string" && v.length > 0
      )
    ),
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
        deletedForEveryone: false,
        deletedFor: {},
        seen: false,
        delivered: true,
        viewOnce: payload.viewOnce ?? false,
        viewOnceViewed: false,
        reactions: {},
        createdAt: serverTimestamp(),
      });
    },
    [roomId, currentUserId]
  );

  // Delete for me: hides message only for current user
  const deleteForMe = useCallback(
    async (messageId: string) => {
      if (!currentUserId) return;
      const r = doc(db, "rooms", roomId, "messages", messageId);
      await updateDoc(r, { [`deletedFor.${currentUserId}`]: true });
    },
    [roomId, currentUserId]
  );

  // Delete for everyone: marks as globally deleted with configurable text
  const deleteForEveryone = useCallback(
    async (messageId: string, deletedText = "This message was deleted") => {
      const r = doc(db, "rooms", roomId, "messages", messageId);
      await updateDoc(r, {
        deleted: true,
        deletedForEveryone: true,
        text: deletedText,
        mediaUrl: null,
      });
    },
    [roomId]
  );

  // Legacy single delete (kept for compatibility)
  const deleteMessage = deleteForEveryone;

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

  // Use deleteField() to fully remove the key — prevents null/undefined display
  const removeReaction = useCallback(
    async (messageId: string) => {
      if (!currentUserId) return;
      const r = doc(db, "rooms", roomId, "messages", messageId);
      await updateDoc(r, { [`reactions.${currentUserId}`]: deleteField() });
    },
    [roomId, currentUserId]
  );

  // Mark view-once as viewed — message stays but media is locked
  const markViewOnceViewed = useCallback(
    async (messageId: string) => {
      const r = doc(db, "rooms", roomId, "messages", messageId);
      await updateDoc(r, { viewOnceViewed: true });
    },
    [roomId]
  );

  const searchMessages = useCallback(
    (searchText: string): Message[] => {
      if (!searchText.trim()) return [];
      const lower = searchText.toLowerCase();
      return messages.filter(
        (m) =>
          !m.deleted &&
          !(currentUserId && m.deletedFor?.[currentUserId]) &&
          m.type === "text" &&
          m.text?.toLowerCase().includes(lower)
      );
    },
    [messages, currentUserId]
  );

  return {
    messages,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    sendMessage,
    deleteMessage,
    deleteForMe,
    deleteForEveryone,
    markSeen,
    addReaction,
    removeReaction,
    markViewOnceViewed,
    searchMessages,
  };
}
