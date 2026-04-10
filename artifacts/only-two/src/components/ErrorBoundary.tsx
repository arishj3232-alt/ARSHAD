import { Component, type ReactNode, type ErrorInfo } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6">
        <div className="max-w-sm w-full bg-white/5 border border-white/10 rounded-2xl p-8 text-center space-y-4">
          <div className="text-4xl">💔</div>
          <h2 className="text-white text-lg font-semibold">Something went wrong</h2>
          <p className="text-white/40 text-sm leading-relaxed">
            An unexpected error occurred. Your messages are safe — just reload to reconnect.
          </p>
          <p className="text-white/20 text-xs font-mono break-all">{error.message}</p>
          <button
            onClick={this.handleReset}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-violet-600 text-white text-sm font-medium"
          >
            Reload app
          </button>
        </div>
      </div>
    );
  }
}
