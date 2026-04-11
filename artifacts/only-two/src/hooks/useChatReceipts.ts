import { useEffect, useRef, useState } from "react";
import type { Message } from "@/hooks/useMessages";

type Options = {
  /** Room-level feature: when false, never mark messages as read. */
  roomReadReceiptsEnabled: boolean;
  /** Admin stealth: do not mark others' messages as read (no blue ticks for them). */
  adminStealthRead: boolean;
  ghostMode: boolean;
};

/**
 * Client-side WhatsApp-style receipts: mark incoming messages delivered, then read when chat is visible.
 * Read marking is not gated on “hide read receipts” UI preference — masking stays in ChatMessage only.
 */
export function useChatReceipts(
  messages: Message[],
  currentUserId: string | null,
  markDelivered: (id: string) => void | Promise<void>,
  markSeen: (id: string) => void | Promise<void>,
  { roomReadReceiptsEnabled, adminStealthRead, ghostMode }: Options
) {
  const deliveredPendingRef = useRef<Set<string>>(new Set());
  const seenPendingRef = useRef<Set<string>>(new Set());
  const [tabVisible, setTabVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible"
  );

  useEffect(() => {
    const onVis = () => setTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    if (!currentUserId) return;
    for (const m of messages) {
      if (m.senderId === currentUserId) continue;
      if (m.deleted || m.deletedForEveryone || m.ghost) continue;
      if (currentUserId && m.deletedFor?.[currentUserId]) continue;
      if (m.delivered) continue;
      if (deliveredPendingRef.current.has(m.id)) continue;
      deliveredPendingRef.current.add(m.id);
      void Promise.resolve(markDelivered(m.id)).finally(() => {
        deliveredPendingRef.current.delete(m.id);
      });
    }
  }, [messages, currentUserId, markDelivered]);

  useEffect(() => {
    if (!currentUserId) return;
    if (!tabVisible) return;

    for (const m of messages) {
      if (m.senderId === currentUserId) continue;
      if (m.deleted || m.deletedForEveryone || m.ghost) continue;
      if (currentUserId && m.deletedFor?.[currentUserId]) continue;
      if (m.seen) continue;
      if (!roomReadReceiptsEnabled) continue;
      if (adminStealthRead) continue;
      if (ghostMode) continue;
      if (seenPendingRef.current.has(m.id)) continue;

      seenPendingRef.current.add(m.id);
      void Promise.resolve(markSeen(m.id)).finally(() => {
        seenPendingRef.current.delete(m.id);
      });
    }
  }, [messages, currentUserId, markSeen, roomReadReceiptsEnabled, adminStealthRead, ghostMode, tabVisible]);
}
