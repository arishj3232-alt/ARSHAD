import { useEffect } from "react";
import { useSession } from "@/hooks/useSession";
import { useInactivityLogout } from "@/hooks/useInactivityLogout";
import EntryPage from "@/pages/EntryPage";
import ChatPage from "@/pages/ChatPage";

export default function App() {
  const { state, joinRoom, leaveRoom, codeError, isRecoveringSession } = useSession();
  useInactivityLogout(state.status === "active");

  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") {
      void Notification.requestPermission();
    }
  }, []);

  const handleJoin = async (payload: { role: "shelly" | "arshad"; name: string; roomCode: string }) => {
    await joinRoom(payload);
  };

  const handleForceLogout = async () => {
    await leaveRoom();
  };

  if (isRecoveringSession) {
    return (
      <div className="min-h-screen bg-[#080810] flex items-center justify-center">
        <div className="text-center">
          <div className="w-7 h-7 mx-auto border-2 border-pink-500/30 border-t-pink-500 rounded-full animate-spin mb-3" />
          <p className="text-white/70 text-sm">Reconnecting...</p>
        </div>
      </div>
    );
  }

  if (state.status === "active") {
    return (
      <ChatPage
        userId={state.user.id}
        userName={state.user.name}
        roomCode={state.roomCode}
        otherId={state.otherId}
        onForceLogout={handleForceLogout}
        onLeaveRoom={leaveRoom}
      />
    );
  }

  return (
    <EntryPage
      onJoin={handleJoin}
      error={codeError}
      blocked={state.status === "blocked"}
    />
  );
}
