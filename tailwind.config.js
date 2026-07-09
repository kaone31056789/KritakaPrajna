/** @type {import('tailwindcss').Config} */
// Soft Machine: every color maps to a CSS variable from src/design/tokens.css,
// so Tailwind utilities are automatically theme-aware (dark/light neumorphism).
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        deep: "var(--bg-deep)",
        surface: {
          DEFAULT: "var(--surface)",
          2: "var(--surface-2)",
          3: "var(--surface-3)",
        },
        line: {
          DEFAULT: "var(--line)",
          strong: "var(--line-strong)",
        },
        hi: "var(--text-hi)",
        body: "var(--text)",
        dim: "var(--text-dim)",
        faint: "var(--text-faint)",
        accent: {
          DEFAULT: "var(--accent)",
          2: "var(--accent-2)",
          ink: "var(--accent-ink)",
          soft: "var(--accent-soft)",
          glow: "var(--accent-glow)",
        },
        ok: { DEFAULT: "var(--ok)", soft: "var(--ok-soft)" },
        err: { DEFAULT: "var(--err)", soft: "var(--err-soft)" },
        info: { DEFAULT: "var(--info)", soft: "var(--info-soft)" },
      },
      fontFamily: {
        display: ["Space Grotesk", "Plus Jakarta Sans", "system-ui", "sans-serif"],
        sans: ["Plus Jakarta Sans", "system-ui", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "Cascadia Code", "Consolas", "monospace"],
      },
      borderRadius: {
        xs: "var(--r-xs)",
        sm: "var(--r-sm)",
        DEFAULT: "var(--r)",
        lg: "var(--r-lg)",
        xl: "var(--r-xl)",
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.23, 1, 0.32, 1)",
        "in-out": "cubic-bezier(0.77, 0, 0.175, 1)",
        drawer: "cubic-bezier(0.32, 0.72, 0, 1)",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        breathe: {
          "0%, 100%": { opacity: "0.5", transform: "scale(1)" },
          "50%": { opacity: "1", transform: "scale(1.06)" },
        },
        "spin-fast": {
          to: { transform: "rotate(360deg)" },
        },
      },
      animation: {
        shimmer: "shimmer 1.6s linear infinite",
        breathe: "breathe 2.4s cubic-bezier(0.77, 0, 0.175, 1) infinite",
        // Fast spinner = faster perceived loading (Emil)
        "spin-fast": "spin-fast 0.65s linear infinite",
      },
    },
  },
  plugins: [],
};
