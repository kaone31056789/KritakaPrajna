import React from "react";

/**
 * KritakaPrajna logo — terminal >_ prompt symbol.
 * Scales from 16 -> 512px.
 */
export default function KPLogo({ size = 32, className = "" }) {
  const showCursor = size >= 24;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Background */}
      <rect width="512" height="512" rx="40" fill="#111111" stroke="#1a1a1a" strokeWidth="4" />

      {/* >_ prompt text */}
      <text
        x="256"
        y={showCursor ? "290" : "300"}
        textAnchor="middle"
        fill="#00ff41"
        fontFamily="monospace"
        fontWeight="700"
        fontSize={showCursor ? "220" : "280"}
      >
        {showCursor ? ">_" : ">"}
      </text>

      {/* Blinking cursor line (only at larger sizes) */}
      {showCursor && (
        <rect x="340" y="180" width="16" height="140" rx="2" fill="#00ff41" opacity="0.7">
          <animate attributeName="opacity" values="0.7;0;0.7" dur="1s" repeatCount="indefinite" calcMode="discrete" keyTimes="0;0.5;1" />
        </rect>
      )}
    </svg>
  );
}
