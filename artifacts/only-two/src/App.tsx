import { useState, useEffect } from "react";
import { useSession } from "@/hooks/useSession";
import EntryPage from "@/pages/EntryPage";
import ChatPage from "@/pages/ChatPage";

export default function App() {
  const {
    state,
    joinRoom,
    enteredCode,
    setEnteredCode,
    codeError,
    setCodeError,
  } = useSession();

  const [joining, setJoining] = useState(false);

  const handleJoin = async (code: string, name: string) => {
    setJoining(true);
    setCodeError("");
    await joinRoom(code, name);
    setJoining(false);
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
