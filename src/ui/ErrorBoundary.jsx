// Screen-level error boundary — a crashed view must never blank the app.
// Shows a recover card and lets the user remount the screen in place.
import React from "react";
import Icon from "./icons";
import { NeuButton } from "./primitives";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, resetKey: 0 };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[screen-crash]", error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    // Navigating to a different view clears a stale crash automatically.
    if (prevProps.scope !== this.props.scope && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    const message = String(this.state.error?.message || this.state.error || "Unknown error");
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div
          className="max-w-[420px] w-full rounded-lg bg-surface px-6 py-6 flex flex-col gap-3"
          style={{ boxShadow: "var(--neu-raised)" }}
        >
          <div className="flex items-center gap-2.5 text-err">
            <Icon name="alert" size={18} />
            <span className="font-display font-semibold text-[14px] text-hi">
              This screen hit an error
            </span>
          </div>
          <p className="text-[12.5px] leading-relaxed text-dim break-words font-mono">{message}</p>
          <p className="text-[12px] text-faint">
            Your chats and settings are safe — remount the screen to continue.
          </p>
          <div className="flex gap-2 pt-1">
            <NeuButton
              variant="accent"
              onClick={() => this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }))}
            >
              Reload screen
            </NeuButton>
          </div>
        </div>
      </div>
    );
  }
}
