import { useEffect, useRef, useState } from "react";
import type { Message } from "@/hooks/useMessages";

type Options = {
  readReceiptsEnabled: boolean;
  /** Admin stealth: do not mark others' messages as read (no blue ticks for them). */
  adminStealthRead: boolean;
  ghostMode: boolean;
};

/**
 * Client-side WhatsApp-style receipts: mark incoming messages delivered, then read when chat is visible.
 */
export function useChatReceipts(
  messages: Message[],
  currentUserId: string | null,
  markDelivered: (id: string) => void | Promise<void>,
  markSeen: (id: string) => void | Promise<void>,
  { readReceiptsEnabled, adminStealthRead, ghostMode }: Options
) {
  const deliveredPendingRef = useRef<Set<string>>(new Set());
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
      if (m.receiptStatus !== "sent") continue;
      if (deliveredPendingRef.current.has(m.id)) continue;
      deliveredPendingRef.current.add(m.id);
      void Promise.resolve(markDelivered(m.id)).finally(() => {
        deliveredPendingRef.current.delete(m.id);
      });
    }
  }, [messages, currentUserId, markDelivered]);

  useEffect(() => {
    if (!currentUserId) return;
    if (!readReceiptsEnabled || adminStealthRead || ghostMode) return;
    if (!tabVisible) return;

    const unseen = messages.filter(
      (m) =>
        m.senderId !== currentUserId &&
        !m.deleted &&
        !m.deletedForEveryone &&
        !m.ghost &&
        !(currentUserId && m.deletedFor?.[currentUserId]) &&
        m.receiptStatus !== "read"
    );
    unseen.forEach((m) => void markSeen(m.id));
  }, [messages, currentUserId, markSeen, readReceiptsEnabled, adminStealthRead, ghostMode, tabVisible]);
}
