// KritakaPrajna mark — a two-tone "K" monogram. The stem is a calm
// off-white bar; the chevron is a gradient stroke driving into it,
// separated by deliberate negative space. Round caps, single weight.
// Scales crisply from a 13px favicon up to hero sizes.
import React, { useId } from "react";
import { motion } from "framer-motion";

export function LogoMark({ size = 24, glow = true, className = "" }) {
  const uid = useId().replace(/:/g, "");
  return (
    <motion.span
      whileHover={{ rotate: -6, scale: 1.07 }}
      whileTap={{ scale: 0.94 }}
      transition={{ type: "spring", stiffness: 320, damping: 17 }}
      className={`inline-flex shrink-0 items-center justify-center ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        background: "linear-gradient(150deg, #1d1f24 0%, #101114 100%)",
        boxShadow: glow
          ? "0 0 14px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,0.08), 0 2px 8px rgba(0,0,0,0.5)"
          : "inset 0 1px 0 rgba(255,255,255,0.08), 0 2px 8px rgba(0,0,0,0.5)",
      }}
    >
      <svg
        width={Math.round(size * 0.72)}
        height={Math.round(size * 0.72)}
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`${uid}-a`} x1="15" y1="25" x2="24" y2="7" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--accent-2, #ff8a3d)" />
            <stop offset="1" stopColor="var(--accent, #ffc46b)" />
          </linearGradient>
        </defs>
        {/* stem */}
        <path
          d="M10.6 6.8v18.4"
          stroke="#ECE7DC"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        {/* chevron */}
        <path
          d="M23.2 7 15.4 16l7.8 9"
          stroke={`url(#${uid}-a)`}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </motion.span>
  );
}

export default LogoMark;
