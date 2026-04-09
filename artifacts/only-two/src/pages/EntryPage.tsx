import { useState } from "react";
import { Heart, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  onJoin: (code: string, name: string) => void;
  error: string;
  blocked?: boolean;
};

export default function EntryPage({ onJoin, error, blocked }: Props) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [shake, setShake] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim()) return;
    onJoin(code, name);
    if (error) {
      setShake(true);
      setTimeout(() => setShake(false), 600);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-pink-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-violet-600/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-rose-500/5 rounded-full blur-2xl" />
      </div>

      {blocked ? (
        <div className="text-center z-10 animate-fade-in">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-pink-500/30">
            <Heart className="w-10 h-10 text-white fill-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-3">OnlyTwo</h1>
          <p className="text-white/60 text-lg">This space is only for two.</p>
          <p className="text-white/30 text-sm mt-2">Both seats are taken.</p>
        </div>
      ) : (
        <div
          className={cn(
            "z-10 w-full max-w-md mx-4",
            shake && "animate-shake"
          )}
        >
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-3xl p-8 shadow-2xl">
            <div className="text-center mb-8">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-pink-500/30">
                <Heart className="w-8 h-8 text-white fill-white" />
              </div>
              <h1 className="text-3xl font-bold text-white tracking-tight">
                OnlyTwo
              </h1>
              <p className="text-white/40 text-sm mt-1">
                A private space for just you two
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-white/50 text-xs uppercase tracking-widest mb-2 block">
                  Your Name
                </label>
                <input
                  data-testid="input-name"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-pink-500/50 focus:bg-white/8 transition-all"
                  placeholder="Enter your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="text-white/50 text-xs uppercase tracking-widest mb-2 block">
                  Room Code
                </label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                  <input
                    data-testid="input-room-code"
                    type="password"
                    className="w-full bg-white/5 border border-white/10 rounded-xl pl-11 pr-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-pink-500/50 focus:bg-white/8 transition-all"
                    placeholder="Enter room code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoComplete="off"
                  />
                </div>
              </div>

              {error && (
                <p className="text-rose-400 text-sm text-center bg-rose-500/10 rounded-xl px-4 py-2 border border-rose-500/20">
                  {error}
                </p>
              )}

              <button
                data-testid="button-enter"
                type="submit"
                className="w-full bg-gradient-to-r from-pink-500 to-violet-600 text-white font-semibold py-3 rounded-xl hover:opacity-90 active:scale-[0.99] transition-all shadow-lg shadow-pink-500/25 mt-2"
              >
                Enter the Space
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
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in { animation: fade-in 0.5s ease-out; }
      `}</style>
    </div>
  );
}
