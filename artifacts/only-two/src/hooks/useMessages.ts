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
  getDoc,
  deleteField,
  DocumentSnapshot,
  arrayUnion,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export type ReceiptStatus = "sent" | "delivered" | "read";

export type MessageType = "text" | "image" | "video" | "audio" | "call";
export type CallMessageStatus = "calling" | "missed" | "declined" | "completed" | "not_picked";
export type CallMediaType = "audio" | "video";

export type Message = {
  id: string;
  senderId: string;
  type: MessageType;
  callType?: CallMediaType;
  callStatus?: CallMessageStatus;
  duration?: number;
  text?: string;
  mediaUrl?: string;
  originalText?: string;
  originalMediaUrl?: string;
  replyToId?: string;
  replyToText?: string;
  deleted: boolean;
  deletedForEveryone?: boolean;
  deletedFor?: Record<string, boolean>;
  seen: boolean;
  delivered: boolean;
  viewOnce?: boolean;
  viewOnceViewed?: boolean; // backward compatibility
  openedBy?: string[];
  openedAt?: number | null;
  expiresAt?: number | null;
  ghost?: boolean;
  reactions?: Record<string, string>;
  edited?: boolean;
  createdAt: Date | null;
  /** WhatsApp-style delivery ticks (derived + stored). */
  receiptStatus: ReceiptStatus;
};

const PAGE_SIZE = 20;

function deriveReceiptStatus(data: Record<string, unknown>): ReceiptStatus {
  const r = data.receiptStatus;
  if (r === "sent" || r === "delivered" || r === "read") return r;
  if (data.seen === true) return "read";
  if (data.delivered === true) return "delivered";
  return "sent";
}

function mapDoc(d: { id: string; data: () => Record<string, unknown> }): Message {
  const data = d.data();
  return {
    id: d.id,
    senderId: data.senderId as string,
    type: (data.type as MessageType) ?? "text",
    text: data.text as string | undefined,
    mediaUrl: data.mediaUrl as string | undefined,
    originalText: data.originalText as string | undefined,
    originalMediaUrl: data.originalMediaUrl as string | undefined,
    replyToId: data.replyToId as string | undefined,
    replyToText: data.replyToText as string | undefined,
    deleted: (data.deleted as boolean) ?? false,
    deletedForEveryone: (data.deletedForEveryone as boolean) ?? false,
    deletedFor: (data.deletedFor as Record<string, boolean>) ?? {},
    seen: (data.seen as boolean) ?? false,
    delivered: (data.delivered as boolean) ?? false,
    viewOnce: (data.viewOnce as boolean) ?? false,
    viewOnceViewed: (data.viewOnceViewed as boolean) ?? false,
    openedBy: (data.openedBy as string[]) ?? [],
    openedAt: (data.openedAt as number | null) ?? null,
    expiresAt: (data.expiresAt as number | null) ?? null,
    ghost: (data.ghost as boolean) ?? false,
    edited: (data.edited as boolean) ?? false,
    reactions: Object.fromEntries(
      Object.entries((data.reactions as Record<string, string>) ?? {}).filter(
        ([, v]) => v && typeof v === "string" && v.length > 0
      )
    ),
    callType: data.callType as CallMediaType | undefined,
    callStatus: data.callStatus as CallMessageStatus | undefined,
    duration: typeof data.duration === "number" ? data.duration : undefined,
    createdAt: (data.createdAt as { toDate: () => Date } | null)?.toDate() ?? null,
    receiptStatus: deriveReceiptStatus(data),
  };
}

