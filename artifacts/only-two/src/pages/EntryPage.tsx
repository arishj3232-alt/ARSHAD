import { useEffect, useState } from "react";
import { Heart, Lock, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { get, onValue, ref, set } from "firebase/database";
import { rtdb } from "@/lib/firebase";
import { getOrCreateTabSessionId } from "@/lib/tabSessionId";

/** If last status heartbeat is older than this, treat role lock as stale (ghost session). */
const STALE_ROLE_LOCK_MS = 60_000;

function roleOccupiedByOtherTab(roleNode: any, tabId: string): boolean {
  console.log("ROLE DATA:", roleNode, "MY SESSION:", tabId);
  if (!roleNode) return false;

  if (typeof roleNode !== "object") return true;

  const sid = roleNode.sessionId;

  if (!sid || typeof sid !== "string") return true;

  return sid !== tabId;
}

type Props = {
  onJoin: (payload: { role: "shelly" | "arshad"; name: string; roomCode: string }) => void;
  error: string;
  blocked?: boolean;
};

export default function EntryPage({ onJoin, error, blocked }: Props) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const [role, setRole] = useState<"shelly" | "arshad" | null>(null);
  const [roleError, setRoleError] = useState("");
  /** True when the role node is held by another tab (sessionId mismatch or legacy lock). */
  const [roleBlocked, setRoleBlocked] = useState<{ shelly: boolean; arshad: boolean }>({
    shelly: false,
    arshad: false,
  });
  const [takenAnim, setTakenAnim] = useState<{ shelly: boolean; arshad: boolean }>({
    shelly: false,
    arshad: false,
  });

  useEffect(() => {
    const normalizedRoom = code.trim();
    if (!normalizedRoom) {
      setRoleBlocked({ shelly: false, arshad: false });
      return undefined;
    }
    const rolesRef = ref(rtdb, `rooms/${normalizedRoom}/roles`);
    const unsub = onValue(rolesRef, (snap) => {
      const data = (snap.val() ?? {}) as Record<string, unknown>;
      const tabId = getOrCreateTabSessionId();
      const nextShellyBlocked = roleOccupiedByOtherTab(data.shelly, tabId);
      const nextArshadBlocked = roleOccupiedByOtherTab(data.arshad, tabId);
      setRoleBlocked((prev) => {
        (["shelly", "arshad"] as const).forEach((k) => {
          const next = k === "shelly" ? nextShellyBlocked : nextArshadBlocked;
          if (!prev[k] && next) {
            setTakenAnim((a) => ({ ...a, [k]: true }));
            setTimeout(() => {
              setTakenAnim((a) => ({ ...a, [k]: false }));
            }, 260);
          }
        });
        return { shelly: nextShellyBlocked, arshad: nextArshadBlocked };
      });
      setRole((prev) => {
        if (!prev) return prev;
        if (prev === "shelly" && nextShellyBlocked) return null;
        if (prev === "arshad" && nextArshadBlocked) return null;
        return prev;
      });
    });
    return () => unsub();
  }, [code]);

  /** Remove ghost role locks when the user is not actively online (crashed tab / no leave). */
  useEffect(() => {
    const room = code.trim();
    if (!room) return undefined;
    let cancelled = false;
    const rolesRef = ref(rtdb, `rooms/${room}/roles`);
    const sweep = async () => {
      let snap;
      try {
        snap = await get(rolesRef);
      } catch {
        return;
      }
      if (cancelled) return;
      const data = (snap.val() ?? {}) as Record<string, { userId?: string; sessionId?: string } | undefined>;
      for (const key of ["shelly", "arshad"] as const) {
        const entry = data[key];
        const sid = typeof entry?.sessionId === "string" ? entry.sessionId : "";
        if (!sid) continue;
        let stSnap;
        try {
          stSnap = await get(ref(rtdb, `status/${room}/${sid}`));
        } catch {
          continue;
        }
        const v = stSnap.val() as { status?: string; ts?: number } | null;
        const ts = typeof v?.ts === "number" ? v.ts : 0;
        const isOffline = v?.status === "offline";
        const staleOffline = isOffline && ts > 0 && Date.now() - ts > STALE_ROLE_LOCK_MS;
        if (staleOffline) {
          try {
            await set(ref(rtdb, `rooms/${room}/roles/${key}`), null);
          } catch {
            /* rules / offline */
          }
        }
      }
    };
    const unsub = onValue(rolesRef, () => {
      void sweep();
    });
    void sweep();
    return () => {
      cancelled = true;
      unsub();
    };
  }, [code]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || loading) return;
    if (!role) {
      setRoleError("Please select a role");
      return;
    }
    setRoleError("");
    setLoading(true);
    await onJoin({ role, name: role === "shelly" ? "Shelly" : "Arshad", roomCode: code });
    setLoading(false);
    if (error) {
      setShake(true);
      setTimeout(() => setShake(false), 600);
    }
  };

  return (
    <div className="min-h-screen bg-[#080810] flex items-center justify-center relative overflow-hidden p-4">
      {/* Animated background blobs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[15%] left-[10%] w-72 sm:w-96 h-72 sm:h-96 bg-pink-600/8 rounded-full blur-3xl animate-blob" />
        <div className="absolute bottom-[15%] right-[10%] w-72 sm:w-96 h-72 sm:h-96 bg-violet-600/8 rounded-full blur-3xl animate-blob animation-delay-2000" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-rose-500/4 rounded-full blur-2xl animate-blob animation-delay-4000" />
      </div>

      {blocked ? (
        <div className="text-center z-10 animate-fade-in">
          <div className="relative w-24 h-24 mx-auto mb-6">
            <div className="absolute inset-0 rounded-full bg-pink-500/20 animate-ping" />
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center shadow-2xl shadow-pink-500/30">
              <Heart className="w-11 h-11 text-white fill-white" />
            </div>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3">OnlyTwo</h1>
          <p className="text-white/50 text-base sm:text-lg">This space is only for two.</p>
          <p className="text-white/25 text-sm mt-2">Both seats are taken. 💕</p>
        </div>
      ) : (
        <div
          className={cn(
            "z-10 w-full max-w-sm",
            shake && "animate-shake"
          )}
        >
          <div className="backdrop-blur-2xl bg-white/4 border border-white/10 rounded-3xl p-7 sm:p-8 shadow-2xl">
            {/* Logo */}
            <div className="text-center mb-8">
              <div className="relative w-20 h-20 mx-auto mb-4">
                <div className="absolute inset-0 rounded-2xl bg-pink-500/20 blur-xl" />
                <div className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center shadow-xl shadow-pink-500/30">
                  <Heart className="w-9 h-9 text-white fill-white" />
                </div>
              </div>
              <h1 className="text-3xl font-bold text-white tracking-tight">
                OnlyTwo
              </h1>
              <p className="text-white/35 text-sm mt-1.5 flex items-center justify-center gap-1">
                <Sparkles className="w-3 h-3" />
                A private space for just you two
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-white/40 text-[10px] uppercase tracking-widest mb-2 block">
                  Select Role
                </label>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (!roleBlocked.shelly) {
                        setRole("shelly");
                        setRoleError("");
                      }
                    }}
                    disabled={roleBlocked.shelly}
                    className={cn(
                      "flex-1 py-3 rounded-xl border transition transform hover:scale-105 active:scale-95",
                      roleBlocked.shelly && "opacity-50 cursor-not-allowed hover:scale-100 active:scale-100",
                      takenAnim.shelly && "scale-95",
                      role === "shelly"
                        ? "bg-pink-500 text-white border-pink-500 shadow-lg shadow-pink-500/30"
                        : "bg-gray-900 text-gray-300 border-gray-700"
                    )}
                  >
                    💖 Shelly{roleBlocked.shelly ? " - occupied" : ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!roleBlocked.arshad) {
                        setRole("arshad");
                        setRoleError("");
                      }
                    }}
                    disabled={roleBlocked.arshad}
                    className={cn(
                      "flex-1 py-3 rounded-xl border transition transform hover:scale-105 active:scale-95",
                      roleBlocked.arshad && "opacity-50 cursor-not-allowed hover:scale-100 active:scale-100",
                      takenAnim.arshad && "scale-95",
                      role === "arshad"
                        ? "bg-blue-500 text-white border-blue-500 shadow-lg shadow-blue-500/30"
                        : "bg-gray-900 text-gray-300 border-gray-700"
                    )}
                  >
                    🔥 Arshad{roleBlocked.arshad ? " - occupied" : ""}
                  </button>
                </div>
                {!role && roleError && <p className="text-red-400 text-sm mt-2">{roleError}</p>}
              </div>

              <div>
                <label className="text-white/40 text-[10px] uppercase tracking-widest mb-2 block">
                  Room Code
                </label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/25" />
                  <input
                    data-testid="input-room-code"
                    type="password"
                    className="w-full bg-white/5 border border-white/8 rounded-2xl pl-11 pr-4 py-3.5 text-white placeholder-white/20 focus:outline-none focus:border-pink-500/60 focus:bg-white/7 transition-all text-sm"
                    placeholder="Enter room code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoComplete="off"
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 text-rose-400 text-sm bg-rose-500/8 rounded-2xl px-4 py-3 border border-rose-500/15">
                  <span className="text-rose-400/60">⚠</span>
                  {error}
                </div>
              )}

              <button
                data-testid="button-enter"
                type="submit"
                disabled={loading || !code.trim() || !role}
                className="w-full bg-gradient-to-r from-pink-500 to-violet-600 text-white font-semibold py-3.5 rounded-2xl hover:opacity-90 hover:scale-105 active:scale-95 transition-all shadow-lg shadow-pink-500/25 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2 mt-1"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Entering…</span>
                  </>
                ) : (
                  <>
                    <Heart className="w-4 h-4 fill-white" />
                    <span>Enter the Space</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
        .animate-shake { animation: shake 0.5s ease-in-out; }

        @keyframes fade-in {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in { animation: fade-in 0.5s ease-out; }

        @keyframes blob {
          0%, 100% { transform: scale(1) translate(0, 0); }
          33% { transform: scale(1.08) translate(16px, -12px); }
          66% { transform: scale(0.94) translate(-10px, 10px); }
        }
        .animate-blob { animation: blob 9s ease-in-out infinite; }
        .animation-delay-2000 { animation-delay: 2s; }
        .animation-delay-4000 { animation-delay: 4s; }
      `}</style>
    </div>
  );
}
