import React from "react";

// Thin-stroke icon set (1.5px, round caps) — consistent light-line language.
// Usage: <Icon name="chat" size={16} className="text-dim" />

const PATHS = {
  chat: <><path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-4.2 3.2a.5.5 0 0 1-.8-.4V7A1.5 1.5 0 0 1 4 5.5Z" /><path d="M8.5 10.5h7M8.5 13.5h4.5" /></>,
  agent: <><rect x="5" y="7.5" width="14" height="11" rx="3.5" /><path d="M12 7.5V4.5M12 4.5h.01" /><circle cx="12" cy="3.75" r="1.1" /><path d="M9 12.5h.01M15 12.5h.01" /><path d="M9.5 15.5c.7.6 1.6 1 2.5 1s1.8-.4 2.5-1" /><path d="M5 11.5H3M21 11.5h-2" /></>,
  advisor: <><circle cx="12" cy="12" r="8.5" /><path d="m15.4 8.6-1.9 4.9-4.9 1.9 1.9-4.9 4.9-1.9Z" /><path d="M12 12h.01" /></>,
  settings: <><path d="M4 8h9M17 8h3M4 16h3M11 16h9" /><circle cx="15" cy="8" r="2.2" /><circle cx="9" cy="16" r="2.2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-3.8-3.8" /></>,
  pin: <><path d="M9 4.5h6l-.7 6.2 2.7 2.8v1h-4v5l-1 1.5-1-1.5v-5H7v-1l2.7-2.8L9 4.5Z" /></>,
  folder: <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 18.5H5A1.5 1.5 0 0 1 3.5 17V6.5Z" />,
  trash: <><path d="M4.5 7h15M9.5 7V4.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7" /><path d="M6.5 7v11.7a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5V7" /><path d="M10 11v5M14 11v5" /></>,
  edit: <><path d="M4.5 19.5h15" /><path d="m6 15.5 9.3-9.3a1.6 1.6 0 0 1 2.3 0l.2.2a1.6 1.6 0 0 1 0 2.3L8.5 18l-3.2.7.7-3.2Z" /></>,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M5.5 15.5h-1a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1" /></>,
  refresh: <><path d="M4.5 12a7.5 7.5 0 0 1 13-5.2L20 9" /><path d="M20 4.5V9h-4.5" /><path d="M19.5 12a7.5 7.5 0 0 1-13 5.2L4 15" /><path d="M4 19.5V15h4.5" /></>,
  send: <path d="M5 12 20 4.5 15.5 20l-3-6.5L5 12Z" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="2" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  minimize: <path d="M5.5 12h13" />,
  maximize: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></>,
  moon: <path d="M20 13.5A8 8 0 0 1 10.5 4a8 8 0 1 0 9.5 9.5Z" />,
  check: <path d="m5.5 12.5 4 4 9-9.5" />,
  chevronDown: <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  chevronRight: <path d="m9.5 6.5 5.5 5.5-5.5 5.5" />,
  chevronLeft: <path d="m14.5 6.5-5.5 5.5 5.5 5.5" />,
  terminal: <><path d="m5.5 8 4 4-4 4" /><path d="M12.5 16.5h6" /></>,
  file: <><path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5l-5-5Z" /><path d="M13.5 3.5v5h5" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.6 2.5 3.9 5.3 3.9 8.5s-1.3 6-3.9 8.5c-2.6-2.5-3.9-5.3-3.9-8.5s1.3-6 3.9-8.5Z" /></>,
  key: <><circle cx="8.5" cy="14.5" r="4" /><path d="m11.5 11.5 8-8M17 6l2.5 2.5M14.5 8.5 17 11" /></>,
  spark: <path d="M12 3.5c.6 4.4 2.3 6.4 8.5 8.5-6.2 2.1-7.9 4.1-8.5 8.5-.6-4.4-2.3-6.4-8.5-8.5 6.2-2.1 7.9-4.1 8.5-8.5Z" />,
  command: <path d="M9 9V6.5A2.5 2.5 0 1 0 6.5 9H9Zm0 0v6m0-6h6M9 15H6.5A2.5 2.5 0 1 0 9 17.5V15Zm6 0v2.5a2.5 2.5 0 1 0 2.5-2.5H15Zm0 0V9m0 0h2.5A2.5 2.5 0 1 0 15 6.5V9Z" />,
  dots: <path d="M6 12h.01M12 12h.01M18 12h.01" />,
  eye: <><path d="M3.5 12S6.5 5.5 12 5.5 20.5 12 20.5 12 17.5 18.5 12 18.5 3.5 12 3.5 12Z" /><circle cx="12" cy="12" r="2.8" /></>,
  eyeOff: <><path d="M4 4.5 20 19.5" /><path d="M9.9 6c.7-.3 1.4-.5 2.1-.5 5.5 0 8.5 6.5 8.5 6.5a15.6 15.6 0 0 1-2.6 3.6M14 14.5a2.8 2.8 0 0 1-4.4-2.3M6.3 7.8A14.8 14.8 0 0 0 3.5 12s3 6.5 8.5 6.5c1.1 0 2.2-.3 3.1-.7" /></>,
  alert: <><path d="M12 4 2.8 19.5h18.4L12 4Z" /><path d="M12 10v4.5M12 17.2h.01" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2.5" /></>,
  zap: <path d="M13 3.5 5.5 13.5H11l-.8 7 7.6-10H12.2l.8-7Z" />,
  layers: <><path d="m12 3.5 8.5 4.5L12 12.5 3.5 8 12 3.5Z" /><path d="m4.5 12.5 7.5 4 7.5-4M4.5 16.5l7.5 4 7.5-4" /></>,
  cpu: <><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M10 2.5v3M14 2.5v3M10 18.5v3M14 18.5v3M2.5 10h3M2.5 14h3M18.5 10h3M18.5 14h3" /></>,
  image: <><rect x="4" y="4.5" width="16" height="15" rx="2" /><circle cx="9" cy="9.5" r="1.6" /><path d="m4.5 16.5 4.5-4 4 3.5 3-2.5 3.5 3" /></>,
  code: <><path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4" /><path d="m13 5.5-2 13" /></>,
  brain: <><path d="M12 4.5c-1-1.4-3.2-1.5-4.3-.3-1 1-1 2.3-.6 3.2-1.3.4-2.3 1.5-2.3 3 0 1 .5 1.9 1.2 2.4-.7.6-1 1.5-.8 2.5.3 1.4 1.6 2.4 3 2.3.2 1.4 1.4 2.5 2.9 2.4.7 0 1.4-.4 1.9-.9V4.5Z" /><path d="M12 4.5c1-1.4 3.2-1.5 4.3-.3 1 1 1 2.3.6 3.2 1.3.4 2.3 1.5 2.3 3 0 1-.5 1.9-1.2 2.4.7.6 1 1.5.8 2.5-.3 1.4-1.6 2.4-3 2.3-.2 1.4-1.4 2.5-2.9 2.4-.7 0-1.4-.4-1.9-.9" /></>,
  dollar: <><path d="M12 3.5v17" /><path d="M16.5 7.5c-.7-1.3-2.3-2-4.5-2-2.5 0-4 1.2-4 3 0 4 8.7 2 8.7 6.3 0 1.9-1.8 3.2-4.7 3.2-2.4 0-4-.9-4.6-2.3" /></>,
  arrowUpRight: <path d="M7 17 17 7M9 7h8v8" />,
  paperclip: <path d="m19 11.5-7.2 7.2a4.6 4.6 0 0 1-6.5-6.5l7.8-7.8a3.1 3.1 0 0 1 4.3 4.3l-7.7 7.7a1.5 1.5 0 0 1-2.2-2.2l6.9-6.9" />,
  download: <><path d="M12 4v11M7.5 11 12 15.5 16.5 11" /><path d="M5 19.5h14" /></>,
  sidebar: <><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M9.5 5v14" /></>,
  keyboard: <><rect x="3" y="7" width="18" height="11" rx="2" /><path d="M6.5 10.5h.01M10 10.5h.01M13.5 10.5h.01M17 10.5h.01M6.5 14.5h.01M17 14.5h.01M9.5 14.5h5" /></>,
  history: <><path d="M4.5 12a7.5 7.5 0 1 1 2.2 5.3" /><path d="M4.5 12H3M4.5 12l1.5 1.5" /><path d="M12 8.5V12l2.5 2" /></>,
  shield: <><path d="M12 3.5 5 6v5.5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-2.5Z" /><path d="m9 12 2 2 4-4" /></>,
  gauge: <><path d="M5 18.5a8.5 8.5 0 1 1 14 0" /><path d="M12 14.5 15.5 9" /><circle cx="12" cy="15" r="1.3" /></>,
  bookmark: <path d="M7 4.5h10a1 1 0 0 1 1 1V20l-6-3.5L6 20V5.5a1 1 0 0 1 1-1Z" />,
  wand: <><path d="m14 6 4 4L7.5 20.5l-4-4L14 6Z" /><path d="m12.5 7.5 4 4" /><path d="M18.5 3.5v2M17.5 6.5l1.5-1.5M20.5 6.5 19 5" /></>,
};

export default function Icon({ name, size = 16, strokeWidth = 1.5, className = "", style }) {
  const paths = PATHS[name];
  if (!paths) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {paths}
    </svg>
  );
}

export const ICON_NAMES = Object.keys(PATHS);