export function useMessages(roomId: string, currentUserId: string | null, viewOnceTimerMs = 15_000) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const oldestDocRef = useRef<DocumentSnapshot | null>(null);
  /** Older pages loaded via pagination (prepended); not replaced when the live tail snapshot updates. */
  const olderLoadedRef = useRef<Message[]>([]);
  const latestWindowRef = useRef<Message[]>([]);

  useEffect(() => {
    if (!roomId) return undefined;

    olderLoadedRef.current = [];
    latestWindowRef.current = [];
    oldestDocRef.current = null;
    setLoading(true);
    setHasMore(true);

    const q = query(
      collection(db, "rooms", roomId, "messages"),
      orderBy("createdAt", "desc"),
      limit(PAGE_SIZE)
    );

    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs;
      if (docs.length > 0) oldestDocRef.current = docs[docs.length - 1];
      latestWindowRef.current = docs.map(mapDoc).reverse();
      setMessages([...olderLoadedRef.current, ...latestWindowRef.current]);
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
      const olderChunk = snap.docs.map(mapDoc).reverse();
      olderLoadedRef.current = [...olderChunk, ...olderLoadedRef.current];
      setMessages([...olderLoadedRef.current, ...latestWindowRef.current]);
      setHasMore(snap.docs.length === PAGE_SIZE);
    } else {
      setHasMore(false);
    }
    setLoadingMore(false);
  }, [roomId, loadingMore, hasMore]);

  const sendMessage = useCallback(
    async (payload: {
      type: MessageType;
      callType?: CallMediaType;
      callStatus?: CallMessageStatus;
      duration?: number;
      text?: string;
      mediaUrl?: string;
      replyToId?: string;
      replyToText?: string;
      viewOnce?: boolean;
      ghost?: boolean;
    }) => {
      if (!currentUserId) return;
      await addDoc(collection(db, "rooms", roomId, "messages"), {
        senderId: currentUserId,
        type: payload.type,
        callType: payload.callType ?? null,
        callStatus: payload.callStatus ?? null,
        duration: typeof payload.duration === "number" ? payload.duration : null,
        text: payload.text ?? null,
        mediaUrl: payload.mediaUrl ?? null,
        originalText: payload.text ?? null,
        originalMediaUrl: payload.mediaUrl ?? null,
        replyToId: payload.replyToId ?? null,
        replyToText: payload.replyToText ?? null,
        deleted: false,
        deletedForEveryone: false,
        deletedFor: {},
        seen: false,
        delivered: false,
        receiptStatus: "sent",
        viewOnce: payload.viewOnce ?? false,
        viewOnceViewed: false,
        openedBy: [],
        openedAt: null,
        expiresAt: null,
        ghost: payload.ghost ?? false,
        edited: false,
        reactions: {},
        createdAt: serverTimestamp(),
      });
    },
    [roomId, currentUserId]
  );

  const editMessage = useCallback(
    async (messageId: string, newText: string) => {
      if (!currentUserId || !newText.trim()) return;
      const r = doc(db, "rooms", roomId, "messages", messageId);
      await updateDoc(r, { text: newText.trim(), edited: true });
    },
    [roomId, currentUserId]
  );

  const deleteForMe = useCallback(
    async (messageId: string) => {
      if (!currentUserId) return;
      const r = doc(db, "rooms", roomId, "messages", messageId);
      await updateDoc(r, { [`deletedFor.${currentUserId}`]: true });
    },
    [roomId, currentUserId]
  );

  const deleteForEveryone = useCallback(
    async (messageId: string, _deletedText = "This message was deleted") => {
      void _deletedText;
      const r = doc(db, "rooms", roomId, "messages", messageId);
      const snap = await getDoc(r);
      const data = snap.data() as Record<string, unknown> | undefined;
      const existingText = typeof data?.text === "string" ? data.text : "";
      const existingMedia = typeof data?.mediaUrl === "string" ? data.mediaUrl : "";
      const patch: Record<string, unknown> = {
        deleted: true,
        deletedForEveryone: true,
        text: "",
        mediaUrl: null,
        originalText:
          data?.originalText != null && String(data.originalText).length > 0
            ? data.originalText
            : existingText || "",
        originalMediaUrl:
          data?.originalMediaUrl != null && String(data.originalMediaUrl).length > 0
            ? data.originalMediaUrl
            : existingMedia || "",
      };
      await updateDoc(r, patch);
    },
    [roomId]
  );

  const markDelivered = useCallback(
    async (messageId: string) => {
      if (!currentUserId) return;
      await updateDoc(doc(db, "rooms", roomId, "messages", messageId), {
        delivered: true,
        receiptStatus: "delivered",
      });
    },
    [roomId, currentUserId]
  );

  const markSeen = useCallback(
    async (messageId: string) => {
      if (!currentUserId) return;
      await updateDoc(doc(db, "rooms", roomId, "messages", messageId), {
        seen: true,
        delivered: true,
        receiptStatus: "read",
      });
    },
    [roomId, currentUserId]
  );

  const addReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!currentUserId) return;
      await updateDoc(doc(db, "rooms", roomId, "messages", messageId), {
        [`reactions.${currentUserId}`]: emoji,
      });
    },
    [roomId, currentUserId]
  );

  const removeReaction = useCallback(
    async (messageId: string) => {
      if (!currentUserId) return;
      await updateDoc(doc(db, "rooms", roomId, "messages", messageId), {
        [`reactions.${currentUserId}`]: deleteField(),
      });
    },
    [roomId, currentUserId]
  );

  const markViewOnceViewed = useCallback(
    async (messageId: string) => {
      if (!currentUserId) return;
      const messageRef = doc(db, "rooms", roomId, "messages", messageId);
      // Firestore-level guard: avoid redundant writes across reloads/devices.
      const snap = await getDoc(messageRef);
      const data = snap.data() as { openedBy?: string[]; expiresAt?: number | null } | undefined;
      if (data?.openedBy?.includes(currentUserId)) return;
      if (typeof data?.expiresAt === "number") return;
      const openedAt = Date.now();
      const safeTimer = Number.isFinite(viewOnceTimerMs) && viewOnceTimerMs > 0 ? viewOnceTimerMs : 15_000;
      const expiresAt = openedAt + safeTimer;

      await updateDoc(messageRef, {
        openedBy: arrayUnion(currentUserId),
        openedAt,
        expiresAt,
        openedAtServer: serverTimestamp(),
        // keep legacy field in sync to avoid breaking old clients
        viewOnceViewed: true,
      });
    },
    [roomId, currentUserId, viewOnceTimerMs]
  );

  const searchMessages = useCallback(
    (searchText: string): Message[] => {
      if (!searchText.trim()) return [];
      const lower = searchText.toLowerCase();
      return messages.filter(
        (m) =>
          !m.deleted &&
          !(currentUserId && m.deletedFor?.[currentUserId]) &&
          !m.ghost &&
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
    editMessage,
    deleteForMe,
    deleteForEveryone,
    markDelivered,
    markSeen,
    addReaction,
    removeReaction,
    markViewOnceViewed,
    searchMessages,
  };
}
