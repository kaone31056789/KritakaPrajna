import React from "react";
import KPLogo from "./KPLogo";

export default function TitleBar({ sidebarOpen, onToggleSidebar, toggleShortcut = "Ctrl+B" }) {
  const minimize = () => window.electronAPI?.windowMinimize();
  const maximize = () => window.electronAPI?.windowMaximize();
  const close = () => window.electronAPI?.windowClose();

  return (
    <div
      className="h-9 flex items-center justify-between bg-dark-950 border-b border-white/[0.06] select-none shrink-0"
      style={{ WebkitAppRegion: "drag" }}
    >
      {/* Left: toggle + app name */}
      <div className="flex items-center gap-1 pl-2" style={{ WebkitAppRegion: "no-drag" }}>
        <button
          onClick={onToggleSidebar}
          title={`Toggle sidebar (${toggleShortcut})`}
          className="w-7 h-7 flex items-center justify-center rounded-md text-dark-400 hover:text-dark-200 hover:bg-white/[0.06] transition-colors cursor-pointer"
          aria-label="Toggle sidebar"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            {sidebarOpen ? (
              <>
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 3v18" />
              </>
            ) : (
              <>
                <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
              </>
            )}
          </svg>
        </button>
        <div className="flex items-center gap-1.5" style={{ WebkitAppRegion: "drag" }}>
          <KPLogo size={16} className="rounded-sm" />
          <span className="text-[11px] font-semibold text-dark-300 tracking-wide">
            KritakaPrajna
          </span>
        </div>
      </div>

      {/* Window controls */}
      <div className="flex items-center h-full" style={{ WebkitAppRegion: "no-drag" }}>
        {/* Minimize */}
        <button
          onClick={minimize}
          className="h-full w-11 flex items-center justify-center text-dark-400 hover:bg-white/[0.06] hover:text-dark-200 transition-colors cursor-pointer"
          aria-label="Minimize"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" d="M5 12h14" />
          </svg>
        </button>

        {/* Maximize */}
        <button
          onClick={maximize}
          className="h-full w-11 flex items-center justify-center text-dark-400 hover:bg-white/[0.06] hover:text-dark-200 transition-colors cursor-pointer"
          aria-label="Maximize"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <rect x="4" y="4" width="16" height="16" rx="1" />
          </svg>
        </button>

        {/* Close */}
        <button
          onClick={close}
          className="h-full w-11 flex items-center justify-center text-dark-400 hover:bg-red-500 hover:text-white transition-colors cursor-pointer"
          aria-label="Close"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
