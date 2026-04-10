import React from "react";
import KPLogo from "./KPLogo";

export default function TitleBar({
  sidebarOpen,
  onToggleSidebar,
  toggleShortcut = "Ctrl+B",
  showSidebarToggle = true,
  menuItems = [],
  centerContent = null,
}) {
  const minimize = () => window.electronAPI?.windowMinimize();
  const maximize = () => window.electronAPI?.windowMaximize();
  const close = () => window.electronAPI?.windowClose();
  const hasMenu = Array.isArray(menuItems) && menuItems.length > 0;

  return (
    <div
      className="h-9 flex items-center justify-between bg-[#0a0a0a] border-b border-[#1a1a1a] select-none shrink-0"
      style={{ WebkitAppRegion: "drag" }}
    >
      {/* Left: toggle + app name */}
      <div className="flex items-center gap-1 pl-2 min-w-0" style={{ WebkitAppRegion: "no-drag" }}>
        {showSidebarToggle && (
          <button
            onClick={onToggleSidebar}
            title={`Toggle sidebar (${toggleShortcut})`}
            className="w-7 h-7 flex items-center justify-center rounded-sm text-[#b0b0b0] hover:text-[#00ff41] hover:bg-[#1a1a1a] transition-all cursor-pointer"
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
        )}

        <div className="flex items-center gap-1.5" style={{ WebkitAppRegion: "drag" }}>
          <div style={{ boxShadow: "0 0 6px rgba(0,255,65,0.1)" }} className="rounded-sm">
            <KPLogo size={16} className="rounded-sm" />
          </div>
          <span className="text-[11px] font-semibold text-[#00ff41] tracking-wider text-glow-green">
            &gt;_ KritakaPrajna
          </span>
        </div>

        {hasMenu && (
          <div className="hidden md:flex items-center gap-0.5 ml-2 pl-2 border-l border-[#1a1a1a]">
            {menuItems.map((item) => (
              <button
                key={item}
                type="button"
                className="h-6 px-2 rounded-sm text-[11px] text-[#b0b0b0] hover:text-[#00ff41] hover:bg-[#1a1a1a] transition-all cursor-pointer"
              >
                {item}
              </button>
            ))}
          </div>
        )}
      </div>

      {centerContent ? (
        <div className="flex-1 min-w-0 px-2" style={{ WebkitAppRegion: "no-drag" }}>
          {centerContent}
        </div>
      ) : (
        <div className="flex-1" style={{ WebkitAppRegion: "drag" }} />
      )}

      {/* Window controls */}
      <div className="flex items-center h-full" style={{ WebkitAppRegion: "no-drag" }}>
        <button
          onClick={minimize}
          className="h-full w-11 flex items-center justify-center text-[#b0b0b0] hover:bg-[#1a1a1a] hover:text-[#e0e0e0] transition-all cursor-pointer"
          aria-label="Minimize"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" d="M5 12h14" />
          </svg>
        </button>
        <button
          onClick={maximize}
          className="h-full w-11 flex items-center justify-center text-[#b0b0b0] hover:bg-[#1a1a1a] hover:text-[#e0e0e0] transition-all cursor-pointer"
          aria-label="Maximize"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <rect x="4" y="4" width="16" height="16" rx="1" />
          </svg>
        </button>
        <button
          onClick={close}
          className="h-full w-11 flex items-center justify-center text-[#b0b0b0] hover:bg-red-500 hover:text-white transition-all cursor-pointer"
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
