import { useSession } from "@/hooks/useSession";
import EntryPage from "@/pages/EntryPage";
import ChatPage from "@/pages/ChatPage";

export default function App() {
  const { state, joinRoom, leaveRoom, codeError } = useSession();

  const handleJoin = async (code: string, name: string) => {
    await joinRoom(code, name);
  };

  const handleForceLogout = () => {
    leaveRoom();
  };

  if (state.status === "active") {
    return (
      <ChatPage
        userId={state.user.id}
        userName={state.user.name}
        otherId={state.otherId}
        onForceLogout={handleForceLogout}
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
