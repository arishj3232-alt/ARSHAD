import { useSession } from "@/hooks/useSession";
import EntryPage from "@/pages/EntryPage";
import ChatPage from "@/pages/ChatPage";

export default function App() {
  const { state, joinRoom, codeError, setCodeError } = useSession();

  const handleJoin = async (code: string, name: string) => {
    setCodeError("");
    await joinRoom(code, name);
  };

  if (state.status === "active") {
    return (
      <ChatPage
        userId={state.user.id}
        userName={state.user.name}
        otherId={state.otherId}
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
