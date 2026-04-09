import { useState } from "react";
import { Heart, Lock, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  onJoin: (code: string, name: string) => void;
  error: string;
  blocked?: boolean;
};

export default function EntryPage({ onJoin, error, blocked }: Props) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim() || loading) return;
    setLoading(true);
    await onJoin(code, name);
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
                  Your Name
                </label>
                <input
                  data-testid="input-name"
                  className="w-full bg-white/5 border border-white/8 rounded-2xl px-4 py-3.5 text-white placeholder-white/20 focus:outline-none focus:border-pink-500/60 focus:bg-white/7 transition-all text-sm"
                  placeholder="Enter your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="words"
                />
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
                disabled={loading || !name.trim() || !code.trim()}
                className="w-full bg-gradient-to-r from-pink-500 to-violet-600 text-white font-semibold py-3.5 rounded-2xl hover:opacity-90 active:scale-[0.98] transition-all shadow-lg shadow-pink-500/25 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-1"
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
